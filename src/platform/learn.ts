// After introspection, reads a little of the data to learn the estate's meaning (see semantics.ts): code tables and what
// each code means, ids that point into other systems under other names, period tables read as one, and history tables.
// It runs with the connection's read credential, outside any user's scope: what it stores is metadata and code lists.
import type { CatalogObject, Connection } from "./contract.ts";
import { connectorFor } from "./connectors/index.ts";
import { codeTableShape, historyOf, linkCandidates, matchCodes, periodFamilies } from "./semantics.ts";
import { get, list, put, remove } from "./store.ts";
import { QUERY } from "../config/server.ts";

const CODE_ROWS_MAX = 5000;
const CODED_COLUMNS_MAX = 400;
const LINK_SAMPLE = 100;
const LINK_MIN = 0.8;
const IN_CHUNK = 100;

const conn = (o: CatalogObject) => get("connection", o.connectionId) as Connection;
const reader = (o: CatalogObject) => connectorFor(conn(o), "read");

async function allRows(o: CatalogObject, columns: string[], max: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < max; offset += QUERY.selectCap) {
    const r = await reader(o).select({ kind: "select", object: o, columns, filters: [], limit: QUERY.selectCap, offset });
    out.push(...r.rows);
    if (r.rows.length < QUERY.selectCap) break;
  }
  return out;
}

async function valueCounts(o: CatalogObject, column: string, limit: number): Promise<{ value: string; n: number }[]> {
  const r = await reader(o).aggregate({ kind: "aggregate", object: o, metrics: [{ fn: "count", as: "n" }], groupBy: [column], filters: [{ column, op: "not_null" }], minGroupSize: 1, sort: { column: "n", dir: "desc" }, limit });
  return r.rows.map((x) => ({ value: String(x[column]).trim(), n: Number(x.n) })).filter((x) => x.value);
}
const distinctValues = async (o: CatalogObject, column: string, limit: number) => (await valueCounts(o, column, limit)).map((x) => x.value);

/** Learns and stores the estate's meaning for one tenant. Failures on one object never block the rest. */
export async function learnTenant(tenantId: string): Promise<{ codeTables: number; decoded: number; links: number; families: number; histories: number }> {
  const all = list("catalog", tenantId);
  // Period families are rebuilt below; what an admin set on their columns (units, encodings) is carried over.
  const familyFixes = new Map(all.filter((o) => o.unionOf).map((o) => [`${o.connectionId}/${o.name}`, o.columns.filter((c) => c.semanticsSource === "admin")]));
  for (const v of all.filter((o) => o.unionOf)) remove("catalog", `${v.connectionId}/${v.name}`);
  const objs = all.filter((o) => !o.unionOf && conn(o)?.status === "ok");
  const stats = { codeTables: 0, decoded: 0, links: 0, families: 0, histories: 0 };

  for (const o of objs) {
    o.history = historyOf(o);
    o.codeTable = codeTableShape(o);
    if (o.history) stats.histories++;
    // What a person confirmed or corrected stays as they left it.
    for (const c of o.columns) if (c.semanticsSource !== "admin") { delete c.decode; delete c.link; }
  }

  const tables: { obj: CatalogObject; rows: { type?: string; value: string; desc: string }[] }[] = [];
  for (const o of objs.filter((x) => x.codeTable)) {
    const ct = o.codeTable!;
    try {
      const rows = await allRows(o, [ct.value, ct.desc, ...(ct.type ? [ct.type] : [])], CODE_ROWS_MAX);
      tables.push({ obj: o, rows: rows.map((r) => ({ value: String(r[ct.value] ?? "").trim(), desc: String(r[ct.desc] ?? "").trim(), ...(ct.type ? { type: String(r[ct.type] ?? "").trim() } : {}) })).filter((r) => r.value) });
      stats.codeTables++;
    } catch { delete o.codeTable; }
  }

  let budget = CODED_COLUMNS_MAX;
  if (tables.length) for (const o of objs.filter((x) => !x.codeTable && x.kind !== "collection")) for (const c of o.columns) {
    if (budget <= 0 || c.semanticsSource === "admin" || c.type !== "text" || c.pk || c.sensitivity === "restricted" || c.sensitivity === "confidential") continue;
    if (!/(cd|code|kode|sts|status|typ|type|jenis|seg|flag|flg|ind|kd)$/i.test(c.name)) continue;
    budget--;
    try {
      const vc = await valueCounts(o, c.name, 200);
      const d = matchCodes(c.name, vc.map((x) => x.value), tables, vc.map((x) => x.n));
      if (d) { c.decode = d; stats.decoded++; }
    } catch { /* an unreadable column stays undecoded */ }
  }

  for (const cand of linkCandidates(objs)) {
    const col = cand.child.columns.find((c) => c.name === cand.column)!;
    if (col.link || col.semanticsSource === "admin") continue;
    try {
      // A small table is checked whole: every value it has is the sample, so its links are as certain as a big one's.
      const vals = await distinctValues(cand.child, cand.column, LINK_SAMPLE);
      if (!vals.length) continue;
      let found = 0;
      for (let i = 0; i < vals.length; i += IN_CHUNK) {
        const r = await reader(cand.parent).select({ kind: "select", object: cand.parent, columns: [cand.key], filters: [{ column: cand.key, op: "in", value: vals.slice(i, i + IN_CHUNK) }], limit: IN_CHUNK, offset: 0 });
        found += r.rows.length;
      }
      const overlap = +(found / vals.length).toFixed(2);
      if (overlap >= LINK_MIN) { col.link = { connectionId: cand.parent.connectionId, object: cand.parent.name, column: cand.key, overlap }; stats.links++; }
    } catch { /* types that cannot be compared are not linked */ }
  }

  for (const o of objs) put("catalog", o);
  for (const f of periodFamilies(objs)) {
    const fixes = familyFixes.get(`${f.connectionId}/${f.name}`) ?? [];
    put("catalog", { ...f, exposed: true, columns: f.columns.map((c) => fixes.find((x) => x.name === c.name) ?? c) });
    stats.families++;
  }
  return stats;
}
