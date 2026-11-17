import { test } from "node:test";
import assert from "node:assert/strict";
import { briefKey, briefWhileBuilding, dropBrief, freshBrief, keepBrief, lastBrief, queueOf } from "../src/platform/home.ts";
import type { Message } from "../src/lib/types.ts";

const msg = (over: Partial<Extract<Message, { role: "agent" }>> = {}): Message => ({
  id: "m1", role: "agent", text: "", blocks: [{ type: "bata", title: "t", where: "chat", root: { brick: "divider" }, data: {} }], trace: [], error: null, at: new Date().toISOString(), trail: { touches: [], model: null }, ...over,
});

test("a start screen is current while it is young and built for the same waiting decisions", () => {
  const k = briefKey("u1", "unit");
  dropBrief(k);
  assert.ok(keepBrief(k, "", msg(), 1_000));
  assert.equal(freshBrief(k, "", 1_000 + 59_000, 60_000)?.id, "m1");
  assert.equal(freshBrief(k, "", 1_000 + 61_000, 60_000), null, "aged out");
  assert.equal(freshBrief(k, "w1=awaiting_approval", 1_000 + 1_000, 60_000), null, "a new decision is waiting");
  assert.equal(briefWhileBuilding(k, "")?.message.id, "m1", "an aged screen still shows while the new one is built");
  assert.equal(briefWhileBuilding(k, "w1=awaiting_approval"), null, "one built for other decisions never shows its stale Approve");
  dropBrief(k);
  assert.equal(lastBrief(k), null);
});

test("the waiting decisions read the same in any order and differ when one changes", () => {
  const a = queueOf([{ id: "w1", state: "awaiting_approval" }, { id: "w2", state: "awaiting_approval" }]);
  assert.equal(a, queueOf([{ id: "w2", state: "awaiting_approval" }, { id: "w1", state: "awaiting_approval" }]));
  assert.notEqual(a, queueOf([{ id: "w1", state: "awaiting_approval" }]));
  assert.notEqual(queueOf([{ id: "w1", state: "executed" }]), queueOf([{ id: "w1", state: "awaiting_approval" }]));
  assert.notEqual(briefKey("u2", "unit"), briefKey("u1", "unit"));
});

test("a failed or empty turn is never kept, and never replaces the last good screen", () => {
  const k = briefKey("u3", "unit");
  dropBrief(k);
  assert.equal(keepBrief(k, "", msg({ error: "limit" })), false);
  assert.equal(keepBrief(k, "", msg({ blocks: [] })), false);
  assert.equal(lastBrief(k), null);
  assert.ok(keepBrief(k, "", msg({ id: "good" })));
  assert.equal(keepBrief(k, "", msg({ id: "bad", error: "limit" })), false);
  assert.equal(lastBrief(k)?.message.id, "good");
  dropBrief(k);
});

test("the last screen survives a restart: it is read back from the data folder", async () => {
  const k = briefKey("u4", "unit");
  dropBrief(k);
  assert.ok(keepBrief(k, "", msg({ id: "saved" }), 5_000));
  (globalThis as unknown as { homeBriefs: Map<string, unknown> }).homeBriefs.delete(k);  // what a restart does to memory
  assert.equal(lastBrief(k)?.message.id, "saved");
  assert.equal(freshBrief(k, "", 6_000, 60_000)?.id, "saved");
  dropBrief(k);
});
