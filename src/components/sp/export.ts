// Turns what the canvas shows into a spreadsheet file: raw numbers (Excel sums them), dates as yyyy-mm-dd, statuses in words.
import type { Block, Cell, Column, Row } from "../../lib/types.ts";
import { statusLabel } from "../../lib/values.ts";
import { EXPORT } from "../../config/ui.ts";
import { COMMON } from "../../copy/ui-common.ts";

type Sheet = { title: string; columns: Column[]; rows: Row[] };

const isCol = (c: unknown): c is Column => !!c && typeof c === "object" && typeof (c as Column).name === "string" && typeof (c as Column).label === "string";

/** Every table-shaped part of a block; layouts give one sheet per child. Parts without rows (a document, a form) give none. */
export function sheetsOf(b: Block): Sheet[] {
  switch (b.type) {
    case "table": return [{ title: b.title, columns: b.columns, rows: b.rows }];
    case "board": return [{ title: b.title, columns: [b.label, b.lane, ...b.facts], rows: b.rows }];
    case "calendar": return [{ title: b.title, columns: [b.label, b.start, ...(b.end ? [b.end] : []), ...b.facts], rows: b.rows }];
    case "chart": return [{ title: b.title, columns: [b.x, ...b.y], rows: b.rows }];
    case "layout": return b.children.flatMap(sheetsOf);
    // A built answer exports every dataset its bricks are bound to.
    case "bata": return Object.values(b.data).map((d) => ({ title: d.title, columns: d.columns, rows: d.rows }));
    case "lego": {
      const d = b.data as { columns?: unknown; rows?: unknown };
      return Array.isArray(d?.columns) && d.columns.every(isCol) && Array.isArray(d.rows) ? [{ title: b.title, columns: d.columns, rows: d.rows as Row[] }] : [];
    }
    default: return [];
  }
}

function cellText(c: Column, v: Cell | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? COMMON.yes : COMMON.no;
  if (typeof v === "number") return String(v);
  if (c.role === "status") return statusLabel(v);
  return /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z?$/.test(v) ? v.slice(0, 10) : v;
}

const quote = (s: string) => (/[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s);

/** Comma-separated with a BOM, which Excel in a US locale opens straight into columns. */
export function toCsv(sheets: Sheet[]): string {
  const parts = sheets.map((s) => {
    const head = s.columns.map((c) => quote(c.label)).join(",");
    const body = s.rows.map((r) => s.columns.map((c) => quote(cellText(c, r[c.name]))).join(","));
    return [...(sheets.length > 1 ? [quote(s.title)] : []), head, ...body].join("\r\n");
  });
  return `﻿${parts.join("\r\n\r\n")}\r\n`;
}

export function fileName(title: string): string {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, EXPORT.fileNameMax) || COMMON.fileFallback;
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}
