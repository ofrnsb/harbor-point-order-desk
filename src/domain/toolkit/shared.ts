
import type { ToolCtx } from "../../lib/domain.ts";
import type { Cell, Column, Item, Row, RowsResult } from "../../lib/types.ts";
import type { Owned } from "./records.ts";
import { SHARED } from "../../copy/domain.ts";
import { ID_HEX_CHARS, ITEM_FIELDS, ITEM_ID_CHARS, REF_RAND_CHARS } from "../../config/domain.ts";

/** A saved rows result by ref, or an Error whose message tells the agent what went wrong. */
export function rowsRef(ctx: ToolCtx, ref: string): RowsResult {
  const r = ctx.result(ref);
  if (!r) throw new Error(SHARED.refMissing(ref));
  if (r.kind !== "rows") throw new Error(SHARED.refNotRows(ref, r.kind));
  return r;
}

export function columnOf(r: RowsResult, name: string, need?: "number"): Column {
  const c = r.columns.find((x) => x.name === name);
  if (!c) throw new Error(SHARED.columnMissing(name, r.id, r.columns.map((x) => x.name).join(SHARED.columnSep)));
  if (need === "number" && c.type !== "number" && !r.rows.some((row) => toNum(row[name]) !== null)) throw new Error(SHARED.notNumber(name));
  return c;
}

export const toNum = (v: Cell | undefined): number | null =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;

export const owner = (ctx: ToolCtx, id: string): Owned => ({
  id, tenantId: ctx.eff.tenant.id, unitId: ctx.eff.unit.id, userId: ctx.principal.userId, userName: ctx.eff.user.name, createdAt: new Date().toISOString(),
});
export type OwnerPayload = { tenantId: string; unitId: string; userId: string; userName: string };
export const ownerPayload = (ctx: ToolCtx): OwnerPayload => ({ tenantId: ctx.eff.tenant.id, unitId: ctx.eff.unit.id, userId: ctx.principal.userId, userName: ctx.eff.user.name });

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, ID_HEX_CHARS)}`;
/** Human reference, e.g. TSK-2611-4F2A. */
export const newRef = (prefix: string, now = new Date()) =>
  `${prefix}-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${crypto.randomUUID().slice(0, REF_RAND_CHARS).toUpperCase()}`;

/** A rows result built by a tool (no source system to open rows in). */
export function makeRows(title: string, columns: Column[], rows: Row[], note?: string): Omit<RowsResult, "id"> {
  const label = columns.find((c) => c.type === "text") ?? columns[0];
  const items: Item[] = rows.map((r, i) => ({
    id: `${title}:${i}`.slice(0, ITEM_ID_CHARS),
    title: label ? String(r[label.name] ?? SHARED.empty) : SHARED.rowN(i + 1),
    fields: columns.filter((c) => c !== label).slice(0, ITEM_FIELDS).map((c) => ({ label: c.label, value: r[c.name] === null || r[c.name] === undefined ? SHARED.empty : String(r[c.name]) })),
  }));
  return { kind: "rows", title, columns, rows, items, source: "live", ...(note ? { note } : {}) };
}

export const col = (name: string, label: string, type: Column["type"] = "text", extra: Partial<Column> = {}): Column => ({ name, label, type, ...extra });
