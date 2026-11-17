import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedFixture } from "./fixtures/tenant.ts";
import type { DomainTool, ToolCtx } from "../src/lib/domain.ts";
import type { Action, Result, RowsResult } from "../src/lib/types.ts";

// Every file store lands in a throwaway folder.
process.env.SIMPUL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "simpul-tk-"));
let tk: { tools: DomainTool[]; actions: Record<string, (a: Action) => Promise<{ label: string; value: string }[]>> };
let org: typeof import("../src/platform/org.ts");
let store: Awaited<ReturnType<typeof seedFixture>>;

before(async () => {
  store = await seedFixture();
  org = await import("../src/platform/org.ts");
  const { makeToolkit } = await import("../src/domain/toolkit/index.ts");
  tk = makeToolkit({ objectFor: () => { throw new Error("no data access in this test"); }, readRows: async () => ({ rows: [], total: 0 }), recordsResult: () => { throw new Error("unused"); }, toItem: () => { throw new Error("unused"); }, rowsText: () => "" }) as typeof tk;
});

function ctxFor(userId: string, unitId: string, results: Result[] = []) {
  const reg = new Map<string, Result | Action>(results.map((r) => [r.id, r]));
  const proposed: Action[] = [];
  let n = 0;
  const ctx = {
    chatId: "c1", eff: org.resolveEffective(userId, unitId), external: false, principal: { tenantId: "t1", userId, unitId },
    result: (id: string) => reg.get(id) as Result | undefined,
    save: (r: Omit<Result, "id">) => { const s = { ...r, id: `r_${++n}` } as Result; reg.set(s.id, s); return s; },
    propose: async (p: Omit<Action, "id" | "chatId" | "status" | "receipt" | "error" | "createdAt" | "decidedAt">) => { const a = { ...p, id: `act_${++n}`, chatId: "c1", status: "pending", receipt: null, error: null, createdAt: "", decidedAt: null } as Action; proposed.push(a); return a; },
    touch: (t: never) => t,
  } as unknown as ToolCtx;
  return { ctx, proposed, reg };
}
const tool = (name: string) => { const t = tk.tools.find((x) => x.name === name); assert.ok(t, `${name} exists`); return t!; };
const rows = (id: string, data: Record<string, unknown>[], cols: [string, "text" | "number" | "date"][]): RowsResult =>
  ({ id, kind: "rows", title: id, columns: cols.map(([name, type]) => ({ name, label: name, type })), rows: data as RowsResult["rows"], items: [], source: "live" });

test("the toolkit has exactly its tools, each with a description", () => {
  const names = ["add_note", "create_task", "list_notes", "list_outbox", "list_reminders", "list_tasks", "send_message", "set_reminder", "update_task"];
  assert.deepEqual(tk.tools.map((t) => t.name).sort(), names);
  assert.equal(new Set(tk.tools.map((t) => t.name)).size, tk.tools.length, "names are unique");
  for (const t of tk.tools) assert.ok(t.description.length > 40, t.name);
});

test("a message goes to the outbox only after confirmation, merged per recipient, never marked delivered", async () => {
  const r = rows("r_cust", [{ name: "Bluefin Bistro", email: "maria@bluefinbistro.example", so: "SO-24053" }, { name: "Greenleaf Cafes", email: "purchasing@greenleafcafes.example", so: "SO-24060" }], [["name", "text"], ["email", "text"], ["so", "text"]]);
  const { ctx, proposed } = ctxFor("u-op", "ar-east", [r]);
  await tool("send_message").run({ channel: "email", recipients_ref: "r_cust", recipient_column: "email", name_column: "name", subject: "Order {so}", body: "Hi {name}, your order {so} is confirmed." }, ctx);
  assert.equal(store.list("tk_message", "t1").length, 0, "nothing queued before confirmation");
  const receipt = await tk.actions[proposed[0].type](proposed[0]);
  const msgs = store.list("tk_message", "t1");
  assert.deepEqual(msgs.map((m) => [m.to, m.subject, m.body, m.status]).sort(), [["maria@bluefinbistro.example", "Order SO-24053", "Hi Bluefin Bistro, your order SO-24053 is confirmed.", "queued"], ["purchasing@greenleafcafes.example", "Order SO-24060", "Hi Greenleaf Cafes, your order SO-24060 is confirmed.", "queued"]]);
  assert.ok(receipt.some((f) => /Queued in the outbox/.test(f.value)));
  const masked = rows("r_m", [{ email: "ma***@***" }], [["email", "text"]]);
  await assert.rejects(tool("send_message").run({ channel: "email", recipients_ref: "r_m", recipient_column: "email", body: "hello everyone" }, ctxFor("u-op", "ar-east", [masked]).ctx), /is masked for you/);
});

test("tasks: created on confirm, visible to the assignee, not to another tenant user's view", async () => {
  const { ctx, proposed } = ctxFor("u-op", "ar-east");
  await tool("create_task").run({ title: "Call Bluefin Bistro about SO-24053", due_at: "2026-11-20T09:00:00-05:00", assignee_user_id: "u-mgr" }, ctx);
  await tk.actions[proposed[0].type](proposed[0]);
  const mgr = ctxFor("u-mgr", "fin");
  const out = await tool("list_tasks").run({}, mgr.ctx);
  assert.match(out, /1 tasks/);
  const hr = ctxFor("u-hr", "hr");
  assert.match(await tool("list_tasks").run({}, hr.ctx), /0 tasks/);
  await assert.rejects(tool("create_task").run({ title: "Check the order", assignee_user_id: "nobody" }, ctx), /is not in this company/);
});

test("notes are per unit; reminders refuse the past", async () => {
  const op = ctxFor("u-op", "ar-east");
  await tool("add_note").run({ record_key: "SO-24051", text: "Customer will confirm the tissue quantity on Friday" }, op.ctx);
  assert.match(await tool("list_notes").run({ record_key: "SO-24051" }, op.ctx), /confirm the tissue/);
  assert.match(await tool("list_notes").run({ record_key: "SO-24051" }, ctxFor("u-hr", "hr").ctx), /No notes on/);
  await assert.rejects(tool("set_reminder").run({ text: "check again", due_at: "2020-01-01T00:00:00Z" }, op.ctx), /has passed/);
});
