// Reads whatever a person uploads into rows per ERP table: CSV files named after their table (the data pack's data/
// folder), JSON (an array named after its table, or one object of tables), a SQLite file with the ERP's tables, and
// emails (.eml, JSON lines, or an inbound_emails table). Nothing here touches the ERP.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { ERP_TABLES } from "../../config/erp.ts";
import { INGEST } from "../../config/orders.ts";
import { INGEST_TEXT as M } from "../../copy/orders.ts";
import { parseEml, parseJsonLine, type Parsed } from "./mail.ts";

export type Upload = { name: string; bytes: number; data: Buffer };
export type Batch = { table: string; source: string; rows: Record<string, unknown>[] };
export type Read = { batches: Batch[]; emails: { source: string; parsed: Parsed }[]; unreadable: { source: string; reason: string }[] };

const MB = 1_000_000;
const TABLES = new Set<string>(Object.values(ERP_TABLES));
const SQLITE_MAGIC = "SQLite format 3\u0000";
const empty = (): Read => ({ batches: [], emails: [], unreadable: [] });
const baseOf = (name: string) => path.basename(name).replace(/\.[^.]+$/, "").toLowerCase();
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const fail = (source: string, reason: string): Read => ({ ...empty(), unreadable: [{ source, reason }] });

const nextDelimiter = (text: string, from: number) => { const m = /[,\n]/g; m.lastIndex = from; return m.exec(text)?.index ?? text.length; };

/** One field from `i`: its value and where the comma or line break after it sits. Quotes may hold commas, breaks and "". */
function readField(text: string, i: number): [string, number] {
  if (text[i] !== '"') { const end = nextDelimiter(text, i); return [text.slice(i, end).replace(/\r$/, ""), end]; }
  let value = "", from = i + 1;
  for (;;) {
    const quote = text.indexOf('"', from);
    if (quote < 0) return [value + text.slice(from), text.length];
    value += text.slice(from, quote);
    if (text[quote + 1] !== '"') return [value, nextDelimiter(text, quote + 1)];
    value += '"'; from = quote + 2;
  }
}

/** RFC 4180 CSV. The first row names the columns; blank lines are skipped. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [[]];
  for (let i = 0; i < text.length;) {
    const [value, end] = readField(text, i);
    rows[rows.length - 1].push(value);
    if (text[end] === "\n") rows.push([]);
    i = end + 1;
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, n) => [k, r[n] ?? ""])));
}

/** An inbound_emails row in the ERP's own shape, as an email. */
const emailFromRow = (source: string, row: Record<string, unknown>) =>
  ({ source, parsed: parseJsonLine(JSON.stringify({ ...row, to: row.to ?? row.to_address, attachments: typeof row.attachments === "string" ? safeList(row.attachments) : row.attachments })) });
const safeList = (s: string) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return s ? [s] : []; } };

/** Rows for one table: emails go to the inbox path, other ERP tables become a batch, anything else is unknown. */
function tableRows(table: string, source: string, rows: Record<string, unknown>[]): Read {
  if (table === ERP_TABLES.inbox) return { ...empty(), emails: rows.map((r, i) => emailFromRow(`${source}:${i + 1}`, r)) };
  if (!TABLES.has(table)) return fail(source, M.unknownTable(table));
  return { ...empty(), batches: [{ table, source, rows }] };
}

const merge = (reads: Read[]): Read => ({ batches: reads.flatMap((r) => r.batches), emails: reads.flatMap((r) => r.emails), unreadable: reads.flatMap((r) => r.unreadable) });

function readJson(u: Upload): Read {
  const text = u.data.toString("utf8");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return readJsonLines(u); }
  if (Array.isArray(value)) return tableRows(baseOf(u.name), u.name, value as Record<string, unknown>[]);
  if (value && typeof value === "object") return merge(Object.entries(value).map(([k, v]) => (Array.isArray(v) ? tableRows(k.toLowerCase(), `${u.name}:${k}`, v) : fail(`${u.name}:${k}`, M.notRows))));
  return fail(u.name, M.notRows);
}

function readJsonLines(u: Upload): Read {
  const lines = u.data.toString("utf8").split("\n").map((l, i) => ({ l, i })).filter(({ l }) => l.trim());
  return { ...empty(), emails: lines.map(({ l, i }) => ({ source: `${u.name}:${i + 1}`, parsed: parseJsonLine(l) })) };
}

/** A SQLite file: every table that is one of the ERP's, read through a throwaway copy opened read-only. */
function readSqlite(u: Upload): Read {
  if (u.data.subarray(0, SQLITE_MAGIC.length).toString("latin1") !== SQLITE_MAGIC) return fail(u.name, M.notSqlite);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-upload-"));
  const file = path.join(dir, "upload.sqlite");
  fs.writeFileSync(file, u.data);
  const d = new Database(file, { readonly: true });
  try {
    const names = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    const known = names.filter((n) => TABLES.has(n.toLowerCase()));
    if (!known.length) return fail(u.name, M.noErpTables);
    return merge(known.map((n) => tableRows(n.toLowerCase(), `${u.name}:${n}`, d.prepare(`SELECT * FROM "${n.replace(/"/g, '""')}"`).all() as Record<string, unknown>[])));
  } finally {
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const READERS: Record<string, (u: Upload) => Read> = {
  eml: (u) => ({ ...empty(), emails: [{ source: u.name, parsed: parseEml(u.data.toString("utf8")) }] }),
  jsonl: readJsonLines,
  json: readJson,
  csv: (u) => tableRows(baseOf(u.name), u.name, parseCsv(u.data.toString("utf8"))),
  sqlite: readSqlite,
  db: readSqlite,
};

const limitOf = (ext: string) => (ext === "sqlite" || ext === "db" ? INGEST.databaseBytesMax : INGEST.fileBytesMax);

export function readUpload(u: Upload): Read {
  const ext = extOf(u.name);
  const reader = READERS[ext];
  if (!reader) return fail(u.name, M.unknownType);
  if (u.bytes > limitOf(ext)) return fail(u.name, M.tooBig(limitOf(ext) / MB));
  try { return reader(u); } catch { return fail(u.name, M.unreadable); }
}

export const readUploads = (uploads: Upload[]): Read => merge(uploads.map(readUpload));
