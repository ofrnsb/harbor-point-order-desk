// A code that points at another record (customer_code, employee_no, outlet_id) reads as a name for people. Rows a tool
// returns get that record's name beside each such code, read in the same user's scope: a name the user may not see stays
// masked, and an object outside their scope adds nothing. Found from the catalog's keys, foreign keys and learned links,
// so it works on any estate without configuration.
import type { CatalogColumn, CatalogObject, Effective } from "./contract.ts";
import { PolicyError, scopeOf, shapeRows } from "./policy.ts";
import { selectScoped, type ScopedRows } from "./scoped-read.ts";
import { list } from "./store.ts";
import { roleOf } from "./wiring.ts";
import { COL_PATTERNS } from "../config/domain.ts";
import { NAMES } from "../config/data.ts";

export type NameColumn = { name: string; label: string; after: string };
/** Each lookup is a read like any other: the caller records it in the audit trail and the access trail. */
export type NameRead = { target: CatalogObject; statement: string; rows: number; ms: number; touch: ScopedRows["plan"]["touch"] };

const nameColumnOf = (o: CatalogObject): CatalogColumn | undefined =>
  o.columns.find((c) => !c.pk && roleOf(c) === "title") ?? o.columns.find((c) => !c.pk && c.type === "text" && COL_PATTERNS.name.test(c.name));

/** The object a column points at, and that object's key column: a declared foreign key, a learned link, or another object keyed by the same name. */
function targetOf(tenantId: string, obj: CatalogObject, col: CatalogColumn): { target: CatalogObject; key: string } | null {
  const catalog = list("catalog", tenantId).filter((o) => o.exposed && !(o.connectionId === obj.connectionId && o.name === obj.name));
  if (col.fk) { const t = catalog.find((o) => o.connectionId === obj.connectionId && o.name === col.fk!.object); if (t) return { target: t, key: col.fk.column }; }
  if (col.link) { const t = catalog.find((o) => o.connectionId === col.link!.connectionId && o.name === col.link!.object); if (t) return { target: t, key: col.link.column }; }
  if (col.pk) return null;
  // Several objects can share a key (outlets and credit_limits on outlet_code): the one that names the record wins, same system first.
  const keyed = catalog.filter((o) => o.primaryKey.length === 1 && o.primaryKey[0] === col.name && nameColumnOf(o));
  const same = keyed.find((o) => o.connectionId === obj.connectionId) ?? keyed[0];
  return same ? { target: same, key: col.name } : null;
}

/** Rows with a `<code>_name` value after every code column that points at a named record the user may read. */
export async function withNames(eff: Effective, obj: CatalogObject, rows: Record<string, unknown>[], external: boolean, onRead: (r: NameRead) => void): Promise<{ rows: Record<string, unknown>[]; added: NameColumn[] }> {
  if (!rows.length) return { rows, added: [] };
  const present = new Set(Object.keys(rows[0]));
  const added: NameColumn[] = [];
  const names = new Map<string, Map<string, unknown>>();
  for (const col of obj.columns) {
    if (added.length >= NAMES.columns || !present.has(col.name) || nameColumnOf(obj)?.name === col.name) continue;
    const hit = targetOf(eff.tenant.id, obj, col);
    if (!hit || !scopeOf(eff, hit.target.connectionId, hit.target.name)) continue;
    const nameCol = nameColumnOf(hit.target);
    const as = `${col.name}_name`;
    if (!nameCol || present.has(as)) continue;
    const codes = [...new Set(rows.map((r) => r[col.name]).filter((v): v is string | number => typeof v === "string" || typeof v === "number"))].slice(0, NAMES.values);
    if (!codes.length) continue;
    let res;
    try { res = await selectScoped(eff, hit.target, { columns: [hit.key, nameCol.name], filters: [{ column: hit.key, op: "in", value: codes }], limit: codes.length }, { external }); }
    catch (e) { if (e instanceof PolicyError) continue; throw e; }
    onRead({ target: hit.target, statement: res.statement, rows: res.rows.length, ms: res.ms, touch: res.plan.touch });
    const byCode = new Map(shapeRows(res.rows, res.plan.masks, eff.tenant.id).map((r) => [String(r[hit.key]), r[nameCol.name]]));
    if (!byCode.size) continue;
    names.set(col.name, byCode);
    added.push({ name: as, label: nameCol.label || nameCol.name, after: col.name });
  }
  if (!added.length) return { rows, added };
  const out = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      o[k] = v;
      const m = names.get(k);
      if (m) o[`${k}_name`] = m.get(String(v)) ?? null;
    }
    return o;
  });
  return { rows: out, added };
}
