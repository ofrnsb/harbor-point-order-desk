import { test } from "node:test";
import assert from "node:assert/strict";
import type { Result, RowsResult } from "../src/lib/types.ts";
import { evalVal, fmt, fmtShort, pickRows, scopeFor, text } from "../src/lib/bata/eval.ts";
import { resolveBata } from "../src/lib/bata/resolve.ts";
import { BataInput, Node } from "../src/lib/bata/schema.ts";
import { BlockInput, resolveBlocks } from "../src/lib/blocks.ts";

const C = (name: string, type: "text" | "number" | "date" = "text", extra = {}) => ({ name, label: name, type, ...extra });
const branches: RowsResult = {
  id: "r_b", kind: "rows", title: "Sales by branch", source: "live", items: [],
  columns: [C("branch"), C("target", "number", { money: true }), C("actual", "number", { money: true }), C("status", "text", { role: "status" }), C("as_of", "date")],
  rows: [
    { branch: "Boston", target: 125_000, actual: 131_250, status: "open", as_of: "2026-11-11" },
    { branch: "Providence", target: 112_500, actual: 8_833.25, status: "overdue", as_of: "2026-11-11" },
    { branch: "Hartford", target: 93_750, actual: null, status: "open", as_of: "2026-11-11" },
  ],
  open: { system: "ERP", object: "branches", key: "branch" },
};
const reg = { get: (id: string): Result | undefined => (id === "r_b" ? branches : undefined) };
const data = { r_b: { title: branches.title, columns: branches.columns, rows: branches.rows } };

test("values bind to data: sums keep dollars and cents, ratios read as percent, a missing value is a dash", () => {
  const s = scopeFor(data, "r_b");
  assert.equal(fmt(evalVal({ agg: "sum", of: "actual" }, s)), "$140,083.25");
  assert.equal(fmt(evalVal({ agg: "count" }, s)), "3");
  assert.equal(fmt(evalVal({ calc: "pct", a: { agg: "sum", of: "actual" }, b: { agg: "sum", of: "target" } }, s)), "42%");
  const providence = { ...s, row: branches.rows[1] };
  assert.equal(fmt(evalVal({ calc: "diff", a: { bind: "actual" }, b: { bind: "target" } }, providence)), "-$103,666.75");
  assert.equal(fmt(evalVal({ calc: "pct_change", a: { bind: "actual" }, b: { bind: "target" } }, providence)), "-92%");
  assert.equal(fmt(evalVal({ bind: "actual" }, { ...s, row: branches.rows[2] })), "–");
  assert.equal(fmt(evalVal({ calc: "pct", a: { bind: "actual" }, b: { bind: "actual" } }, { ...s, row: branches.rows[2] })), "–", "no division by a missing value");
  assert.equal(text("{branch}: {status}", providence), "Providence: Overdue");
  assert.equal(fmt(evalVal({ bind: "as_of" }, providence)), "Nov 11, 2026");
});

test("rows can be filtered, ordered and cut; a top-N is the agent's choice", () => {
  const worst = pickRows({ ref: "r_b", where: [{ col: "actual", op: "not_empty" }], sort: { by: "actual", dir: "asc" }, limit: 1 }, data);
  assert.deepEqual(worst.rows.map((r) => r.branch), ["Providence"]);
  assert.deepEqual(pickRows({ ref: "r_b", where: [{ col: "status", op: "in", value: ["overdue"] }] }, data).rows.length, 1);
  assert.deepEqual(pickRows({ ref: "r_b", sort: { by: "actual", dir: "desc" } }, data).rows.map((r) => r.branch), ["Boston", "Providence", "Hartford"], "missing values sort last");
});

