import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dir: string, prev: string, A: typeof import("../src/lib/actions.ts");
let runs = 0;
const handlers = { refund: async () => { runs++; return [{ label: "Refund", value: "$100" }]; }, broken: async () => { throw new Error("warehouse offline"); } };
const base = { chatId: "c1", payload: { order: "INV-1" }, title: "Refund INV-1", summary: [], consequence: "Money goes back", danger: false };

before(async () => { prev = process.cwd(); dir = await fs.mkdtemp(path.join(os.tmpdir(), "starter-actions-")); process.chdir(dir); A = await import("../src/lib/actions.ts"); });
after(async () => { process.chdir(prev); await fs.rm(dir, { recursive: true, force: true }); });

test("nothing runs until the user confirms; confirm runs exactly once", async () => {
  const a = await A.propose({ ...base, type: "refund" });
  assert.equal(a.status, "pending");
  assert.equal(runs, 0);
  const [r1, r2] = await Promise.all([A.decide(a.id, "confirm", handlers), A.decide(a.id, "confirm", handlers)]);
  assert.equal(runs, 1);
  assert.ok("action" in r1 && r1.action.status === "confirmed" && r1.action.receipt?.[0].value === "$100");
  assert.ok("error" in r2 && r2.status === 409);
});

test("cancel never runs the handler and cannot be confirmed afterwards", async () => {
  const a = await A.propose({ ...base, type: "refund" });
  const before = runs;
  const r = await A.decide(a.id, "cancel", handlers);
  assert.ok("action" in r && r.action.status === "cancelled");
  const again = await A.decide(a.id, "confirm", handlers);
  assert.ok("error" in again && again.status === 409);
  assert.equal(runs, before);
});

test("a failing handler is recorded as failed with its reason; unknown ids are 404", async () => {
  const a = await A.propose({ ...base, type: "broken" });
  const r = await A.decide(a.id, "confirm", handlers);
  assert.ok("action" in r && r.action.status === "failed" && r.action.error === "warehouse offline");
  const missing = await A.decide("act_nope", "confirm", handlers);
  assert.ok("error" in missing && missing.status === 404);
  assert.equal((await A.getAction(a.id))?.status, "failed");
});
