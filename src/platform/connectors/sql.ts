// Compiles policy-scoped queries to parameterized SQLite SQL. Values never enter the SQL text.
import type { CatalogObject, CompiledAction, Filter, ScopedAggregate, ScopedSelect } from "../contract.ts";
import type { ParentFilterValue } from "../inherited.ts";
import { QUERY } from "../../config/server.ts";
import { ERR } from "../../copy/server.ts";

export type Compiled = { sql: string; params: unknown[] };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AGG_FNS = ["count", "sum", "avg", "min", "max"];
const BUCKET: Record<"day" | "week" | "month", (col: string) => string> = {
  day: (col) => `date(${col})`,
  week: (col) => `date(${col}, '-6 days', 'weekday 1')`,
  month: (col) => `strftime('%Y-%m-01', ${col})`,
};

export function quote(id: string): string {
  if (!IDENT.test(id)) throw new Error(ERR.invalidIdentifier(id));
  return `"${id}"`;
}

/** A FROM item for the object: its table, or for a period family the members stacked with UNION ALL, aliased. */
function table(o: CatalogObject, alias?: string): string {
  if (!o.unionOf?.length) return alias ? `${quote(o.name)} ${alias}` : quote(o.name);
  const source = o.columns.find((c) => c.name.toLowerCase() === "source_table")?.name;
  const cols = o.columns.filter((c) => c.name !== source && !c.virtual).map((c) => quote(c.name)).join(", ");
  // Member names are catalog identifiers (checked by quote), so they can stand as literals.
  const parts = o.unionOf.map((m) => `SELECT ${cols}${source ? `, '${m}' AS ${quote(source)}` : ""} FROM ${quote(m)}`);
  return `(${parts.join(" UNION ALL ")}) ${alias ?? quote(o.name)}`;
}

/**
 * A column as an expression. Money an admin marked as stored in minor units (cents) is divided here, so every filter,
 * total and join sees the major unit (dollars), whatever the agent asks.
 */
function column(o: CatalogObject, name: string, prefix = ""): string {
  const c = o.columns.find((x) => x.name === name);
  if (!c) throw new Error(ERR.unknownColumn2(name, o.name));
  const q = `${prefix}${quote(name)}`;
  return c.minorUnits && c.minorUnits > 1 ? `(${q} / ${Math.floor(c.minorUnits)}.0)` : q;
}
const scaled = (o: CatalogObject, name: string) => !!o.columns.find((x) => x.name === name)?.minorUnits;

/** Escapes LIKE wildcards with "!" so the ESCAPE clause can name it. */
export const escapeLike = (s: string) => s.replace(/[!%_]/g, (m) => `!${m}`);

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v instanceof Date ? v.toISOString() : v);
    return "?";
  }
}

type Cmp = Exclude<Filter["op"], "in" | "contains" | "between" | "in_parent" | "is_null" | "not_null">;
const COMPARE: Record<Cmp, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

function inList(c: string, f: Filter, p: Params): string {
  const vals = Array.isArray(f.value) ? f.value : [f.value];
  return vals.length ? `${c} IN (${vals.map((v) => p.add(v)).join(", ")})` : "1 = 0";
}

function between(c: string, f: Filter, p: Params): string {
  if (!Array.isArray(f.value) || f.value.length !== 2) throw new Error(ERR.betweenNeedsFrom(f.column));
  return `${c} BETWEEN ${p.add(f.value[0])} AND ${p.add(f.value[1])}`;
}

/** A row filter inherited from the parent this column points to, evaluated in the same statement. */
function inParent(c: string, f: Filter, p: Params): string {
  const v = f.value as ParentFilterValue;
  return `${c} IN (SELECT ${column(v.object, v.key)} FROM ${table(v.object)}${where(v.object, v.filters, p)})`;
}

const SPECIAL: Partial<Record<Filter["op"], (c: string, f: Filter, p: Params) => string>> = {
  in: inList,
  between,
  in_parent: inParent,
  contains: (c, f, p) => `LOWER(${c}) LIKE ${p.add(`%${escapeLike(String(f.value ?? "").toLowerCase())}%`)} ESCAPE '!'`,
  is_null: (c) => `${c} IS NULL`,
  not_null: (c) => `${c} IS NOT NULL`,
};

