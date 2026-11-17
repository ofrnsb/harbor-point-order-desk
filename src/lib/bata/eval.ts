// The brick evaluator: picks rows, binds values, computes aggregates and ratios, and formats them for reading.
// Pure, shared by the server (validation) and the browser (rendering), so both read the data the same way.
import { dateTimeText } from "../datetime.ts";
import type { Cell, Column, Row, RowSource } from "../types.ts";
import { moneyCompact, moneyText, rowCurrency, statusLabel } from "../values.ts";
import type { Cond, RowsRef, Text, Val } from "./schema.ts";
import { LABEL } from "../../copy/server.ts";
import { COMMON } from "../../copy/ui-common.ts";
import { CURRENCY, numFmt } from "../../config/locale.ts";
import { currencyOfColumn, LANGUAGE, MONEY_SHORT, PCT_DECIMALS_BELOW } from "../../config/data.ts";

export type Dataset = { title: string; columns: Column[]; rows: Row[]; open?: RowSource };
export type DataMap = Record<string, Dataset>;
/** What a brick sees: the dataset and rows of the nearest brick that chose rows, and the row being repeated, if any. */
export type Scope = { data: DataMap; ds: Dataset | null; rows: Row[]; row: Row | null };
export type Got = { v: Cell; col?: Column };

const PCT: Column = { name: "pct", label: "%", type: "number", role: "pct" };
const COUNT: Column = { name: "count", label: LABEL.count, type: "number" };

export const refOf = (r: RowsRef) => (typeof r === "string" ? r : r.ref);
export const colOf = (ds: Dataset | null, name: string) => ds?.columns.find((c) => c.name === name);

const num = (v: Cell | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

function cmp(a: Cell | undefined, b: Cell | undefined): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  const x = num(a), y = num(b);
  if (x !== null && y !== null) return x - y;
  return String(a).localeCompare(String(b), LANGUAGE);
}

function matches(row: Row, c: Cond): boolean {
  const v = row[c.col];
  switch (c.op) {
    case "empty": return v === null || v === undefined || v === "";
    case "not_empty": return !(v === null || v === undefined || v === "");
    case "in": return Array.isArray(c.value) && c.value.some((x) => String(x) === String(v));
    case "contains": return v !== null && v !== undefined && String(v).toLowerCase().includes(String(c.value ?? "").toLowerCase());
    case "eq": return String(v) === String(c.value);
    case "ne": return String(v) !== String(c.value);
    default: {
      const d = cmp(v, c.value as Cell);
      if (v === null || v === undefined) return false;
      return c.op === "gt" ? d > 0 : c.op === "gte" ? d >= 0 : c.op === "lt" ? d < 0 : d <= 0;
    }
  }
}

/** The rows a brick works on: the ref's rows, filtered, ordered and cut as asked. */
export function pickRows(r: RowsRef, data: DataMap): { ds: Dataset | null; rows: Row[] } {
  const ds = data[refOf(r)] ?? null;
  if (!ds) return { ds: null, rows: [] };
  if (typeof r === "string") return { ds, rows: ds.rows };
  let rows = r.where?.length ? ds.rows.filter((x) => r.where!.every((c) => matches(x, c))) : ds.rows;
  if (r.sort) {
    const k = r.sort.by, d = r.sort.dir === "asc" ? 1 : -1;
    const empty = (v: Cell | undefined) => v === null || v === undefined || v === "";
    // Missing values go last whichever way the rows are ordered.
    rows = [...rows].sort((a, b) => (empty(a[k]) || empty(b[k]) ? cmp(a[k], b[k]) : cmp(a[k], b[k]) * d));
  }
  if (r.limit) rows = rows.slice(0, r.limit);
  return { ds, rows };
}

export const scopeFor = (data: DataMap, r: RowsRef): Scope => { const { ds, rows } = pickRows(r, data); return { data, ds, rows, row: null }; };

/** A money column read in a row that states its currency carries that currency, so an amount is never shown in
 *  the wrong one. Rows in several currencies cannot be added up into one figure: the sum loses its money reading. */
export function inCurrency(col: Column | undefined, rows: readonly Row[]): Column | undefined {
  if (!col?.money) return col;
  const curs = new Set(rows.map((r) => rowCurrency(r)).filter(Boolean));
  if (curs.size === 1) return { ...col, currency: [...curs][0] };
  if (curs.size > 1) return { ...col, money: false, currency: undefined, mixedCurrency: true };
  return col;
}

