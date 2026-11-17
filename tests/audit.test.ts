import assert from "node:assert/strict";
import { before, test } from "node:test";
import { freshStore } from "./fixtures/tenant.ts";

let audit: typeof import("../src/platform/audit.ts");
let store: Awaited<ReturnType<typeof freshStore>>["store"];
let auth: typeof import("../src/platform/auth.ts");
before(async () => { ({ store } = await freshStore()); audit = await import("../src/platform/audit.ts"); auth = await import("../src/platform/auth.ts"); });

test("the audit chain verifies and detects an edited event", () => {
  const actor = { userId: "u1", unitId: "x", role: "operator" };
  for (let i = 0; i < 5; i++) audit.record({ tenantId: "t1", actor, kind: "query", target: `ERP/invoices`, detail: { i } });
  audit.record({ tenantId: "t2", actor, kind: "query", target: "other tenant" });
  assert.deepEqual(audit.verifyChain("t1"), { ok: true, checked: 5, brokenAt: null });
  const events = store.auditAll("t1");
  assert.equal(events[1].prevHash, events[0].hash);
  const tampered = events.map((e, i) => (i === 2 ? { ...e, detail: { i: 99 } } : e));
  assert.equal(audit.verifyEvents(tampered).brokenAt, events[2].seq);
  assert.equal(audit.verifyEvents(events.filter((_, i) => i !== 3)).ok, false, "a deleted event breaks the chain");
});

test("session tokens round-trip and reject tampering and expiry", () => {
  const t = auth.sessionToken("u-rina", 1_000_000);
  assert.equal(auth.readToken(t, 1_000_000), "u-rina");
  assert.equal(auth.readToken(t.replace("u-rina", "u-lina"), 1_000_000), null);
  assert.equal(auth.readToken(t, 1_000_000 + 9 * 3600_000), null);
  assert.equal(auth.readToken("garbage", 0), null);
});
