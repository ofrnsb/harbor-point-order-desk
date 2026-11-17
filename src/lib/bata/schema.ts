// Bata: the bricks the agent builds every answer from. A small set of layout, text, figure, mark, repeat, chart and
// action bricks; the agent assembles them into whatever shape the question needs, a different shape each time.
// Words are the agent's; every number and value is bound to a column of a tool result, so nothing can be invented.
import { z } from "zod";
import { BATA, LEN, PAGE, TOP_N_MAX } from "../../config/data.ts";
import { HINT } from "../../copy/agent.ts";

export const MAX_DEPTH = BATA.maxDepth;
export const MAX_NODES = BATA.maxNodes;

const col = z.string().trim().min(1).max(LEN.key).describe(HINT.columnNameExactlyAs);
const ref = z.string().trim().min(1).max(LEN.id).describe(HINT.refIdRowsResult);
const words = z.string().max(LEN.note);

// ---------- Rows: which rows a brick works on ----------
export const Cond = z.object({
  col,
  op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "empty", "not_empty"]),
  value: z.union([z.string().max(LEN.line), z.number().finite(), z.boolean(), z.null(), z.array(z.union([z.string().max(LEN.line), z.number().finite()])).max(BATA.filterValues)]).optional(),
});
export const RowsRef = z.union([
  ref,
  z.object({
    ref,
    where: z.array(Cond).max(BATA.where).optional(),
    sort: z.object({ by: col, dir: z.enum(["asc", "desc"]) }).optional(),
    limit: z.number().int().min(1).max(TOP_N_MAX).optional().describe(HINT.onlyWhenQuestionAsks),
  }),
]);
export type Cond = z.infer<typeof Cond>;
export type RowsRef = z.infer<typeof RowsRef>;

// ---------- Values: bound to data, never typed in ----------
export type Val =
  | { bind: string }
  | { agg: "sum" | "avg" | "count" | "min" | "max" | "first" | "last" | "distinct"; of?: string; rows?: RowsRef }
  | { calc: "ratio" | "diff" | "pct_change" | "share" | "pct"; a: Val; b: Val };
export const Val: z.ZodType<Val> = z.lazy(() => z.union([
  z.object({ bind: col }),
  z.object({ agg: z.enum(["sum", "avg", "count", "min", "max", "first", "last", "distinct"]), of: col.optional(), rows: RowsRef.optional() }),
  z.object({ calc: z.enum(["ratio", "diff", "pct_change", "share", "pct"]), a: Val, b: Val }),
]));
/** Words the agent writes, with {column} placeholders filled from the current row; or a bound value. */
export const Text = z.union([words, Val]);
export type Text = z.infer<typeof Text>;

const tone = z.enum(["default", "muted", "accent", "good", "warn", "bad"]);
const gap = z.enum(["s", "m", "l"]);

// ---------- Bricks ----------
export type Node =
  | { brick: "stack" | "row"; gap?: "s" | "m" | "l"; align?: "start" | "center" | "end" | "between"; rows?: RowsRef; children: Node[] }
  | { brick: "grid"; columns?: number; gap?: "s" | "m" | "l"; rows?: RowsRef; children: Node[] }
  | { brick: "split"; ratio?: "1:1" | "2:1" | "1:2" | "3:2" | "2:3"; rows?: RowsRef; children: Node[] }
  | { brick: "section"; title?: Text; note?: Text; focus?: boolean; rows?: RowsRef; children: Node[] }
  | { brick: "tabs"; tabs: { label: string; children: Node[] }[] }
  | { brick: "divider" }
  | { brick: "heading"; text: Text; level?: 1 | 2 | 3 }
  | { brick: "text"; text: Text; tone?: z.infer<typeof tone>; size?: "s" | "m" | "l" }
  | { brick: "callout"; text: Text; title?: Text; tone?: z.infer<typeof tone> }
  | { brick: "figure"; value: Val; label?: Text; size?: "m" | "l" | "xl"; delta?: Val; good?: "up" | "down"; note?: Text }
  | { brick: "stat"; label: Text; value: Val | Text }
  | { brick: "bar"; value: Val; max?: Val; target?: Val; label?: Text; show?: "value" | "pct" | "none"; tone?: z.infer<typeof tone> }
  | { brick: "ring"; value: Val; max?: Val; label?: Text; note?: Text; tone?: z.infer<typeof tone>; size?: "m" | "l" }
  | { brick: "status"; value: Val | Text }
  | { brick: "stamp"; value: Val | Text; meta?: Text; size?: "s" | "l" }
  | { brick: "avatar"; name: Text }
  | { brick: "parts"; rows: RowsRef; label: string; value: string }
  | { brick: "badge"; text: Text; tone?: z.infer<typeof tone> }
  | { brick: "spark"; rows: RowsRef; x: string; y: string }
  | { brick: "each"; rows: RowsRef; item: Node; as?: "rows" | "cards" | "grid" | "chips"; columns?: number; page_size?: number; group_by?: string; empty?: string; rank?: boolean }
  | { brick: "table"; rows: RowsRef; columns: { header: string; value: Val | Text; align?: "start" | "end"; strong?: boolean; bar?: boolean }[]; page_size?: number; total?: boolean; empty?: string }
  | { brick: "chart"; rows: RowsRef; x: string; marks: { type: "bar" | "line" | "area" | "point"; y: string; label?: string }[]; stacked?: boolean; height?: "s" | "m" | "l"; note?: { at: string; text: string } }
  | { brick: "action"; label: Text; send?: Text; open?: boolean; kind?: "primary" | "secondary" }
  | { brick: "decide"; work: string; ref?: string };

