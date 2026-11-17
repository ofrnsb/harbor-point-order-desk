import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockInput, resolveBlocks } from "../src/lib/blocks.ts";
import type { Action, Block, Result } from "../src/lib/types.ts";

const item = (id: string, extra = {}) => ({ id, title: `Item ${id}`, fields: [{ label: "Price", value: "1" }], ...extra });
const results: Record<string, Result | Action> = {
  r_list: { id: "r_list", kind: "items", title: "Headphones", source: "live", items: [item("a"), item("b"), item("c", { image: "javascript:alert(1)" })] },
  act_ok: { id: "act_ok", chatId: "c", type: "refund", payload: {}, title: "Refund", summary: [], consequence: "", danger: false, status: "pending", receipt: null, error: null, createdAt: "", decidedAt: null },
  act_done: { id: "act_done", chatId: "c", type: "refund", payload: {}, title: "Refund", summary: [], consequence: "", danger: false, status: "confirmed", receipt: [], error: null, createdAt: "", decidedAt: "" },
};
const reg = { get: (id: string) => results[id] };
const parse = (x: unknown) => BlockInput.parse(x) as BlockInput;

test("prebuilt answer blocks are gone: the agent composes them from bricks", () => {
  for (const type of ["list", "compare", "timeline", "metrics", "table", "chart", "layout", "kpi", "alert_list"]) assert.throws(() => parse({ type, ref: "r_list" }), type);
});

test("board and calendar need rows, and unknown or wrong-typed columns are refused with the real names", () => {
  const r = resolveBlocks([parse({ type: "board", ref: "r_list", lane: "status" }), parse({ type: "calendar", ref: "nope", start: "x" })], reg);
  assert.equal(r.blocks.length, 0);
  assert.match(r.problems.join(" | "), /r_list is items; board needs rows/);
  assert.match(r.problems.join(" | "), /nope/);
});

test("confirm only for a pending action", () => {
  assert.equal(resolveBlocks([parse({ type: "confirm", action_id: "act_ok" })], reg).blocks[0].type, "confirm");
  const done = resolveBlocks([parse({ type: "confirm", action_id: "act_done" })], reg);
  assert.equal(done.blocks.length, 0);
  assert.match(done.problems[0], /already confirmed/);
  assert.match(resolveBlocks([parse({ type: "confirm", action_id: "r_list" })], reg).problems[0], /unknown action/);
});

test("forms: duplicate names and option-less choices are dropped; required defaults to true", () => {
  const { blocks, problems } = resolveBlocks([parse({ type: "form", title: "Return details", fields: [
    { name: "order_id", label: "Order", kind: "text" }, { name: "order_id", label: "Again", kind: "text" },
    { name: "reason", label: "Reason", kind: "choice" }, { name: "date", label: "When", kind: "date", required: false },
  ] })], reg);
  assert.equal(problems.length, 2);
  assert.ok(blocks[0].type === "form" && blocks[0].fields.length === 2 && blocks[0].fields[0].required === true && blocks[0].fields[1].required === false);
});

test("schema rejects oversized and malformed input before it is resolved", () => {
  assert.throws(() => parse({ type: "choices", question: "Pick", options: ["only one"] }));
  assert.throws(() => parse({ type: "board", ref: "r_rows", lane: "status", page_size: 500 }), "a page is at most 100 rows");
  assert.throws(() => parse({ type: "form", title: "x", fields: [{ name: "Bad Name", label: "x", kind: "text" }] }));
  assert.throws(() => parse({ type: "html", ref: "x" }));
});

const rowsResult = {
  id: "r_rows", kind: "rows" as const, title: "Time-off requests", source: "live" as const,
  open: { system: "HR", object: "leave_requests", key: "request_no" },
  columns: [
    { name: "request_no", label: "No.", type: "text" as const, role: "key" },
    { name: "leave_type", label: "Jenis", type: "text" as const, role: "category" },
    { name: "start_date", label: "Mulai", type: "date" as const, role: "start" },
    { name: "end_date", label: "Selesai", type: "date" as const, role: "end" },
    { name: "days", label: "Days", type: "number" as const, role: "quantity" },
    { name: "status", label: "Status", type: "text" as const, role: "status" },
  ],
  rows: [
    { request_no: "LV-1", leave_type: "Annual leave", start_date: "2026-12-07", end_date: "2026-12-08", days: 2, status: "submitted" },
    { request_no: "LV-2", leave_type: "Sick leave", start_date: "2026-11-02", end_date: "2026-11-03", days: 2, status: "approved" },
  ],
  items: [item("LV-1"), item("LV-2")],
};
const legoReg = { get: (id: string) => (id === "r_rows" ? rowsResult : results[id]) };

test("board and calendar assemble from a rows result with the columns the agent names", () => {
  const { blocks, problems } = resolveBlocks([
    { type: "board", ref: "r_rows", lane: "status" },
    { type: "calendar", ref: "r_rows", start: "start_date", end: "end_date" },
  ], legoReg);
  assert.deepEqual(problems, []);
  assert.deepEqual(blocks.map((b) => b.type), ["board", "calendar"]);
  const [board, cal] = blocks as [Extract<Block, { type: "board" }>, Extract<Block, { type: "calendar" }>];
  assert.equal(board.open?.key, "request_no");
  assert.equal(board.lane.name, "status");
  assert.equal(board.label.name, "request_no", "a board card is named by the record key when there is no title column");
  assert.deepEqual(board.facts.map((c) => c.name), ["start_date", "days"], "facts default to the date and the quantity");
  assert.equal(cal.end?.name, "end_date");
});

test("a board keeps the process order the agent gives for its lanes", () => {
  const { blocks, problems } = resolveBlocks([{ type: "board", ref: "r_rows", lane: "status", lane_order: ["submitted", "approved"] }], legoReg);
  assert.deepEqual(problems, []);
  assert.deepEqual((blocks[0] as Extract<Block, { type: "board" }>).laneOrder, ["submitted", "approved"]);
});

