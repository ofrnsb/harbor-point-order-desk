// Brick compositions for /dev/blocks: several different builds over the same data, plus the edge cases
// (nothing, one row, 150 rows, missing values, negatives, long and right-to-left text). Each goes through the
// same schema and resolver the agent's call goes through, so a broken build shows its problem here.
import { BataInput } from "../../lib/bata/schema.ts";
import { resolveBata } from "../../lib/bata/resolve.ts";
import type { Block, Column, Row, RowsResult } from "../../lib/types.ts";

const C = (name: string, label: string, type: Column["type"], extra: Partial<Column> = {}): Column => ({ name, label, type, ...extra });
const SALES: Column[] = [
  C("branch", "Branch", "text", { role: "title" }), C("region", "Region", "text", { role: "category" }),
  C("target", "Target", "number", { money: true }), C("actual", "Actual", "number", { money: true }),
  C("last_year", "Last year", "number", { money: true }), C("status", "Status", "text", { role: "status" }),
];
const INV: Column[] = [
  C("invoice_no", "Invoice no.", "text", { role: "key" }), C("customer", "Customer", "text", { role: "title" }),
  C("due_date", "Due date", "date"), C("days_late", "Days late", "number"),
  C("outstanding", "Outstanding", "number", { money: true }), C("status", "Status", "text", { role: "status" }),
];
const MONTH: Column[] = [C("month", "Month", "text"), C("revenue", "Revenue", "number", { money: true }), C("cost", "Cost", "number", { money: true })];

const LONG = "Northeastern Industrial Maintenance and Packaging Supply Corporation Satellite Branch, Quonset Business Park Phase Two";
const RTL = "شركة الخليج للتجارة";
const BRANCHES = ["Boston", "Providence", "Hartford", "Newark", "Philadelphia", "Baltimore", "Albany", "Burlington"];
const sales: Row[] = BRANCHES.map((b, i) => ({
  branch: i === 7 ? LONG : b, region: i < 3 ? "New England" : i < 6 ? "Mid-Atlantic" : "Upstate New York",
  target: 75_000 + i * 9_400, actual: i === 5 ? null : 56_000 + ((i * 337) % 9) * 6_000,
  last_year: 62_500 + i * 5_000, status: ["open", "approved", "rejected", "open"][i % 4],
}));
const day = (d: number) => new Date(Date.UTC(2026, 10, 11 + d)).toISOString().slice(0, 10);
const invoices = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({
  invoice_no: `INV/2026/${String(i + 1).padStart(5, "0")}`, customer: i === 0 ? LONG : i === 1 ? RTL : `Atlantic Trade Partners ${i + 1} LLC`,
  due_date: day(-((i * 7) % 95)), days_late: (i * 7) % 95, outstanding: i % 11 === 4 ? null : i % 13 === 6 ? -150 : 250 + ((i * 7919) % 90) * 70,
  status: (i * 7) % 95 > 60 ? "rejected" : (i * 7) % 95 > 30 ? "open" : "submitted",
}));
const months: Row[] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((m, i) => ({
  month: m, revenue: 131_000 + Math.round(Math.sin(i) * 19_000) + i * 3_800, cost: 100_000 + i * 2_800,
}));

const rs = (id: string, title: string, columns: Column[], rows: Row[], open?: RowsResult["open"]): RowsResult =>
  ({ id, kind: "rows", title, columns, rows, items: [], source: "seeded", ...(open ? { open } : {}) });
const REG = new Map<string, unknown>([
  ["r_sales", rs("r_sales", "Sales by branch", SALES, sales)],
  ["r_inv", rs("r_inv", "Receivables", INV, invoices(150), { system: "ERP", object: "invoices", key: "invoice_no" })],
  ["r_one", rs("r_one", "Receivables", INV, invoices(1), { system: "ERP", object: "invoices", key: "invoice_no" })],
  ["r_none", rs("r_none", "Receivables", INV, [])],
  ["r_month", rs("r_month", "Monthly profit and loss", MONTH, months)],
]);
const reg = { get: (id: string) => REG.get(id) };
/** The same results, for the brick gallery at /dev/bricks to add its own beside. */
export const FIXTURE_RESULTS: ReadonlyMap<string, unknown> = REG;
export { C, rs, LONG, RTL };

