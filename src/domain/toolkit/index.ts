// The general toolkit every agent has, whatever its process: documents, messages, schedules, tasks, analysis,
// calendars and more. Each file exports tools (and action handlers for anything that changes state, which always
// goes through the user's confirmation). Data access comes in through `Access`, so these files never import the
// domain module and every read still passes the policy planner.
import type { ActionHandler } from "../../lib/actions.ts";
import type { DomainTool, ToolCtx } from "../../lib/domain.ts";
import type { Item, RowsResult } from "../../lib/types.ts";
import type { CatalogObject, Connection, Filter } from "../../platform/contract.ts";
import { work } from "./work.ts";

export type Access = {
  /** System code + object name (or label) to the catalog object, scope-checked. Throws a PolicyError the agent can read. */
  objectFor: (ctx: ToolCtx, system: string, object: string) => { conn: Connection; obj: CatalogObject };
  /** Governed read: policy filters, masking, audit and the access trail all apply. */
  readRows: (ctx: ToolCtx, conn: Connection, obj: CatalogObject, req: { columns?: string[]; filters?: Filter[]; sort?: { column: string; dir: "asc" | "desc" }; limit?: number }) => Promise<{ rows: Record<string, unknown>[]; total: number | null }>;
  /** Rows as a lego-ready result (save it with ctx.save). */
  recordsResult: (conn: Connection, obj: CatalogObject, rows: Record<string, unknown>[], title: string, note?: string) => Omit<RowsResult, "id">;
  toItem: (conn: Connection, obj: CatalogObject, row: Record<string, unknown>) => Item;
  /** Rows as compact text for the model, times in the company's zone. */
  rowsText: (rows: Record<string, unknown>[], tz: string, max?: number) => string;
};

export type Toolkit = { tools: DomainTool[]; actions: Record<string, ActionHandler> };
type Part = (a: Access) => Toolkit;

const PARTS: Part[] = [work];

export function makeToolkit(access: Access): Toolkit {
  const all = PARTS.map((p) => p(access));
  return { tools: all.flatMap((t) => t.tools), actions: Object.assign({}, ...all.map((t) => t.actions)) };
}
