// What a write may touch, decided from the catalog alone so it works on any company's systems without setup:
// a write may only name records the requester can read, and may only leave the target row inside their row scope.
import type { ActionTemplate, CatalogObject, CompiledAction, Connection, Effective, EffectiveObject, WriteResult } from "./contract.ts";
import type { Field } from "../lib/types.ts";
import { formatValue } from "../lib/values.ts";
import { compileAction } from "./catalog.ts";
import { connectorFor } from "./connectors/index.ts";
import { PolicyError, scopeOf, shapeRows } from "./policy.ts";
import { selectScoped } from "./scoped-read.ts";
import { get, list } from "./store.ts";
import { roleOf, type Role } from "./wiring.ts";
import { ERR } from "../copy/server.ts";

const LINK = /_(id|no|code|ref|number)$/i;
const FACT_COLUMNS = 4;

/** A record the write refers to, as the requester is allowed to see it. Shown next to the proposal for review. */
export type LinkedFact = { column: string; value: string; system: string; object: string; label: string; fields: Field[] };

function targetsOf(tenantId: string, t: ActionTemplate, column: string): CatalogObject[] {
  const own = get("catalog", `${t.connectionId}/${t.object}`);
  const col = own?.columns.find((c) => c.name === column);
  const fk = col?.fk, link = col?.link;
  return list("catalog", tenantId).filter((o) => o.exposed && !(o.connectionId === t.connectionId && o.name === t.object) &&
    ((o.primaryKey.length === 1 && o.primaryKey[0] === column) || (fk && o.connectionId === t.connectionId && o.name === fk.object) || (link && o.connectionId === link.connectionId && o.name === link.object)));
}

/** What says which record this is first (name, status, category), then its figures (a current limit); never a column above internal sensitivity. */
const FACT_ORDER: Role[] = ["title", "status", "category", "money", "quantity"];
function factFields(obj: CatalogObject, row: Record<string, unknown>, key: string): Field[] {
  const cols = obj.columns.filter((c) => c.name !== key && row[c.name] !== undefined && row[c.name] !== null && (c.sensitivity === "public" || c.sensitivity === "internal"));
  const rank = (c: (typeof cols)[number]) => { const i = FACT_ORDER.indexOf(roleOf(c)); return i >= 0 ? i : c.type === "number" ? FACT_ORDER.length : FACT_ORDER.length + 1; };
  const ranked = [...cols].sort((a, b) => rank(a) - rank(b)).slice(0, FACT_COLUMNS);
  return ranked.map((c) => ({ label: c.label || c.name, value: formatValue(c.name, row[c.name]) }));
}

/**
 * Every identifier the write carries (outlet_code, customer_no, invoice_no, ...) must resolve to a record the requester
 * can read in at least one system that holds it. A value that names nothing visible is refused, so nobody can write
 * about records outside their scope, and a mistyped id never reaches the system of record.
 */
export async function linkedFacts(eff: Effective, t: ActionTemplate, a: CompiledAction): Promise<LinkedFact[]> {
  const own = get("catalog", `${t.connectionId}/${t.object}`);
  const pairs = Object.entries(a.values).concat(a.key ? [[a.key.column, a.key.value]] : []);
  const facts: LinkedFact[] = [];
  for (const [column, value] of pairs) {
    const meta = own?.columns.find((c) => c.name === column);
    if ((typeof value !== "string" && typeof value !== "number") || !(LINK.test(column) || meta?.fk || meta?.link)) continue;
    const targets = targetsOf(eff.tenant.id, t, column);
    if (!targets.length) continue;
    let fact: LinkedFact | null = null;
    for (const obj of targets) {
      const conn = get("connection", obj.connectionId);
      if (!conn || !scopeOf(eff, obj.connectionId, obj.name)) continue;
      const key = obj.primaryKey.length === 1 ? obj.primaryKey[0] : own?.columns.find((c) => c.name === column)?.link?.column ?? column;
      let res;
      try { res = await selectScoped(eff, obj, { filters: [{ column: key, op: "eq", value }], limit: 1 }, { external: false }); }
      catch (e) { if (e instanceof PolicyError) continue; throw e; }
      const row = shapeRows(res.rows, res.plan.masks, eff.tenant.id)[0];
      if (row) { fact = { column, value: String(value), system: conn.code, object: obj.name, label: obj.label || obj.name, fields: factFields(obj, row, key) }; break; }
    }
    if (!fact) throw new PolicyError(ERR.writeNamesUnseenRecord(column, String(value), targets.map((o) => `${get("connection", o.connectionId)?.code ?? o.connectionId}.${o.name}`).join(", ")), "out_of_scope");
    facts.push(fact);
  }
  return facts;
}

const rowIn = (row: Record<string, unknown>, scope: EffectiveObject) =>
  scope.rowFilters.every((f) => (Array.isArray(f.value) ? f.value.map(String) : [String(f.value)]).includes(String(row[f.column] ?? "")));

/** When the requester reads the target object through row filters, the row must sit inside them before and after. */
export function checkRowScope(eff: Effective, t: ActionTemplate, rows: (Record<string, unknown> | null)[]): void {
  const scope = scopeOf(eff, t.connectionId, t.object);
  if (!scope?.rowFilters.length) return;
  for (const row of rows) if (row && !rowIn(row, scope)) throw new PolicyError(ERR.writeOutsideRowScope(t.object, scope.rowFilters.map((f) => f.column).join(", ")), "out_of_scope");
}

/** The exact write for this requester: compiled from the template, checked against what they may see. */
export async function prepareWrite(eff: Effective, t: ActionTemplate, params: Record<string, unknown>, key: unknown): Promise<{ compiled: CompiledAction; facts: LinkedFact[] }> {
  const compiled = compileAction(t, params, key, { userId: eff.user.id, userName: eff.user.name, unitCode: eff.unit.code, now: new Date().toISOString() });
  const pk = get("catalog", `${t.connectionId}/${t.object}`)?.primaryKey;
  if (pk?.length === 1) compiled.pk = pk[0];
  return { compiled, facts: await linkedFacts(eff, t, compiled) };
}

/** Runs the write in the target system inside a transaction that is rolled back, and checks the resulting row. */
export async function rehearseWrite(eff: Effective, t: ActionTemplate, conn: Connection, compiled: CompiledAction): Promise<WriteResult> {
  let res: WriteResult;
  try { res = await connectorFor(conn, "write").execute(compiled, { rehearse: true }); }
  catch (e) { throw new PolicyError(ERR.rehearsalRefused(conn.code, e instanceof Error ? e.message : String(e)), "bad_request"); }
  checkRowScope(eff, t, [res.before, res.after]);
  return res;
}