const kids = (n: number) => z.array(z.lazy(() => Node)).min(1).max(n);
export const Node: z.ZodType<Node> = z.lazy(() => z.discriminatedUnion("brick", [
  z.object({ brick: z.literal("stack"), gap: gap.optional(), align: z.enum(["start", "center", "end", "between"]).optional(), rows: RowsRef.optional(), children: kids(BATA.children) }),
  z.object({ brick: z.literal("row"), gap: gap.optional(), align: z.enum(["start", "center", "end", "between"]).optional(), rows: RowsRef.optional(), children: kids(BATA.rowChildren) }),
  z.object({ brick: z.literal("grid"), columns: z.number().int().min(1).max(BATA.gridColumns).optional(), gap: gap.optional(), rows: RowsRef.optional(), children: kids(BATA.children) }),
  z.object({ brick: z.literal("split"), ratio: z.enum(["1:1", "2:1", "1:2", "3:2", "2:3"]).optional(), rows: RowsRef.optional(), children: kids(2) }),
  z.object({ brick: z.literal("section"), title: Text.optional(), note: Text.optional(), focus: z.boolean().optional(), rows: RowsRef.optional(), children: kids(BATA.children) }),
  z.object({ brick: z.literal("tabs"), tabs: z.array(z.object({ label: z.string().trim().min(1).max(LEN.id), children: kids(BATA.children) })).min(2).max(BATA.tabs) }),
  z.object({ brick: z.literal("divider") }),
  z.object({ brick: z.literal("heading"), text: Text, level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }),
  z.object({ brick: z.literal("text"), text: Text, tone: tone.optional(), size: z.enum(["s", "m", "l"]).optional() }),
  z.object({ brick: z.literal("callout"), text: Text, title: Text.optional(), tone: tone.optional() }),
  z.object({ brick: z.literal("figure"), value: Val, label: Text.optional(), size: z.enum(["m", "l", "xl"]).optional(), delta: Val.optional(), good: z.enum(["up", "down"]).optional(), note: Text.optional() }),
  z.object({ brick: z.literal("stat"), label: Text, value: z.union([Val, words]) }),
  z.object({ brick: z.literal("bar"), value: Val, max: Val.optional(), target: Val.optional().describe(HINT.barTarget), label: Text.optional(), show: z.enum(["value", "pct", "none"]).optional(), tone: tone.optional() }),
  z.object({ brick: z.literal("ring"), value: Val, max: Val.optional(), label: Text.optional(), note: Text.optional(), tone: tone.optional(), size: z.enum(["m", "l"]).optional() }),
  z.object({ brick: z.literal("status"), value: z.union([Val, words]) }),
  z.object({ brick: z.literal("stamp"), value: z.union([Val, words]), meta: Text.optional(), size: z.enum(["s", "l"]).optional().describe(HINT.stampSize) }),
  z.object({ brick: z.literal("avatar"), name: Text }),
  z.object({ brick: z.literal("parts"), rows: RowsRef, label: col, value: col.describe(HINT.partsValue) }),
  z.object({ brick: z.literal("badge"), text: Text, tone: tone.optional() }),
  z.object({ brick: z.literal("spark"), rows: RowsRef, x: col, y: col }),
  z.object({
    brick: z.literal("each"), rows: RowsRef, item: z.lazy(() => Node), as: z.enum(["rows", "cards", "grid", "chips"]).optional(), columns: z.number().int().min(1).max(BATA.eachColumns).optional(),
    page_size: z.number().int().min(PAGE.min).max(PAGE.max).optional(), group_by: col.optional(), empty: words.optional(), rank: z.boolean().optional().describe(HINT.eachRank),
  }),
  z.object({
    brick: z.literal("table"), rows: RowsRef,
    columns: z.array(z.object({ header: z.string().trim().min(1).max(LEN.name), value: z.union([Val, words]), align: z.enum(["start", "end"]).optional(), strong: z.boolean().optional(), bar: z.boolean().optional().describe(HINT.tableBar) })).min(1).max(BATA.tableColumns),
    page_size: z.number().int().min(PAGE.min).max(PAGE.max).optional(), total: z.boolean().optional(), empty: words.optional(),
  }),
  z.object({ brick: z.literal("chart"), rows: RowsRef, x: col, marks: z.array(z.object({ type: z.enum(["bar", "line", "area", "point"]), y: col, label: z.string().max(LEN.id).optional() })).min(1).max(BATA.marks), stacked: z.boolean().optional(), height: z.enum(["s", "m", "l"]).optional(), note: z.object({ at: z.string().trim().min(1).max(LEN.id), text: z.string().trim().min(1).max(LEN.label) }).optional().describe(HINT.chartNote) }),
  z.object({ brick: z.literal("action"), label: Text, send: Text.optional(), open: z.boolean().optional(), kind: z.enum(["primary", "secondary"]).optional() }),
  z.object({ brick: z.literal("decide"), work: col.describe(HINT.columnHoldingWorkItem), ref: col.optional() }),
])) as z.ZodType<Node>;

/** The present-tool input for a built answer. */
export const BataInput = z.object({
  type: z.literal("bata"),
  title: z.string().trim().min(1).max(LEN.label).describe(HINT.shortTitleUserS),
  where: z.enum(["canvas", "chat"]).optional().describe(HINT.canvasAnythingWithData),
  root: Node,
});
export type BataInput = z.infer<typeof BataInput>;