export function evalVal(v: Val, s: Scope): Got {
  if ("bind" in v) {
    const row = s.row ?? s.rows[0] ?? null;
    return { v: row ? (row[v.bind] ?? null) : null, col: inCurrency(colOf(s.ds, v.bind), row ? [row] : []) };
  }
  if ("agg" in v) {
    const src = v.rows ? pickRows(v.rows, s.data) : { ds: s.ds, rows: s.rows };
    const col = v.of ? inCurrency(colOf(src.ds, v.of), src.rows) : undefined;
    const vals = v.of ? src.rows.map((r) => r[v.of!]) : [];
    switch (v.agg) {
      case "count": return { v: v.of ? vals.filter((x) => x !== null && x !== "").length : src.rows.length, col: COUNT };
      case "distinct": return { v: new Set(vals.filter((x) => x !== null && x !== "").map(String)).size, col: COUNT };
      case "first": return { v: vals[0] ?? null, col };
      case "last": return { v: vals[vals.length - 1] ?? null, col };
      default: {
        // Dates have an earliest and a latest, not a sum: min and max of a date column compare them as dates.
        if ((v.agg === "min" || v.agg === "max") && (col?.type === "date" || vals.some((x) => typeof x === "string" && ISO.test(x)))) {
          const ds = vals.filter((x): x is string => typeof x === "string" && ISO.test(x)).sort();
          return { v: ds.length ? (v.agg === "min" ? ds[0] : ds[ds.length - 1]) : null, col };
        }
        const ns = vals.map(num).filter((x): x is number => x !== null);
        if (!ns.length) return { v: null, col };
        const r = v.agg === "sum" ? ns.reduce((a, b) => a + b, 0) : v.agg === "avg" ? ns.reduce((a, b) => a + b, 0) / ns.length : v.agg === "min" ? Math.min(...ns) : Math.max(...ns);
        return { v: r, col };
      }
    }
  }
  const a = evalVal(v.a, s), b = evalVal(v.b, s);
  const x = num(a.v), y = num(b.v);
  if (x === null || y === null) return { v: null, col: v.calc === "diff" ? a.col : PCT };
  switch (v.calc) {
    case "diff": return { v: x - y, col: a.col };
    case "ratio": return { v: y === 0 ? null : x / y, col: { ...PCT, role: "ratio" } };
    case "pct": case "share": return { v: y === 0 ? null : (x / y) * 100, col: PCT };
    case "pct_change": return { v: y === 0 ? null : ((x - y) / Math.abs(y)) * 100, col: PCT };
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;
const PCT_NAME = /(^|_)(pct|percent|percentage)$/i;
const nf = (d: number) => numFmt({ maximumFractionDigits: d });

/** A value as it reads: money, percent, date, status words, Yes/No; a missing value is a dash. */
export function fmt(g: Got): string {
  const { v, col } = g;
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? COMMON.yes : COMMON.no;
  if (typeof v === "number") {
    // A share is a percent whether a tool marked it so or its name says it (net_margin_pct, late_percent).
    if (col?.role === "pct" || (PCT_NAME.test(col?.name ?? "") && !/%/.test(col?.label ?? ""))) return `${nf(Math.abs(v) < PCT_DECIMALS_BELOW ? 1 : 0).format(v)}%`;
    if (col?.role === "ratio") return nf(2).format(v);
    if (/(^|_)(year|tahun)$/i.test(col?.name ?? "") && Number.isInteger(v)) return String(v);
    if (col?.money) return moneyText(v, col.currency ?? currencyOfColumn(col.name));
    return nf(2).format(v);
  }
  const t = String(v);
  if ((col?.type === "date" || ISO.test(t)) && ISO.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) {
      // A date stored as local midnight (any offset) is a day, not a time.
      const timed = /T\d{2}:\d{2}/.test(t) && (d.getHours() !== 0 || d.getMinutes() !== 0);
      return dateTimeText(d, { year: true, time: timed });
    }
  }
  if (col?.role === "status") return statusLabel(t);
  return t;
}

/** A headline amount from a million up, shortened the international way ($1.2M); everything else as fmt. */
export function fmtShort(g: Got): string {
  const n = num(g.v), cur = g.col?.currency ?? (g.col ? currencyOfColumn(g.col.name) : undefined) ?? CURRENCY;
  if (!g.col?.money || n === null || Math.abs(n) < MONEY_SHORT.million) return fmt(g);
  return moneyCompact(n, cur);
}

/** Words with {column} placeholders filled from the current row, or a bound value formatted. */
export function text(t: Text | undefined, s: Scope): string {
  if (t === undefined) return "";
  if (typeof t !== "string") return fmt(evalVal(t, s));
  const row = s.row ?? s.rows[0] ?? null;
  return t.replace(/\{([a-z0-9_]+)\}/gi, (m, name: string) => (row && name in row ? fmt({ v: row[name], col: inCurrency(colOf(s.ds, name), [row]) }) : m));
}

/** A number for drawing (bars, meters, deltas); null when the value is not a number. */
export const numberOf = (g: Got): number | null => num(g.v);
