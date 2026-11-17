import type { AccessTouch, AccessTrail, ModelUse } from "../platform/contract.ts";
// Domain-neutral shapes. Every domain maps its data onto these; the UI renders them all.

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
export type Field = { label: string; value: string };
export type Money = { amount: number; currency: string };
/** Opaque payload for the domain's signature visual (src/domain/Signature.tsx). */
export type Visual = { kind: string; data: Record<string, unknown> };

export type Item = {
  id: string; title: string; subtitle?: string; meta?: string;
  status?: { label: string; tone: Tone };
  fields: Field[]; price?: Money | null; image?: string; tags?: string[];
  visual?: Visual;
  /** When it happens or is due (ISO 8601). Feeds the home agenda. */
  at?: string;
  /** Primary button: sends `message` to the agent as the user's next turn. */
  action?: { label: string; message: string };
  /** Approver controls for a work item waiting on this user. The decision goes straight to the work API, never through the agent. */
  decide?: { workId: string; ref: string };
};

export type Step = { label: string; at: string | null; state: "done" | "current" | "pending" | "failed"; owner?: string; note?: string };
export type Metric = { label: string; value: string; delta?: string; tone?: Tone; series?: number[] };
/** What `domain.panel()` returns: the Inspector's home list and the data every home section draws from. */
export type PanelData = { title: string; hint: string; items: Item[]; metrics?: Metric[] };

export type ItemsResult = { id: string; kind: "items"; title: string; items: Item[]; source: "live" | "seeded" | "sample"; note?: string };
export type TimelineResult = { id: string; kind: "timeline"; title: string; subject: Item; steps: Step[] };
export type MetricsResult = { id: string; kind: "metrics"; title: string; metrics: Metric[]; note?: string };
/** Raw cell values, already masked by policy. Dates travel as ISO strings. */
export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
/** A column as the lego blocks see it: `role` comes from wiring (status, start, money...), `money` means an amount in the workspace currency. */
export type Column = { name: string; label: string; type: "text" | "number" | "date" | "bool" | "json"; role?: string; money?: boolean; /** ISO code when the amount is not in the workspace currency. */ currency?: string; /** Amounts from rows in several currencies: not one figure. */ mixedCurrency?: boolean };
/** Where a row opens: the agent is asked to open `key` in `system.object` with its related records. */
export type RowSource = { system: string; object: string; key: string };
/** A table of records or aggregate groups. Every lego block (table, board, calendar, chart, list) is assembled from one. */
export type RowsResult = { id: string; kind: "rows"; title: string; columns: Column[]; rows: Row[]; items: Item[]; source: ItemsResult["source"]; note?: string; open?: RowSource };
export type Result = ItemsResult | TimelineResult | MetricsResult | RowsResult;

export type ActionStatus = "pending" | "confirmed" | "cancelled" | "failed";
export type Action = {
  id: string; chatId: string; type: string; payload: Record<string, unknown>;
  title: string; summary: Field[]; consequence: string; danger: boolean;
  status: ActionStatus; receipt: Field[] | null; error: string | null; createdAt: string; decidedAt: string | null;
  /** Confirmed by the user but not yet run: an approver still has to decide. Cleared when the approver decides. */
  awaitingApproval?: boolean;
};

export type FormField = { name: string; label: string; kind: "text" | "number" | "date" | "choice"; options?: string[]; required?: boolean; value?: string };

/** How the agent wants a long result paged and ordered for this question; the block falls back to its own defaults. */
export type ViewHints = { pageSize?: number; sort?: { column: string; dir: "asc" | "desc" } };

export type Block =
  | ({ type: "list"; title: string; items: Item[]; source: ItemsResult["source"]; note?: string } & ViewHints)
  | { type: "compare"; title: string; items: Item[]; bestFor: Record<string, string> }
  | { type: "timeline"; title: string; subject: Item; steps: Step[] }
  | { type: "metrics"; title: string; metrics: Metric[]; note?: string }
  | { type: "confirm"; action: Action }
  | { type: "form"; id: string; title: string; fields: FormField[]; submitLabel: string }
  | { type: "choices"; id: string; question: string; options: string[] }
  | ({ type: "table"; title: string; columns: Column[]; rows: Row[]; open?: RowSource; note?: string } & ViewHints)
  | ({ type: "board"; title: string; lane: Column; label: Column; facts: Column[]; rows: Row[]; open?: RowSource; note?: string; laneOrder?: string[] } & ViewHints)
  | ({ type: "calendar"; title: string; start: Column; end?: Column; label: Column; facts: Column[]; rows: Row[]; open?: RowSource; note?: string } & ViewHints)
  | { type: "chart"; title: string; chart: "bar" | "line"; x: Column; y: Column[]; rows: Row[]; note?: string }
  /** Any catalog part (src/lib/lego): `component` names it, `data` is what its resolver produced. */
  | ({ type: "lego"; component: string; label: string; where: "canvas" | "chat"; title: string; data: unknown } & ViewHints)
  /** An answer the agent built from bricks (src/lib/bata): its tree, and the rows its bricks are bound to. */
  | { type: "bata"; title: string; where: "canvas" | "chat"; root: import("./bata/resolve.ts").ResolvedNode; data: import("./bata/eval.ts").DataMap }
  /** Several blocks arranged on one canvas screen. */
  | { type: "layout"; arrangement: "split" | "grid" | "tabs" | "stack"; title: string; children: Block[] };

export type TraceStep = { id: string; kind: "tool"; label: string; detail: string; status: "done" | "failed"; ms: number };

export type Message =
  | { id: string; role: "user"; text: string; at: string }
  | { id: string; role: "agent"; text: string; blocks: Block[]; trace: TraceStep[]; error: string | null; at: string; trail?: AccessTrail; sources?: Source[] };
/** An official web page the answer rests on, shown under it so the person can check it. */
export type Source = { url: string; title: string; host: string };

/** Chats belong to one user acting as one unit through one agent (Simpul). Older chats without them are hidden. */
export type ChatSummary = { id: string; title: string; createdAt: string; updatedAt: string; userId?: string; unitId?: string; projectId?: string };
/** `origin: "triage"` marks the agent's working transcript for one inbox email: kept for the audit, left out of chat history. */
export type Chat = ChatSummary & { sessionId: string | null; model: string; messages: Message[]; notes: string[]; origin?: "triage" };

export type StreamEvent =
  | { t: "chat"; id: string; title: string }
  | { t: "text"; d: string }
  /** The text so far was narration before a working step: the client drops it, the answer starts again. */
  | { t: "reset" }
  /** The agent's reasoning as it works, shown while the answer has not started; fresh starts a new thought. */
  | { t: "think"; d: string; fresh?: boolean }
  | { t: "step"; id: string; kind: "tool"; label: string; doneLabel: string; status: "running" | "done" | "failed"; detail?: string }
  | { t: "block"; block: Block }
  | { t: "error"; message: string }
  | { t: "touch"; touch: AccessTouch }
  | { t: "model"; model: ModelUse }
  | { t: "done"; message: Message };
