import { test } from "node:test";
import assert from "node:assert/strict";
import { modelCost } from "../src/platform/gateway/pricing.ts";
import { candidateRoutes, historyMessages } from "../src/platform/gateway/loop.ts";
import type { ModelRoute } from "../src/platform/contract.ts";

const r = (id: string, extra: Partial<ModelRoute> = {}): ModelRoute => ({
  id, tenantId: "t", label: id, provider: "anthropic", model: id, backend: "litellm", external: true, fallbacks: [], inputPer1M: 3, outputPer1M: 15, active: true, ...extra,
});

test("cost in the tenant currency follows the route's per-million prices", () => {
  assert.equal(modelCost(r("a"), 1_000_000, 0), 3);
  assert.equal(modelCost(r("a"), 1_000_000, 1_000_000), 18);
  assert.equal(modelCost(r("a"), 12_345, 678), 0.05); // 0.037035 + 0.01017, to the cent
  assert.equal(modelCost(r("a"), 0, 0), 0);
  assert.equal(modelCost(r("a"), -5, -5), 0);
  assert.equal(modelCost({ inputPer1M: 0, outputPer1M: 0 }, 5_000_000, 5_000_000), 0);
});

test("fallbacks keep only active, granted routes, in order, without duplicates", () => {
  const routes = [r("p", { fallbacks: ["off", "x", "p", "y", "z"] }), r("off", { active: false }), r("x"), r("y"), r("z")];
  assert.deepEqual(candidateRoutes(routes[0], routes, { models: ["p", "off", "x", "z"] }, true).map((x) => x.id), ["p", "x", "z"]);
});

test("a route kept internal never falls back to an external one", () => {
  const routes = [r("local", { external: false, fallbacks: ["cloud", "local2"] }), r("cloud"), r("local2", { external: false })];
  assert.deepEqual(candidateRoutes(routes[0], routes, { models: ["local", "cloud", "local2"] }, false).map((x) => x.id), ["local", "local2"]);
});

test("history keeps the last turns as plain chat messages and skips empty ones", () => {
  const at = "2026-11-09T00:00:00Z";
  const h = historyMessages({ messages: [
    { id: "1", role: "user", text: "check SO-24051", at },
    { id: "2", role: "agent", text: "", blocks: [], trace: [], error: "x", at },
    { id: "3", role: "agent", text: "It is open and unshipped.", blocks: [], trace: [], error: null, at },
  ] });
  assert.deepEqual(h, [{ role: "user", content: "check SO-24051" }, { role: "assistant", content: "It is open and unshipped." }]);
});