const achieved = { calc: "pct", a: { bind: "actual" }, b: { bind: "target" } } as const;
const BUILDS: { id: string; label: string; input: unknown }[] = [
  {
    id: "focus-ranked", label: "One focus figure + branch ranking",
    input: { type: "bata", title: "Sales to date", root: { brick: "split", ratio: "1:2", children: [
      { brick: "section", rows: "r_sales", focus: true, children: [
        { brick: "figure", size: "xl", label: "Total actual", value: { agg: "sum", of: "actual" }, delta: { calc: "pct_change", a: { agg: "sum", of: "actual" }, b: { agg: "sum", of: "last_year" } }, good: "up", note: "vs last year" },
        { brick: "figure", size: "m", label: "Target attainment", value: { calc: "pct", a: { agg: "sum", of: "actual" }, b: { agg: "sum", of: "target" } } },
      ] },
      { brick: "each", rows: { ref: "r_sales", sort: { by: "actual", dir: "asc" } }, item: { brick: "stack", gap: "s", children: [
        { brick: "row", align: "between", children: [{ brick: "text", text: "{branch}" }, { brick: "text", tone: "muted", text: achieved }] },
        { brick: "bar", value: { bind: "actual" }, max: { bind: "target" }, show: "none" },
      ] } },
    ] } },
  },
  {
    id: "compare-regions", label: "Side-by-side comparison by region",
    input: { type: "bata", title: "New England and Mid-Atlantic", root: { brick: "grid", columns: 2, children: ["New England", "Mid-Atlantic"].map((r) => ({
      brick: "section", title: r, rows: { ref: "r_sales", where: [{ col: "region", op: "eq", value: r }] }, children: [
        { brick: "figure", value: { agg: "sum", of: "actual" }, label: "Actual" },
        { brick: "stat", label: "Branches", value: { agg: "count" } },
        { brick: "stat", label: "Target", value: { agg: "sum", of: "target" } },
      ] })) } },
  },
  {
    id: "trend-chart", label: "Monthly trend: line and bar",
    input: { type: "bata", title: "Revenue and cost", root: { brick: "stack", children: [
      { brick: "row", gap: "l", rows: "r_month", children: [
        { brick: "figure", label: "October revenue", value: { agg: "last", of: "revenue" }, delta: { calc: "pct_change", a: { agg: "last", of: "revenue" }, b: { agg: "first", of: "revenue" } }, good: "up", note: "since January" },
        { brick: "figure", label: "October cost", value: { agg: "last", of: "cost" }, delta: { calc: "pct_change", a: { agg: "last", of: "cost" }, b: { agg: "first", of: "cost" } }, good: "down", note: "since January" },
      ] },
      { brick: "tabs", tabs: [
        { label: "Line", children: [{ brick: "chart", rows: "r_month", x: "month", marks: [{ type: "line", y: "revenue" }, { type: "area", y: "cost" }] }] },
        { label: "Bar", children: [{ brick: "chart", rows: "r_month", x: "month", marks: [{ type: "bar", y: "revenue" }, { type: "bar", y: "cost" }] }] },
      ] },
    ] } },
  },
  {
    id: "aging-groups", label: "150 receivables grouped by status, paged",
    input: { type: "bata", title: "Overdue receivables", root: { brick: "stack", children: [
      { brick: "callout", tone: "warn", text: { calc: "diff", a: { agg: "count", rows: "r_inv" }, b: { agg: "count", of: "outstanding", rows: "r_inv" } }, title: "Invoices with no outstanding amount" },
      { brick: "each", rows: { ref: "r_inv", sort: { by: "outstanding", dir: "desc" } }, group_by: "status", page_size: 8, item: { brick: "row", align: "between", children: [
        { brick: "stack", gap: "s", children: [{ brick: "text", text: "{customer}" }, { brick: "text", size: "s", tone: "muted", text: "{invoice_no} · {days_late} days" }] },
        { brick: "text", text: { bind: "outstanding" } },
        { brick: "action", label: "Open", open: true },
      ] } },
    ] } },
  },
  {
    id: "register-table", label: "150-row table: sorted, totalled, open a row",
    input: { type: "bata", title: "Receivables register", root: { brick: "table", rows: { ref: "r_inv", where: [{ col: "days_late", op: "gt", value: 30 }], sort: { by: "days_late", dir: "desc" } }, page_size: 20, total: true, columns: [
      { header: "Invoice", value: { bind: "invoice_no" }, strong: true }, { header: "Customer", value: "{customer}" },
      { header: "Due date", value: { bind: "due_date" } }, { header: "Days late", value: { bind: "days_late" }, align: "end" },
      { header: "Outstanding", value: { bind: "outstanding" }, align: "end" }, { header: "Status", value: { bind: "status" } },
    ] } },
  },
  {
    id: "cards-actions", label: "Cards with follow-up buttons",
    input: { type: "bata", title: "Top five", root: { brick: "each", as: "cards", columns: 3, rows: { ref: "r_inv", sort: { by: "outstanding", dir: "desc" }, limit: 5 }, item: { brick: "stack", children: [
      { brick: "row", align: "between", children: [{ brick: "badge", text: "{invoice_no}" }, { brick: "status", value: { bind: "status" } }] },
      { brick: "figure", size: "m", value: { bind: "outstanding" }, label: "{customer}" },
      { brick: "action", label: "Send reminder", send: "Send a payment reminder for {invoice_no}", kind: "primary" },
    ] } } },
  },
  {
    id: "one-record", label: "One row: built as a record, not a table",
    input: { type: "bata", title: "Invoice", root: { brick: "section", rows: "r_one", title: "{customer}", note: "{invoice_no}", children: [
      { brick: "row", align: "between", children: [{ brick: "figure", size: "l", value: { bind: "outstanding" }, label: "Balance due" }, { brick: "stamp", value: { bind: "status" }, meta: "{due_date}" }] },
      { brick: "grid", columns: 3, children: [{ brick: "stat", label: "Due date", value: { bind: "due_date" } }, { brick: "stat", label: "Days late", value: "{days_late} days" }, { brick: "stat", label: "Status", value: { bind: "status" } }] },
      { brick: "row", children: [{ brick: "action", label: "Open invoice", open: true }, { brick: "action", label: "Set up installments", send: "Create an installment plan for {invoice_no}" }] },
    ] } },
  },
  {
    id: "empty", label: "Empty: every brick shows its empty state",
    input: { type: "bata", title: "Providence receivables", root: { brick: "stack", rows: "r_none", children: [
      { brick: "figure", value: { agg: "sum", of: "outstanding" }, label: "Total outstanding" },
      { brick: "each", rows: "r_none", empty: "No invoices past 60 days in Providence", item: { brick: "text", text: "{customer}" } },
      { brick: "table", rows: "r_none", empty: "No rows", columns: [{ header: "Invoice", value: { bind: "invoice_no" } }] },
      { brick: "chart", rows: "r_none", x: "customer", marks: [{ type: "bar", y: "outstanding" }] },
    ] } },
  },
  {
    id: "chips-mixed", label: "Chips, sparkline, stacked bar, negative values",
    input: { type: "bata", title: "Quick summary", root: { brick: "stack", children: [
      { brick: "each", as: "chips", rows: "r_sales", item: { brick: "text", text: "{branch}" } },
      { brick: "row", children: [{ brick: "spark", rows: "r_month", x: "month", y: "revenue" }, { brick: "text", tone: "muted", text: "Revenue, 10 months" }] },
      { brick: "chart", rows: "r_sales", x: "branch", stacked: true, height: "s", marks: [{ type: "bar", y: "actual", label: "Actual" }, { type: "bar", y: "target", label: "Target" }] },
      { brick: "table", rows: { ref: "r_inv", where: [{ col: "outstanding", op: "lt", value: 0 }] }, columns: [{ header: "Invoice", value: { bind: "invoice_no" } }, { header: "Outstanding (credit)", value: { bind: "outstanding" }, align: "end" }] },
    ] } },
  },
  {
    id: "broken", label: "Broken build: missing column (must show the problem)",
    input: { type: "bata", title: "Broken", root: { brick: "each", rows: "r_sales", item: { brick: "text", text: "{revenue_ytd}" } } },
  },
];

function build(id: string, label: string, input: unknown): { id: string; label: string; block: Block } {
  const parsed = BataInput.safeParse(input);
  const fail = (why: string) => ({ id: `bata-${id}`, label: `Build: ${label}: ${why}`, block: { type: "list", title: why, items: [], source: "seeded" } as Block });
  if (!parsed.success) return fail(`schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const r = resolveBata(parsed.data, reg);
  if (!r.block) return fail(r.problems[0] ?? "no block");
  return { id: `bata-${id}`, label: `Build: ${label}`, block: r.block };
}

export const BATA_FIXTURES = BUILDS.map((b) => build(b.id, b.label, b.input));
