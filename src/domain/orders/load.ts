// Merges uploaded rows into the working ERP: each value is cast to its column's type (the data pack stores everything
// as text), rows match on the table's primary key, new rows are added, changed rows updated, nothing is deleted. A row
// the ERP refuses (a missing field, an unknown customer, stock that does not add up) is reported and skipped alone.
import type Database from "better-sqlite3";
import { ERP_TABLES as T } from "../../config/erp.ts";
import { INGEST } from "../../config/orders.ts";
import { INGEST_TEXT as M } from "../../copy/orders.ts";
import type { Batch } from "./datasets.ts";

type Column = { name: string; type: string; notnull: number; pk: number };
/** One written row for the audit log: its key, and for an update only the columns that changed, before and after. */
export type RowChange = { key: string; before?: Record<string, Cell>; after: Record<string, Cell> };
export type TableReport = { table: string; source: string; added: number; updated: number; unchanged: number; rejected: { row: number; reason: string }[]; changes: RowChange[] };
type Cell = string | number | null;

/** Parents before children, so a new customer's contacts and orders find it in the same upload. */
const ORDER = [T.customers, T.products, T.contacts, T.shipTos, T.prices, T.inventory, T.incoming, T.orders, T.orderLines] as string[];
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

const CASTS: Record<string, (v: string) => Cell | undefined> = {
  INTEGER: (v) => (/^-?\d+$/.test(v) ? Number(v) : undefined),
  REAL: (v) => (v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined),
  TEXT: (v) => v,
};

function cast(col: Column, raw: unknown): Cell | undefined {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  return (CASTS[col.type.toUpperCase()] ?? CASTS.TEXT)(String(raw).trim());
}

/** The uploaded values for the table's columns, cast; a value that cannot be cast is the reason the row is skipped. */
function shape(cols: Column[], raw: Record<string, unknown>): Record<string, Cell> | string {
  const lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const row: Record<string, Cell> = {};
  for (const c of cols.filter((x) => x.name in lower)) {
    const v = cast(c, lower[c.name]);
    if (v === undefined) return M.badValue(c.name, String(lower[c.name]));
    row[c.name] = v;
  }
  return row;
}

/** Columns the ERP works out itself: stock available is always on hand less allocated, old values filling the gaps. */
const DERIVED: Partial<Record<string, (row: Record<string, Cell>, before?: Record<string, Cell>) => Record<string, Cell>>> = {
  [T.inventory]: (row, before) => {
    const onHand = row.on_hand ?? before?.on_hand, allocated = row.allocated ?? before?.allocated ?? 0;
    return typeof onHand === "number" && typeof allocated === "number" ? { ...row, allocated, available: onHand - allocated } : row;
  },
};

/** A new row needs every required column; an update may carry only what changed. */
const missingFor = (cols: Column[], row: Record<string, Cell>) => cols.filter((c) => (c.notnull || c.pk) && (row[c.name] ?? null) === null).map((c) => c.name);

type Plan = { reject: string } | { unchanged: true } | { row: Record<string, Cell>; before?: Record<string, Cell> };
type Table = { name: string; cols: Column[]; keys: string[]; find: Database.Statement };
const same = (before: Record<string, Cell>, row: Record<string, Cell>) => Object.keys(row).every((k) => before[k] === row[k]);

/** What to do with one uploaded row: skip it with a reason, leave it, or write it as a new or updated row. */
function plan(t: Table, raw: Record<string, unknown>): Plan {
  const shaped = shape(t.cols, raw);
  if (typeof shaped === "string") return { reject: shaped };
  const keyMissing = t.keys.filter((k) => (shaped[k] ?? null) === null);
  if (keyMissing.length) return { reject: M.missingFields(keyMissing.join(", ")) };
  const before = t.find.get(...t.keys.map((k) => shaped[k])) as Record<string, Cell> | undefined;
  const row = DERIVED[t.name]?.(shaped, before) ?? shaped;
  const missing = before ? [] : missingFor(t.cols, row);
  if (missing.length) return { reject: M.missingFields(missing.join(", ")) };
  return before && same(before, row) ? { unchanged: true } : { row, before };
}

function upsertTable(d: Database.Database, batch: Batch): TableReport {
  const cols = d.prepare(`PRAGMA table_info(${q(batch.table)})`).all() as Column[];
  const keys = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  const t: Table = { name: batch.table, cols, keys, find: d.prepare(`SELECT * FROM ${q(batch.table)} WHERE ${keys.map((k) => `${q(k)} = ?`).join(" AND ")}`) };
  const report: TableReport = { table: batch.table, source: batch.source, added: 0, updated: 0, unchanged: 0, rejected: [], changes: [] };
  batch.rows.forEach((raw, i) => {
    const p = plan(t, raw);
    if ("reject" in p) { report.rejected.push({ row: i + 1, reason: p.reject }); return; }
    if ("unchanged" in p) { report.unchanged++; return; }
    try {
      d.transaction(() => write(d, batch.table, p.row, keys, !!p.before))();
      report[p.before ? "updated" : "added"]++;
      report.changes.push(changeOf(keys, p.row, p.before));
    }
    catch (err) { report.rejected.push({ row: i + 1, reason: refusal(err) }); }
  });
  report.rejected = report.rejected.slice(0, INGEST.rejectedShown);
  return report;
}

function changeOf(keys: string[], row: Record<string, Cell>, before?: Record<string, Cell>): RowChange {
  const key = keys.map((k) => String(row[k])).join("/");
  if (!before) return { key, after: row };
  const changed = Object.keys(row).filter((k) => before[k] !== row[k]);
  return { key, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, row[k]])) };
}

function write(d: Database.Database, table: string, row: Record<string, Cell>, keys: string[], exists: boolean): void {
  const names = Object.keys(row);
  if (!exists) { d.prepare(`INSERT INTO ${q(table)} (${names.map(q).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...names.map((n) => row[n])); return; }
  const sets = names.filter((n) => !keys.includes(n));
  d.prepare(`UPDATE ${q(table)} SET ${sets.map((n) => `${q(n)} = ?`).join(", ")} WHERE ${keys.map((k) => `${q(k)} = ?`).join(" AND ")}`).run(...sets.map((n) => row[n]), ...keys.map((k) => row[k]));
}

/** The ERP's own refusal in words a person can act on. */
function refusal(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/FOREIGN KEY/i.test(msg)) return M.unknownReference;
  if (/CHECK/i.test(msg)) return M.failedCheck;
  return msg;
}

export function loadBatches(d: Database.Database, batches: Batch[]): TableReport[] {
  const sorted = [...batches].sort((a, b) => ORDER.indexOf(a.table) - ORDER.indexOf(b.table));
  return sorted.map((b) => upsertTable(d, b));
}