test("the same question can be built many ways; each build is checked against the real columns", () => {
  const a = BataInput.parse({ type: "bata", title: "Branches behind target", root: { brick: "stack", children: [
    { brick: "figure", label: "Furthest behind", value: { agg: "first", of: "branch", rows: { ref: "r_b", where: [{ col: "actual", op: "not_empty" }], sort: { by: "actual", dir: "asc" } } } },
    { brick: "each", rows: { ref: "r_b", sort: { by: "actual", dir: "asc" } }, page_size: 5, item: { brick: "row", align: "between", children: [
      { brick: "text", text: "{branch}" }, { brick: "bar", value: { bind: "actual" }, max: { bind: "target" }, show: "pct" }, { brick: "status", value: { bind: "status" } },
    ] } },
  ] } });
  const b = BataInput.parse({ type: "bata", title: "Branches behind target", root: { brick: "split", ratio: "2:1", children: [
    { brick: "chart", rows: "r_b", x: "branch", marks: [{ type: "bar", y: "target", label: "Target" }, { type: "bar", y: "actual", label: "Actual" }] },
    { brick: "table", rows: "r_b", columns: [{ header: "Branch", value: "{branch}" }, { header: "Attainment", value: { calc: "pct", a: { bind: "actual" }, b: { bind: "target" } } }], total: true },
  ] } });
  for (const x of [a, b]) {
    const r = resolveBata(x, reg);
    assert.deepEqual(r.problems, []);
    assert.equal(r.block?.type, "bata");
    assert.deepEqual(Object.keys(r.block!.data), ["r_b"], "only the data the bricks use travels to the browser");
  }
});

test("a build that binds a column the data does not have, or a value outside any rows, is refused with the reason", () => {
  const bad = resolveBata(BataInput.parse({ type: "bata", title: "x", root: { brick: "stack", children: [
    { brick: "figure", value: { bind: "actual" } },
    { brick: "each", rows: "r_b", item: { brick: "text", text: "{region}" } },
    { brick: "chart", rows: "r_b", x: "branch", marks: [{ type: "line", y: "status" }] },
    { brick: "table", rows: "r_missing", columns: [{ header: "a", value: "b" }] },
    { brick: "action", label: "Continue" },
  ] } }), reg);
  assert.equal(bad.block, undefined);
  const all = bad.problems.join("\n");
  for (const re of [/bound outside any rows/, /column "region" is not in this data/, /"status" is not a number/, /r_missing is not a rows result/, /needs send .* or open/]) assert.match(all, re);
});

test("limits: depth and size are bounded, numbers can never be typed in", () => {
  let deep: unknown = { brick: "text", text: "x" };
  for (let i = 0; i < 12; i++) deep = { brick: "stack", children: [deep] };
  assert.match(resolveBata(BataInput.parse({ type: "bata", title: "x", root: deep }), reg).problems.join(), /nested too deep/);
  assert.throws(() => Node.parse({ brick: "figure", value: 12345 }), "a figure takes a bound value, not a literal number");
});

test("a build holds only bricks; a prebuilt part inside it is refused", () => {
  assert.throws(() => BlockInput.parse({ type: "bata", title: "x", root: { brick: "recipe", use: "kpi", args: {} } }));
  const r = resolveBlocks([BlockInput.parse({ type: "bata", title: "Summary", root: { brick: "stack", children: [
    { brick: "heading", text: "Branch status" },
    { brick: "figure", value: { agg: "sum", of: "actual", rows: "r_b" } },
  ] } }) as never], reg);
  assert.deepEqual(r.problems, []);
  const b = r.blocks[0];
  assert.ok(b.type === "bata" && b.root.brick === "stack" && "children" in b.root);
});

test("headline money shortens from a million up, smaller amounts and non-money stay exact", () => {
  const money = { name: "x", label: "x", type: "number" as const, money: true };
  assert.equal(fmtShort({ v: 9_055_000, col: money }), "$9.1M");
  assert.equal(fmtShort({ v: -2_500_000, col: money }), "-$2.5M");
  assert.equal(fmtShort({ v: 377_425.5, col: money }), "$377,425.50");
  assert.equal(fmtShort({ v: 750_000, col: money }), "$750,000");
  assert.equal(fmtShort({ v: 9_055_000, col: { name: "n", label: "n", type: "number" } }), "9,055,000");
  assert.equal(fmtShort({ v: null, col: money }), "–");
});

