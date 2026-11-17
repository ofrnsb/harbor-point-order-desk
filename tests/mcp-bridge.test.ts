// The MCP bridge that gives an agent CLI (Codex) the app's tools: only a live turn's token opens it, the tool list comes
// from that turn's host, arguments are checked against each tool's own shape, and the token dies with the turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { handleMcp, openTurn } from "../src/lib/mcp-bridge.ts";
import type { ToolHost } from "../src/platform/gateway/loop.ts";

const calls: unknown[] = [];
const host: ToolHost = {
  tools: [{ name: "query_records", description: "Read records", shape: { object: z.string(), limit: z.number().int().max(100).default(10) } }],
  call: async (name, args) => { calls.push({ name, args }); return { text: `rows for ${String(args.object)} (limit ${String(args.limit)})`, isError: false }; },
  label: () => null,
};
const rpc = (method: string, params?: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 1, method, params });

test("without a live turn's token nothing is served", async () => {
  const r = await handleMcp("nope", rpc("tools/list"));
  assert.equal(r?.status, 401);
  assert.equal((await handleMcp(null, rpc("initialize")))?.status, 401);
});

test("initialize, then the turn's tools with JSON schemas from their own shapes", async () => {
  const t = openTurn(host, 60_000);
  const init = await handleMcp(t.token, rpc("initialize", { protocolVersion: "2025-06-18" }));
  assert.equal((init?.body as { result: { serverInfo: { name: string } } }).result.serverInfo.name, "order-desk");
  assert.equal(await handleMcp(t.token, { jsonrpc: "2.0", method: "notifications/initialized" }), null, "a notification gets no body");
  const list = (await handleMcp(t.token, rpc("tools/list")))?.body as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }[] } };
  assert.deepEqual(list.result.tools.map((x) => x.name), ["query_records"]);
  assert.deepEqual(Object.keys(list.result.tools[0].inputSchema.properties), ["object", "limit"]);
  t.close();
});

test("a call runs through the host with defaults applied; bad arguments are refused before the host sees them", async () => {
  const t = openTurn(host, 60_000);
  calls.length = 0;
  const r = (await handleMcp(t.token, rpc("tools/call", { name: "query_records", arguments: { object: "invoices" } })))?.body as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(r.result.content[0].text, "rows for invoices (limit 10)");
  assert.equal(r.result.isError, false);
  const bad = (await handleMcp(t.token, rpc("tools/call", { name: "query_records", arguments: { object: "x", limit: 5000 } })))?.body as { result: { isError: boolean } };
  assert.equal(bad.result.isError, true);
  const unknown = (await handleMcp(t.token, rpc("tools/call", { name: "Bash", arguments: { command: "cat /etc/passwd" } })))?.body as { result: { isError: boolean } };
  assert.equal(unknown.result.isError, true, "only the turn's tools exist");
  assert.equal(calls.length, 1);
  t.close();
});

test("the token stops working when the turn closes or its time runs out", async () => {
  const t = openTurn(host, 60_000);
  t.close();
  assert.equal((await handleMcp(t.token, rpc("tools/list")))?.status, 401);
  const old = openTurn(host, -1);
  assert.equal((await handleMcp(old.token, rpc("tools/list")))?.status, 401);
});