function condition(o: CatalogObject, f: Filter, p: Params): string {
  const c = column(o, f.column);
  const special = SPECIAL[f.op];
  if (special) return special(c, f, p);
  const op = COMPARE[f.op as Cmp];
  if (!op) throw new Error(ERR.unknownFilterOp(f.op));
  return `${c} ${op} ${p.add(f.value)}`;
}

function where(o: CatalogObject, filters: Filter[], p: Params): string {
  const parts = filters.map((f) => condition(o, f, p));
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

export const bucketAlias = (b: { column: string; unit: string }) => `${b.column}_${b.unit}`;

const capped = (n: number, cap: number) => Math.max(1, Math.min(cap, Math.floor(n) || cap));
const orderBy = (expr: string, dir: "asc" | "desc") => ` ORDER BY ${expr} ${dir === "desc" ? "DESC" : "ASC"}`;

export function compileSelect(q: ScopedSelect): { rows: Compiled; count: Compiled } {
  const o = q.object;
  if (!q.columns.length) throw new Error(ERR.noColumnsSelect);
  const cols = q.columns.map((c) => (scaled(o, c) ? `${column(o, c)} AS ${quote(c)}` : column(o, c))).join(", ");
  const p = new Params();
  const w = where(o, q.filters, p);
  const order = q.sort ? orderBy(column(o, q.sort.column), q.sort.dir) : "";
  const offset = Math.max(0, Math.floor(q.offset) || 0);
  const rows = { sql: `SELECT ${cols} FROM ${table(o)}${w}${order} LIMIT ${capped(q.limit, QUERY.selectCap)} OFFSET ${offset}`, params: p.values };
  const pc = new Params();
  const count = { sql: `SELECT COUNT(*) AS n FROM ${table(o)}${where(o, q.filters, pc)}`, params: pc.values };
  return { rows, count };
}

type Lookup = NonNullable<ScopedAggregate["lookups"]>[number];

/** One lookup pre-aggregated per key and LEFT JOINed as `l<i>`, so the database does one hash join instead of a subquery per row. */
function lookupJoin(base: CatalogObject, l: Lookup, i: number, p: Params): { join: string; expr: string } {
  const t = `l${i}`;
  const agg = `${l.fn.toUpperCase()}(${l.column ? column(l.object, l.column) : "*"})`;
  const key = column(l.object, l.childColumn);
  const join = ` LEFT JOIN (SELECT ${key} AS "k", ${agg} AS "v" FROM ${table(l.object)}${where(l.object, l.filters, p)} GROUP BY ${key}) ${t} ON ${t}."k" = ${column(base, l.parentColumn, "b.")}`;
  return { join, expr: l.fn === "count" || l.fn === "sum" ? `COALESCE(${t}."v", 0)` : `${t}."v"` };
}

/** The base table, or with lookups/computed columns a derived table `v` holding every base column plus the virtual ones. */
function aggregateSource(q: ScopedAggregate, p: Params): string {
  const o = q.object;
  if (!q.lookups?.length && !q.computed?.length) return table(o);
  const real = new Set(o.columns.filter((c) => !c.virtual).map((c) => c.name));
  const exprs = new Map<string, string>();
  const joins = (q.lookups ?? []).map((l, i) => { const j = lookupJoin(o, l, i, p); exprs.set(l.as, j.expr); return j.join; });
  const operand = (name: string) => {
    const e = exprs.get(name) ?? (real.has(name) ? column(o, name, "b.") : null);
    if (e === null) throw new Error(ERR.unknownColumn2(name, o.name));
    return e;
  };
  for (const c of q.computed ?? []) {
    const right = operand(c.right);
    exprs.set(c.as, `(${operand(c.left)} ${c.op} ${c.op === "/" ? `NULLIF(${right}, 0)` : right})`);
  }
  const virtual = [...exprs].map(([as, e]) => `${e} AS ${quote(as)}`).join(", ");
  return `(SELECT b.*, ${virtual} FROM ${table(o, "b")}${joins.join("")}) v`;
}

function metricExpr(o: CatalogObject, m: ScopedAggregate["metrics"][number]): string {
  if (!AGG_FNS.includes(m.fn)) throw new Error(ERR.unknownAggregate(m.fn));
  if (m.fn !== "count" && !m.column) throw new Error(ERR.needsColumn(m.fn));
  return `${m.fn.toUpperCase()}(${m.column ? column(o, m.column) : "*"}) AS ${quote(m.as)}`;
}

/** SELECT list, GROUP BY expressions and the aliases a sort may name. */
function aggregateParts(q: ScopedAggregate): { select: string[]; group: string[]; aliases: Set<string> } {
  const o = q.object;
  const groups = q.groupBy.map((g) => ({ e: column(o, g), a: g }));
  if (q.bucket) groups.push({ e: BUCKET[q.bucket.unit](column(o, q.bucket.column)), a: bucketAlias(q.bucket) });
  if (!q.metrics.length) throw new Error(ERR.aggregateNeedsAtLeast);
  const select = [...groups.map((g) => `${g.e} AS ${quote(g.a)}`), ...q.metrics.map((m) => metricExpr(o, m)), `COUNT(*) AS "__n"`];
  const aliases = new Set(["__n", ...groups.map((g) => g.a), ...q.metrics.map((m) => m.as)]);
  return { select, group: groups.map((g) => g.e), aliases };
}

export function compileAggregate(q: ScopedAggregate): Compiled {
  const { select, group, aliases } = aggregateParts(q);
  const p = new Params();
  const source = aggregateSource(q, p);
  const w = where(q.object, q.filters, p);
  const groupBy = group.length ? ` GROUP BY ${group.join(", ")}` : "";
  const having = q.minGroupSize > 1 ? ` HAVING COUNT(*) >= ${Math.floor(q.minGroupSize)}` : "";
  if (q.sort && !aliases.has(q.sort.column)) throw new Error(ERR.cannotSortBy(q.sort.column));
  const order = q.sort ? orderBy(quote(q.sort.column), q.sort.dir) : "";
  return { sql: `SELECT ${select.join(", ")} FROM ${source}${w}${groupBy}${having}${order} LIMIT ${capped(q.limit, QUERY.aggregateCap)}`, params: p.values };
}

export function compileWrite(a: CompiledAction): Compiled {
  const t = quote(a.object);
  const p = new Params();
  const keys = Object.keys(a.values);
  if (a.op === "insert") {
    if (!keys.length) throw new Error(ERR.insertNeedsValues);
    return { sql: `INSERT INTO ${t} (${keys.map(quote).join(", ")}) VALUES (${keys.map((k) => p.add(a.values[k])).join(", ")})`, params: p.values };
  }
  if (!a.key) throw new Error(ERR.updateNeedsKey);
  if (!keys.length) throw new Error(ERR.updateNeedsValues);
  const set = keys.map((k) => `${quote(k)} = ${p.add(a.values[k])}`).join(", ");
  return { sql: `UPDATE ${t} SET ${set} WHERE ${quote(a.key.column)} = ${p.add(a.key.value)}`, params: p.values };
}

/** Reads the row a write targets; two rows back means the key is not unique. */
export function compileKeySelect(object: string, key: { column: string; value: unknown }): Compiled {
  const p = new Params();
  return { sql: `SELECT * FROM ${quote(object)} WHERE ${quote(key.column)} = ${p.add(key.value)} LIMIT 2`, params: p.values };
}

/** The first column whose stored value differs from what the write expects, or null when the row is unchanged. */
export function changedColumn(row: Record<string, unknown> | null, expect: Record<string, unknown> | undefined): string | null {
  if (!expect) return null;
  for (const [k, v] of Object.entries(expect)) if (JSON.stringify(row?.[k] ?? null) !== JSON.stringify(v ?? null)) return k;
  return null;
}

const isNumeric = (v: unknown) => typeof v === "string" && v.trim() !== "" && !isNaN(Number(v));

function plainValue(k: string, v: unknown, numeric: Set<string>): unknown {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (numeric.has(k) && isNumeric(v)) return Number(v);
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v;
}

/** Driver values to plain JSON: dates to ISO, numeric strings in number columns or metrics to numbers, bigints to numbers, blobs to text. */
export function normalizeRow(row: Record<string, unknown>, numeric: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plainValue(k, v, numeric)]));
}

export const numericColumns = (o: CatalogObject) => new Set(o.columns.filter((c) => c.type === "number").map((c) => c.name));
export const aggregateNumeric = (q: ScopedAggregate) => new Set([...q.metrics.map((m) => m.as), "__n"]);

/** The business reference of an inserted row: its first "*_no" column (SO-24059), else its id. */
export function insertedRef(row: Record<string, unknown> | undefined): string | undefined {
  if (!row) return undefined;
  const k = Object.keys(row).find((c) => /_no$/.test(c) && row[c] != null) ?? (row.id != null ? "id" : undefined);
  return k ? String(row[k]) : undefined;
}