test("every gallery build resolves except the deliberately broken one", async () => {
  const { BATA_FIXTURES } = await import("../src/components/bata/fixtures.ts");
  for (const f of BATA_FIXTURES) assert.equal(f.block.type, f.id === "bata-broken" ? "list" : "bata", f.label);
});

test("a date stored as local midnight reads as a day, a real time keeps its time", () => {
  const col = { name: "due_date", label: "Due date", type: "date" as const };
  assert.equal(fmt({ v: new Date(2026, 7, 4).toISOString(), col }), "Aug 4, 2026");
  assert.match(fmt({ v: new Date(2026, 7, 4, 9, 30).toISOString(), col }), /09[.:]30/);
});

test("a build shows only what exists: an empty part is left out, a fully empty build keeps its empty line, one action leads", () => {
  const none = { ref: "r_b", where: [{ col: "status", op: "in" as const, value: ["nothing"] }] };
  const part = (rows: unknown, title: string) => ({ brick: "section", title, children: [{ brick: "text", text: "About this part" }, { brick: "each", rows, empty: "Nothing here", item: { brick: "text", text: "{branch}" } }] });
  const actions = { brick: "row", children: [{ brick: "action", label: "First", send: "a" }, { brick: "action", label: "Second", send: "b" }] };
  const mixed = resolveBata(BataInput.parse({ type: "bata", title: "t", root: { brick: "stack", children: [part(none, "Approvals"), { brick: "divider" }, part("r_b", "Branches"), actions] } }), reg);
  assert.deepEqual(mixed.problems, []);
  const kids = (mixed.block!.root as { children: { brick: string; title?: string; children?: { brick: string; kind?: string }[] }[] }).children;
  assert.deepEqual(kids.map((k) => k.title ?? k.brick), ["Branches", "row"], "the empty part and the divider beside it are gone");
  assert.deepEqual(kids[1].children!.map((a) => a.kind), ["primary", "secondary"]);
  const empty = resolveBata(BataInput.parse({ type: "bata", title: "t", root: { brick: "stack", children: [part(none, "Approvals")] } }), reg);
  assert.equal(JSON.stringify(empty.block!.root).includes("Nothing here"), true, "when nothing exists at all, the empty line is the answer");
  const lone = resolveBata(BataInput.parse({ type: "bata", title: "t", root: { brick: "stack", children: [part("r_b", "Branches"), { brick: "action", label: "Only", send: "a" }] } }), reg);
  assert.equal((lone.block!.root as { children: { kind?: string }[] }).children[1].kind, undefined, "a lone action stays quiet");
});

test("a build that types its figures as words is sent back; the same figures bound are accepted", () => {
  const typed = resolveBata(BataInput.parse({ type: "bata", title: "t", root: { brick: "stack", children: [
    { brick: "text", text: "1. Refinance: 94 missed, 13 of 46 accepted (28%)" }, { brick: "text", text: "2. Loan: 147 missed, 28 of 86 (33%)" }, { brick: "text", text: "3. Deposit: 82 missed, 20 of 57 (35%)" },
  ] } }), reg);
  assert.match(typed.problems.join(" "), /types its figures/);
  const bound = resolveBata(BataInput.parse({ type: "bata", title: "t", root: { brick: "stack", children: [
    { brick: "text", text: "Target 2,000 and 1,800 and 1,500 by branch" }, { brick: "each", rows: "r_b", item: { brick: "bar", value: { bind: "actual" }, label: "{branch}" } },
    { brick: "ring", value: { agg: "sum", of: "actual", rows: "r_b" }, max: { agg: "sum", of: "target", rows: "r_b" }, label: "Of target" },
  ] } }), reg);
  assert.deepEqual(bound.problems, []);
});
