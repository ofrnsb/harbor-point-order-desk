// Every brick the agent builds answers from, on its own, in each of its variants and edge cases: the words and figures
// it can be given, nothing, too much, right-to-left. Each case goes through the same schema and resolver as the agent's
// call, so the gallery shows exactly what the agent's output looks like, brick by brick.
import { BataInput, type Node } from "../../lib/bata/schema.ts";
import { resolveBata } from "../../lib/bata/resolve.ts";
import type { Block } from "../../lib/types.ts";
import { C, FIXTURE_RESULTS, LONG, RTL, rs } from "./fixtures.ts";

const day = (d: number) => new Date(Date.UTC(2026, 10, 11 + d)).toISOString().slice(0, 10);
/** Receivables by age, summed from the same invoices the other cases read, so the parts agree with the table. */
const INVOICES = (FIXTURE_RESULTS.get("r_inv") as { rows: Record<string, unknown>[] }).rows;
const AGES = [["1–30 days", 1, 30], ["31–60 days", 31, 60], ["61–90 days", 61, 90], ["> 90 days", 91, 9999]] as const;
const aging = AGES.map(([bucket, lo, hi]) => ({ bucket, amount: INVOICES.filter((r) => Number(r.days_late) >= lo && Number(r.days_late) <= hi).reduce((a, r) => a + Math.max(0, Number(r.outstanding) || 0), 0) }));
const REG = new Map<string, unknown>([
  ...FIXTURE_RESULTS,
  ["r_aging", rs("r_aging", "Receivables aging", [C("bucket", "Age", "text"), C("amount", "Outstanding", "number", { money: true })], aging)],
  ["r_flat", rs("r_flat", "Flat", [C("d", "Date", "date"), C("v", "Value", "number")], Array.from({ length: 12 }, (_, i) => ({ d: day(i), v: 500 })))],
  ["r_point", rs("r_point", "One point", [C("d", "Date", "date"), C("v", "Value", "number")], [{ d: day(0), v: 42 }])],
  ["r_swing", rs("r_swing", "Up and down", [C("m", "Month", "text"), C("v", "Profit", "number", { money: true })], ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m, i) => ({ m, v: [120, -80, 40, -150, 210, -20][i] * 50 })))],
  ["r_many", rs("r_many", "40 days", [C("d", "Date", "date"), C("v", "Transactions", "number")], Array.from({ length: 40 }, (_, i) => ({ d: day(i - 40), v: 200 + Math.round(Math.sin(i / 3) * 80) + i * 3 })))],
  ["r_work", rs("r_work", "Awaiting approval", [C("work_id", "Work", "text", { role: "key" }), C("ref", "Number", "text"), C("title", "Request", "text", { role: "title" })], [{ work_id: "wi_gallery", ref: "BLK-2611-A1B2C3", title: "Release credit hold on account 4417" }])],
]);
const reg = { get: (id: string) => REG.get(id) };

export type BrickCase = { id: string; label: string; block: Block | null; problem?: string };
export type BrickGroup = { brick: Node["brick"]; title: string; about: string; cases: BrickCase[] };

