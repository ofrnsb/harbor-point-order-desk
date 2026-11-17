// The agent sees categories and names each turn, reads a tool before running it, and every input is validated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { catalogHost, toolIndex, type CatalogTool } from "../src/lib/tool-catalog.ts";
import { META_TOOLS } from "../src/config/tools.ts";

const ran: Record<string, unknown>[] = [];
const tool = (name: string, category: CatalogTool["category"], description = `How to use ${name}.`): CatalogTool => ({
  name, category, description, shape: { sku: z.string().regex(/^HPS-\d{4}$/), qty: z.number().int().positive().optional() },
  label: (input) => ({ kind: "tool", label: `Running ${name} ${String(input.sku ?? "")}`.trim(), doneLabel: `Ran ${name}` }),
  call: async (args) => { ran.push(args); return { text: `ok ${String(args.sku)}`, isError: false }; },
});
const tools = [tool("query_records", "data"), tool("check_stock", "data"), tool("open_request", "work")];

test("the index lists each non-empty category with its tool names, never their descriptions", () => {
  const index = toolIndex(tools);
  assert.match(index, /^- data \(.+\): query_records, check_stock$/m);
  assert.match(index, /^- work \(.+\): open_request$/m);
  assert.doesNotMatch(index, /How to use/);
  assert.doesNotMatch(index, /- messages/, "a category with no tools is left out");
});

test("the model sees only the two meta-tools", () => {
  assert.deepEqual(catalogHost(tools).tools.map((t) => t.name), [META_TOOLS.describe, META_TOOLS.run]);
});

test("a tool must be read before it runs, then runs with validated input", async () => {
  const host = catalogHost(tools);
  const early = await host.call(META_TOOLS.run, { name: "check_stock", input: { sku: "HPS-1302" } });
  assert.equal(early.isError, true);
  assert.match(early.text, /describe_tools/);
  assert.equal(ran.length, 0, "nothing ran before the tool was read");

  const read = await host.call(META_TOOLS.describe, { names: ["check_stock"] });
  assert.equal(read.isError, false);
  assert.match(read.text, /How to use check_stock\./);
  assert.match(read.text, /"sku"/, "the input schema comes with the description");

  const bad = await host.call(META_TOOLS.run, { name: "check_stock", input: { sku: "1302", qty: -2 } });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /sku/);
  assert.match(bad.text, /qty/);
  assert.equal(ran.length, 0, "invalid input never reaches the tool");

  const ok = await host.call(META_TOOLS.run, { name: "check_stock", input: { sku: "HPS-1302", qty: 12 } });
  assert.deepEqual(ok, { text: "ok HPS-1302", isError: false });
  assert.deepEqual(ran.at(-1), { sku: "HPS-1302", qty: 12 });
});

test("reading a tool in one turn does not unlock it in the next", async () => {
  const first = catalogHost(tools);
  await first.call(META_TOOLS.describe, { names: ["query_records"] });
  const next = catalogHost(tools);
  assert.equal((await next.call(META_TOOLS.run, { name: "query_records", input: { sku: "HPS-1001" } })).isError, true);
});

test("unknown tools are named with the ones that exist", async () => {
  const host = catalogHost(tools);
  const r = await host.call(META_TOOLS.describe, { names: ["draft_order"] });
  assert.equal(r.isError, true);
  assert.match(r.text, /draft_order/);
  assert.match(r.text, /query_records, check_stock, open_request/);
});

test("a run step shows the tool it runs, and a neutral step until the name is written", () => {
  const host = catalogHost(tools);
  assert.equal(host.label(META_TOOLS.run, { name: "check_stock", input: { sku: "HPS-1302" } })?.label, "Running check_stock HPS-1302");
  const early = host.label(META_TOOLS.run, {});
  assert.ok(early && early.writing, "before the name streams in, the step says it is preparing");
});
