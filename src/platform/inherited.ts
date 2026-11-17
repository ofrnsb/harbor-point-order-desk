// Row filters follow links. A child row (payments.invoice_no, invoice_lines.invoice_no, credit_limits.outlet_code) is
// visible only when the parent row it points to is visible, so a filter on invoices also covers everything that hangs off
// invoices, whatever the company named its tables. Links come from declared foreign keys and the catalog's id rule.
import type { CatalogObject, Connection, Effective, Filter } from "./contract.ts";
import { get, list } from "./store.ts";

const LINK = /_(id|no|code|ref|number)$/i;
const DEPTH = 3;

/** A parent whose row filters reach this object through `column` = parent.`key`. */
export type ParentGuard = { column: string; parent: CatalogObject; key: string };
/** Compiled by the SQL connector as `column IN (SELECT key FROM parent WHERE filters)`. */
export type ParentFilterValue = { object: CatalogObject; key: string; filters: Filter[] };

const scopeOf = (eff: Effective, o: CatalogObject) => eff.data[o.connectionId]?.[o.name] ?? null;

function linksOf(eff: Effective, obj: CatalogObject): ParentGuard[] {
  const own = scopeOf(eff, obj);
  const out: ParentGuard[] = [];
  for (const c of obj.columns) {
    if (c.fk) {
      const p = get("catalog", `${obj.connectionId}/${c.fk.object}`);
      if (p && p.name !== obj.name) out.push({ column: c.name, parent: p, key: c.fk.column });
      continue;
    }
    // A link learned from the data (CIFNo in one system holding CIF_NO values of another) counts like a declared key.
    if (c.link) {
      const p = get("catalog", `${c.link.connectionId}/${c.link.object}`);
      // A peer only narrows an object that has no row filter of its own, or two filtered peers would hide each other.
      const peer = obj.primaryKey.length === 1 && obj.primaryKey[0] === c.name;
      if (p && !(peer && own?.rowFilters.length)) out.push({ column: c.name, parent: p, key: c.link.column });
    }
    if (!LINK.test(c.name)) continue;
    // An object's own key never links by name alone: TXN_202611.TXN_ID is not TXN_202609.TXN_ID. Peers keyed by the same
    // id (outlets and credit_limits) are linked by the learning pass, which checks the values, and arrive as c.link.
    if (obj.primaryKey.length === 1 && obj.primaryKey[0] === c.name) continue;
    for (const p of list("catalog", eff.tenant.id)) {
      if (!p.exposed || (p.connectionId === obj.connectionId && p.name === obj.name)) continue;
      // A logical table over period tables is its members, not a child of them.
      if (p.connectionId === obj.connectionId && obj.unionOf?.includes(p.name)) continue;
      if (p.primaryKey.length === 1 && p.primaryKey[0] === c.name) out.push({ column: c.name, parent: p, key: c.name });
    }
  }
  return out;
}

/** Parents that are themselves narrowed for this user (by their own row filters or, transitively, by theirs). */
export function parentGuards(eff: Effective, obj: CatalogObject, depth = 0, seen = new Set<string>()): ParentGuard[] {
  if (depth >= DEPTH) return [];
  const id = `${obj.connectionId}/${obj.name}`;
  seen.add(id);
  return linksOf(eff, obj).filter((g) => {
    const key = `${g.parent.connectionId}/${g.parent.name}`;
    const ps = scopeOf(eff, g.parent);
    if (!ps || seen.has(key)) return false;
    return ps.rowFilters.length > 0 || parentGuards(eff, g.parent, depth + 1, new Set(seen)).length > 0;
  });
}

/** Whether one SQL statement on `a` can read `b`'s table: both connections open the same SQLite file. */
export const sameDatabase = (a: Connection, b: Connection): boolean => a.id === b.id || (!!a.config.file && a.config.file === b.config.file);

/**
 * The parent's own row filters plus its parents', as a filter the child's connector can compile; null when some link
 * leaves the database, so the caller must check visibility row by row instead.
 */
export function parentFilter(eff: Effective, child: Connection, g: ParentGuard, depth = 0): Filter | null {
  const pconn = get("connection", g.parent.connectionId);
  const ps = scopeOf(eff, g.parent);
  if (!pconn || !ps || !sameDatabase(child, pconn) || depth >= DEPTH) return null;
  const filters: Filter[] = ps.rowFilters.map((r) => ({ column: r.column, op: r.op, value: r.value }));
  for (const gg of parentGuards(eff, g.parent, depth + 1)) {
    const f = parentFilter(eff, child, gg, depth + 1);
    if (!f) return null;
    filters.push(f);
  }
  const value: ParentFilterValue = { object: g.parent, key: g.key, filters };
  return { column: g.column, op: "in_parent", value };
}