function build(brick: string, i: number, label: string, root: unknown): BrickCase {
  const id = `${brick}-${i + 1}`;
  const parsed = BataInput.safeParse({ type: "bata", title: label, root });
  if (!parsed.success) return { id, label, block: null, problem: `${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
  const r = resolveBata(parsed.data, reg);
  return r.block ? { id, label, block: r.block } : { id, label, block: null, problem: r.problems[0] ?? "no block" };
}

const sum = (of: string, rows = "r_sales") => ({ agg: "sum", of, rows });
const t = (text: string) => ({ brick: "text", text });
const tones = ["default", "muted", "accent", "good", "warn", "bad"] as const;
const PARA = "Past-due receivables rose 12% from last month, mostly from wholesale customers in Connecticut. Three customers make up more than half the balance, and two of them have reached dunning level three, so new shipments are on hold until a payment comes in.";

const GROUPS: { brick: Node["brick"]; title: string; about: string; cases: [string, unknown][] }[] = [
  { brick: "heading", title: "Heading", about: "A title inside an answer, three levels.", cases: [
    ["Level 1", { brick: "heading", text: "Past-due receivables", level: 1 }],
    ["Level 2", { brick: "heading", text: "Past-due receivables", level: 2 }],
    ["Level 3", { brick: "heading", text: "Past-due receivables", level: 3 }],
    ["Very long", { brick: "heading", text: LONG, level: 2 }],
    ["Right to left", { brick: "heading", text: RTL, level: 2 }],
  ] },
  { brick: "text", title: "Text", about: "Words, in three sizes and six tones; a bound value; a paragraph.", cases: [
    ...(["s", "m", "l"] as const).map((size) => [`Size ${size}`, { brick: "text", text: "Balance fell this week.", size }] as [string, unknown]),
    ...tones.map((tone) => [`Tone ${tone}`, { brick: "text", text: "Balance fell this week.", tone }] as [string, unknown]),
    ["Bound value", { brick: "text", text: sum("actual") }],
    ["Paragraph", { brick: "text", text: PARA }],
    ["One unbroken word", { brick: "text", text: "INV/2026/00001/PVD/WHOLESALE/BRIGHTLINE-SUPPLY/SECOND-REVISION-FINAL" }],
    ["Right to left", { brick: "text", text: `${RTL} — ${RTL}` }],
  ] },
  { brick: "callout", title: "Callout", about: "A message that needs attention, in each tone, with and without a title.", cases: [
    ...tones.map((tone) => [`Tone ${tone}`, { brick: "callout", title: "Credit limit exceeded", text: "Two customers went over their limit.", tone }] as [string, unknown]),
    ["No title", { brick: "callout", text: "Newark branch data has not come in today.", tone: "warn" }],
    ["Long", { brick: "callout", title: LONG, text: PARA, tone: "accent" }],
  ] },
  { brick: "figure", title: "Figure", about: "One number that matters, with its change and a note.", cases: [
    ...(["m", "l", "xl"] as const).map((size) => [`Size ${size}`, { brick: "figure", label: "Actual", value: sum("actual"), size }] as [string, unknown]),
    ["Up is good", { brick: "figure", label: "Actual", value: sum("actual"), delta: { calc: "diff", a: sum("actual"), b: sum("last_year") }, good: "up", note: "vs last year" }],
    ["Down is good", { brick: "figure", label: "Cost", value: sum("cost", "r_month"), delta: { calc: "diff", a: sum("cost", "r_month"), b: sum("revenue", "r_month") }, good: "down" }],
    ["Negative", { brick: "figure", label: "February profit", value: { agg: "min", of: "v", rows: "r_swing" } }],
    ["Count", { brick: "figure", label: "Late invoices", value: { agg: "count", rows: "r_inv" } }],
    ["Nothing to count", { brick: "figure", label: "Invoices", value: { agg: "sum", of: "outstanding", rows: "r_none" } }],
    ["Very long label", { brick: "figure", label: LONG, value: sum("actual"), note: LONG }],
  ] },
  { brick: "stat", title: "Stat", about: "A label and its value, small, for facts beside each other.", cases: [
    ["Money", { brick: "stat", label: "Target", value: sum("target") }],
    ["Words", { brick: "stat", label: "Status", value: "On hold" }],
    ["Percent", { brick: "stat", label: "Attainment", value: { calc: "pct", a: sum("actual"), b: sum("target") } }],
    ["Long", { brick: "stat", label: LONG, value: LONG }],
  ] },
  { brick: "bar", title: "Bar", about: "A share as a bar: value, percent or no figure, in each tone.", cases: [
    ["Value", { brick: "bar", label: "Attainment", value: sum("actual"), max: sum("target") }],
    ["Percent", { brick: "bar", label: "Attainment", value: sum("actual"), max: sum("target"), show: "pct" }],
    ["No figure", { brick: "bar", label: "Attainment", value: sum("actual"), max: sum("target"), show: "none" }],
    ...tones.slice(2).map((tone) => [`Tone ${tone}`, { brick: "bar", label: "Attainment", value: sum("actual"), max: sum("target"), show: "pct", tone }] as [string, unknown]),
    ["Over the max", { brick: "bar", label: "Spending", value: sum("target"), max: sum("actual"), show: "pct", tone: "bad" }],
    ["Zero", { brick: "bar", label: "Empty", value: { agg: "count", rows: "r_none" }, max: sum("target") }],
    ["No label", { brick: "bar", value: sum("actual"), max: sum("target") }],
    ["Long label", { brick: "bar", label: LONG, value: sum("actual"), max: sum("target"), show: "pct" }],
    ["Against a target", { brick: "stack", rows: { ref: "r_sales", where: [{ col: "branch", op: "eq", value: "Providence" }] }, children: [{ brick: "bar", label: "{branch}", value: { bind: "actual" }, target: { bind: "target" } }] }],
    ["Target beaten", { brick: "stack", rows: { ref: "r_sales", where: [{ col: "branch", op: "eq", value: "Hartford" }] }, children: [{ brick: "bar", label: "{branch}", value: { bind: "actual" }, target: { bind: "target" } }] }],
    ["Not in yet", { brick: "stack", rows: { ref: "r_sales", where: [{ col: "branch", op: "eq", value: "Baltimore" }] }, children: [{ brick: "bar", label: "{branch}", value: { bind: "actual" }, target: { bind: "target" } }] }],
  ] },
  { brick: "parts", title: "Parts", about: "One whole and its parts, as one segmented capsule with each part named.", cases: [
    ["Receivables by age", { brick: "parts", rows: "r_aging", label: "bucket", value: "amount" }],
    ["Many parts fold", { brick: "parts", rows: "r_sales", label: "branch", value: "target" }],
    ["No rows", { brick: "stack", children: [t("No parts."), { brick: "parts", rows: "r_none", label: "customer", value: "outstanding" }] }],
  ] },
  { brick: "avatar", title: "Avatar", about: "A person, by their initials.", cases: [
    ["Name", { brick: "row", gap: "s", children: [{ brick: "avatar", name: "Megan Sullivan" }, t("Megan Sullivan")] }],
    ["Long", { brick: "row", gap: "s", children: [{ brick: "avatar", name: LONG }, t(LONG)] }],
    ["Right to left", { brick: "row", gap: "s", children: [{ brick: "avatar", name: RTL }, t(RTL)] }],
  ] },
  { brick: "ring", title: "Ring", about: "A share drawn as an arc, two sizes.", cases: [
    ["Size m", { brick: "ring", label: "Attainment", value: sum("actual"), max: sum("target"), size: "m" }],
    ["Size l, note", { brick: "ring", label: "Attainment", value: sum("actual"), max: sum("target"), size: "l", note: "of this month's target" }],
    ...tones.slice(3).map((tone) => [`Tone ${tone}`, { brick: "ring", label: "Attainment", value: sum("actual"), max: sum("target"), tone }] as [string, unknown]),
    ["Zero", { brick: "ring", label: "Empty", value: { agg: "count", rows: "r_none" }, max: sum("target") }],
    ["Over the max", { brick: "ring", label: "Spending", value: sum("target"), max: sum("actual"), tone: "bad" }],
    ["Long label", { brick: "ring", label: LONG, value: sum("actual"), max: sum("target"), note: LONG }],
  ] },
  { brick: "status", title: "Status", about: "A record's state in words, coloured by what it means.", cases: [
    ...["open", "submitted", "approved", "rejected", "paid", "overdue", "Temporarily on hold"].map((v) => [v, { brick: "status", value: v }] as [string, unknown]),
    ["Long", { brick: "status", value: LONG }],
  ] },
  { brick: "stamp", title: "Stamp", about: "A decision's mark: its seal, the decision, its reference.", cases: [
    ...["waiting", "approved", "done", "rejected", "failed", "cancelled"].map((v) => [v, { brick: "stamp", value: v, meta: "BLK-2611-A1B2C3" }] as [string, unknown]),
    ["No reference", { brick: "stamp", value: "approved" }],
    ["Long reference", { brick: "stamp", value: "approved", meta: LONG }],
    ...["approved", "rejected", "waiting"].map((v) => [`Seal, ${v}`, { brick: "stamp", value: v, meta: "Megan Sullivan · Nov 14, 2026, 9:14 AM", size: "l" }] as [string, unknown]),
  ] },
  { brick: "badge", title: "Badge", about: "A short tag, in each tone.", cases: [
    ...tones.map((tone) => [`Tone ${tone}`, { brick: "badge", text: "Wholesale", tone }] as [string, unknown]),
    ["Long", { brick: "badge", text: LONG }],
    ["Right to left", { brick: "badge", text: RTL }],
  ] },
  { brick: "spark", title: "Spark", about: "A small trend line without axes.", cases: [
    ["40 points", { brick: "spark", rows: "r_many", x: "d", y: "v" }],
    ["Up and down, negative", { brick: "spark", rows: "r_swing", x: "m", y: "v" }],
    ["Flat", { brick: "spark", rows: "r_flat", x: "d", y: "v" }],
    ["One point", { brick: "spark", rows: "r_point", x: "d", y: "v" }],
    ["No rows", { brick: "spark", rows: "r_none", x: "due_date", y: "outstanding" }],
  ] },
  { brick: "each", title: "Each", about: "Repeats one brick per row: as rows, cards, a grid or chips; grouped; paged; empty.", cases: [
    ["Rows, 150", { brick: "each", rows: "r_inv", item: { brick: "row", children: [t("{customer}"), { brick: "text", text: { bind: "due_date" }, tone: "muted" }, { brick: "text", text: { bind: "outstanding" } }, { brick: "status", value: { bind: "status" } }] } }],
    ["Cards", { brick: "each", rows: "r_sales", as: "cards", item: { brick: "stack", gap: "s", children: [t("{branch}"), { brick: "figure", value: { bind: "actual" }, label: "Actual" }, { brick: "status", value: { bind: "status" } }] } }],
    ["Grid, 4 columns", { brick: "each", rows: "r_sales", as: "grid", columns: 4, item: { brick: "stat", label: "{branch}", value: { bind: "actual" } } }],
    ["Chips", { brick: "each", rows: "r_sales", as: "chips", item: { brick: "badge", text: "{branch}" } }],
    ["Grouped by status", { brick: "each", rows: "r_inv", group_by: "status", item: { brick: "row", children: [t("{customer}"), { brick: "text", text: { bind: "outstanding" } }] } }],
    ["Bar per row", { brick: "each", rows: "r_sales", item: { brick: "bar", label: "{branch}", value: { bind: "actual" }, show: "pct" } }],
    ["Ranked against target", { brick: "each", rank: true, rows: { ref: "r_sales", sort: { by: "actual", dir: "desc" } }, item: { brick: "bar", label: "{branch}", value: { bind: "actual" }, target: { bind: "target" } } }],
    ["One row", { brick: "each", rows: "r_one", item: { brick: "row", children: [t("{customer}"), { brick: "text", text: { bind: "outstanding" } }] } }],
    ["Empty", { brick: "each", rows: "r_none", empty: "No late invoices.", item: t("{customer}") }],
  ] },
  { brick: "table", title: "Table", about: "Rows and columns: sorted, totalled, paged; long and right-to-left cells; empty.", cases: [
    ["150 rows, total", { brick: "table", rows: "r_inv", total: true, columns: [{ header: "Invoice no.", value: { bind: "invoice_no" } }, { header: "Customer", value: { bind: "customer" }, strong: true }, { header: "Due date", value: { bind: "due_date" } }, { header: "Days", value: { bind: "days_late" }, align: "end" }, { header: "Outstanding", value: { bind: "outstanding" }, align: "end" }, { header: "Status", value: { bind: "status" } }] }],
    ["Page of 5", { brick: "table", rows: "r_sales", page_size: 5, columns: [{ header: "Branch", value: { bind: "branch" } }, { header: "Target", value: { bind: "target" } }, { header: "Actual", value: { bind: "actual" } }] }],
    ["Days late as bars", { brick: "table", rows: "r_inv", columns: [{ header: "Invoice no.", value: { bind: "invoice_no" } }, { header: "Customer", value: { bind: "customer" } }, { header: "Late", value: { bind: "days_late" }, bar: true }, { header: "Outstanding", value: { bind: "outstanding" }, align: "end" }, { header: "Status", value: { bind: "status" } }] }],
    ["Two columns", { brick: "table", rows: "r_month", columns: [{ header: "Month", value: { bind: "month" } }, { header: "Revenue", value: { bind: "revenue" } }] }],
    ["Empty", { brick: "table", rows: "r_none", empty: "No invoices.", columns: [{ header: "Customer", value: { bind: "customer" } }, { header: "Outstanding", value: { bind: "outstanding" } }] }],
  ] },
  { brick: "chart", title: "Chart", about: "Bars, lines, areas and points over one axis; stacked; three heights.", cases: [
    ["Bar", { brick: "chart", rows: "r_month", x: "month", marks: [{ type: "bar", y: "revenue" }] }],
    ["Line, two series", { brick: "chart", rows: "r_month", x: "month", marks: [{ type: "line", y: "revenue" }, { type: "line", y: "cost" }] }],
    ["Line with a note", { brick: "chart", rows: "r_month", x: "month", note: { at: "Mar", text: "First peak in March, then down until June" }, marks: [{ type: "line", y: "revenue" }, { type: "line", y: "cost" }] }],
    ["Area", { brick: "chart", rows: "r_month", x: "month", marks: [{ type: "area", y: "revenue" }] }],
    ["Points", { brick: "chart", rows: "r_many", x: "d", marks: [{ type: "point", y: "v" }] }],
    ["Stacked bars", { brick: "chart", rows: "r_month", x: "month", stacked: true, marks: [{ type: "bar", y: "cost" }, { type: "bar", y: "revenue" }] }],
    ["Bar and line", { brick: "chart", rows: "r_month", x: "month", marks: [{ type: "bar", y: "revenue" }, { type: "line", y: "cost" }] }],
    ["Negative values", { brick: "chart", rows: "r_swing", x: "m", marks: [{ type: "bar", y: "v" }] }],
    ["Height s", { brick: "chart", rows: "r_month", x: "month", height: "s", marks: [{ type: "bar", y: "revenue" }] }],
    ["Height l", { brick: "chart", rows: "r_month", x: "month", height: "l", marks: [{ type: "bar", y: "revenue" }] }],
    ["40 points", { brick: "chart", rows: "r_many", x: "d", marks: [{ type: "line", y: "v" }] }],
    ["One point", { brick: "chart", rows: "r_point", x: "d", marks: [{ type: "bar", y: "v" }] }],
    ["Long labels", { brick: "chart", rows: "r_sales", x: "branch", marks: [{ type: "bar", y: "actual" }] }],
    ["No rows", { brick: "chart", rows: "r_none", x: "due_date", marks: [{ type: "bar", y: "outstanding" }] }],
  ] },
  { brick: "action", title: "Action", about: "A button that asks the agent the next step, or opens the record.", cases: [
    ["Primary", { brick: "action", label: "Send reminder", send: "Send a reminder to the largest customer", kind: "primary" }],
    ["Secondary", { brick: "action", label: "See details", send: "Show the details" }],
    ["Long label", { brick: "action", label: `Request a receivable write-off for ${LONG}`, send: "x", kind: "primary" }],
  ] },
  { brick: "decide", title: "Decide", about: "Approve or reject a waiting request in place (reads the row's work id).", cases: [
    ["Waiting request", { brick: "stack", rows: "r_work", children: [{ brick: "decide", work: "work_id", ref: "ref" }] }],
  ] },
  { brick: "divider", title: "Divider", about: "A quiet line between two parts.", cases: [["Between two lines", { brick: "stack", children: [t("Above"), { brick: "divider" }, t("Below")] }]] },
  { brick: "stack", title: "Stack", about: "Children top to bottom, three gaps.", cases: (["s", "m", "l"] as const).map((gap) => [`Gap ${gap}`, { brick: "stack", gap, children: [t("One"), t("Two"), t("Three")] }] as [string, unknown]) },
  { brick: "row", title: "Row", about: "Children side by side: aligned start, centre, end or spread; many children wrap.", cases: [
    ...(["start", "center", "end", "between"] as const).map((align) => [`Align ${align}`, { brick: "row", align, children: [{ brick: "badge", text: "Wholesale" }, t("Providence"), { brick: "status", value: "open" }] }] as [string, unknown]),
    ["Many children", { brick: "row", children: ["Boston", "Providence", "Hartford", "Portland", "Albany", "Burlington", "Worcester", "New Haven"].map((x) => ({ brick: "badge", text: x })) }],
    ["Long and short", { brick: "row", align: "between", children: [t(LONG), { brick: "status", value: "approved" }] }],
  ] },
  { brick: "grid", title: "Grid", about: "Equal columns, one to four.", cases: [1, 2, 3, 4].map((columns) => [`${columns} columns`, { brick: "grid", columns, children: [1, 2, 3, 4].map((i) => ({ brick: "stat", label: `Column ${i}`, value: sum("actual") })) }] as [string, unknown]) },
  { brick: "split", title: "Split", about: "Two parts side by side, in five ratios.", cases: (["1:1", "2:1", "1:2", "3:2", "2:3"] as const).map((ratio) => [`Ratio ${ratio}`, { brick: "split", ratio, children: [{ brick: "callout", text: "Left" }, { brick: "callout", text: "Right", tone: "accent" }] }] as [string, unknown]) },
  { brick: "section", title: "Section", about: "A titled surface: with a note, focused, without a title.", cases: [
    ["Title and note", { brick: "section", title: "Summary", note: "as of Nov 14, 2026", children: [t("Section content.")] }],
    ["Focused", { brick: "section", title: "Needs action", focus: true, children: [t("Section content.")] }],
    ["No title", { brick: "section", children: [t("Section content.")] }],
    ["Long title", { brick: "section", title: LONG, note: LONG, children: [t("Section content.")] }],
  ] },
  { brick: "tabs", title: "Tabs", about: "Views of the same answer, two to many.", cases: [
    ["Two", { brick: "tabs", tabs: [{ label: "Summary", children: [t("Summary.")] }, { label: "Details", children: [t("Details.")] }] }],
    ["Five", { brick: "tabs", tabs: ["New England", "Mid-Atlantic", "Upstate New York", "Southeast", "Midwest"].map((label) => ({ label, children: [t(label)] })) }],
  ] },
];

export const BRICK_GALLERY: BrickGroup[] = GROUPS.map((g) => ({ brick: g.brick, title: g.title, about: g.about, cases: g.cases.map(([label, root], i) => build(g.brick, i, label, root)) }));
