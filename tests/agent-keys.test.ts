import { before, test } from "node:test";
import assert from "node:assert/strict";
import { freshStore } from "./fixtures/tenant.ts";

let keys: typeof import("../src/platform/agent-keys.ts");
let store: Awaited<ReturnType<typeof freshStore>>["store"];
const KEY = `sk-ant-api03-${"x".repeat(40)}`;

before(async () => {
  ({ store } = await freshStore());
  keys = await import("../src/platform/agent-keys.ts");
});

test("only something shaped like an Anthropic key is accepted", () => {
  assert.equal(keys.isAgentKey(KEY), true);
  for (const bad of ["", "sk-ant-short", "sk-proj-" + "x".repeat(40), `sk-ant-${"x".repeat(30)} spaces`]) assert.equal(keys.isAgentKey(bad), false, bad);
});

test("a key is stored sealed, read back for its owner only, and forgotten on sign-out", () => {
  keys.saveAgentKey("t1", "u-op", KEY);
  const blob = store.secretBlob("agent-key:u-op");
  assert.ok(blob && !blob.includes(KEY), "the stored blob never holds the key in plain text");
  assert.equal(keys.agentKeyOf("u-op"), KEY);
  assert.equal(keys.agentKeyOf("u-mgr"), null);
  keys.forgetAgentKey("u-op");
  assert.equal(keys.agentKeyOf("u-op"), null);
});
