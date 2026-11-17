// The lego contract: one file per component, server side. A component declares what the agent passes (`input`),
// checks it against results the tools really produced (`resolve`), and hands the client plain data to draw.
// Values always come from tool data; the agent only names refs, columns and short labels.
import { z } from "zod";
import type { Column, Row, RowsResult } from "../types.ts";
import { LEN, PAGE } from "../../config/data.ts";
import { HINT } from "../../copy/agent.ts";
import { ERR } from "../../copy/server.ts";

export type Registry = { get(id: string): unknown };
export type Resolved<D> = { data: D; title: string } | { problem: string };

export type LegoSpec<S extends z.ZodRawShape = z.ZodRawShape, D = unknown> = {
  /** The block type the agent passes, e.g. "funnel". */
  name: string;
  /** Name shown on canvas tabs and chips, e.g. "Funnel". */
  label: string;
  /** Group in the catalog: data, chart, record, process, people, document, planning, layout... */
  group: string;
  /** canvas: shown on the agent's canvas (chip in chat). chat: asks the user something, stays in the conversation. */
  where: "canvas" | "chat";
  /** One line for the agent: when this block is the right shape. */
  use: string;
  /** Fields besides `type`. Keep names snake_case and describe each with .describe() when not obvious. */
  input: S;
  resolve: (input: z.infer<z.ZodObject<S>>, reg: Registry) => Resolved<D>;
};

// ---------- helpers every component uses ----------
export const ref = z.string().min(1).max(LEN.id).describe(HINT.refIdToolReturned);
export const col = z.string().min(1).max(LEN.key).describe(HINT.columnNameExactlyAs);
/** Rows per page for this question: small for "the top 3", larger for a work list to scan. */
export const pageSize = z.number().int().min(PAGE.min).max(PAGE.max).optional().describe(HINT.rowsPerPageThis);
export const heading = z.string().trim().min(1).max(LEN.label).optional().describe(HINT.blockTitleUserS);

/** Look up named columns in a rows result; the problem lists the real names. */
export function pick(r: RowsResult, names: Record<string, string | undefined>): Record<string, Column> | string {
  const out: Record<string, Column> = {};
  for (const [role, name] of Object.entries(names)) {
    if (name === undefined) continue;
    const c = r.columns.find((x) => x.name === name);
    if (!c) return ERR.columnNotHas(role, name, r.id, r.columns.map((x) => x.name).join(", "));
    out[role] = c;
  }
  return out;
}

export const numeric = (c: Column) => c.type === "number";
export const num = (v: Row[string]) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
export type { Column, Row, RowsResult };
