import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { streamChat, GatewayError } from "../src/platform/gateway/litellm.ts";
import { runLoop, toolSpecs, withFallback, type ToolHost } from "../src/platform/gateway/loop.ts";
import type { ModelRoute } from "../src/platform/contract.ts";
import type { StreamEvent } from "../src/lib/types.ts";

// A scripted OpenAI-compatible server. The model name picks the script.
const seen: { model: string; messages: { role: string; content: string | null }[]; auth: string | undefined }[] = [];
let base = "";
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    seen.push({ model: body.model, messages: body.messages, auth: req.headers.authorization });
    const sse = (chunks: unknown[], end = true) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
      if (end) { res.write("data: [DONE]\n\n"); res.end(); }
    };
    const usage = (p: number, c: number) => ({ choices: [], usage: { prompt_tokens: p, completion_tokens: c } });
    if (body.model === "fail500") { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "upstream down" } })); return; }
    if (body.model === "bad400") { res.writeHead(400); res.end(JSON.stringify({ error: { message: "bad tools" } })); return; }
    if (body.model === "text-then-die") {
      sse([{ choices: [{ delta: { content: "Sebagian jawa" } }] }], false);
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (body.model === "narrator") {
      const hasToolResult = body.messages.some((m: { role: string }) => m.role === "tool");
      if (!hasToolResult) {
        sse([
          { choices: [{ delta: { content: "Let me check that order." } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"SO-24051\"}" } }] }, finish_reason: "tool_calls" }] },
          usage(100, 10),
        ]);
      } else sse([{ choices: [{ delta: { content: "SO-24051 is open and unshipped." }, finish_reason: "stop" }] }, usage(150, 6)]);
      return;
    }
    if (body.model === "presenter" || body.model === "silent-presenter") {
      const hasToolResult = body.messages.some((m: { role: string }) => m.role === "tool");
      if (!hasToolResult) {
        sse([
          { choices: [{ delta: { content: "Here are the results as a table." } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_p", function: { name: "run_tool", arguments: "{\"name\":\"present\",\"input\":{}}" } }] }, finish_reason: "tool_calls" }] },
          usage(100, 10),
        ]);
      } else sse([{ choices: [{ delta: body.model === "presenter" ? { content: "There are 3 open orders." } : {}, finish_reason: "stop" }] }, usage(150, 6)]);
      return;
    }
    if (body.model === "tooler") {
      const hasToolResult = body.messages.some((m: { role: string }) => m.role === "tool");
      if (!hasToolResult) {
        // Arguments arrive split across deltas, as real providers send them.
        sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":" } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"SO-24051\"}" } }] }, finish_reason: "tool_calls" }] },
          usage(120, 15),
        ]);
      } else {
        sse([{ choices: [{ delta: { content: "SO-24051 is open " } }] }, { choices: [{ delta: { content: "and unshipped." }, finish_reason: "stop" }] }, usage(200, 9)]);
      }
      return;
    }
    sse([{ choices: [{ delta: { content: "Halo " } }] }, { choices: [{ delta: { content: "Rina" }, finish_reason: "stop" }] }, usage(40, 3)]);
  });
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

const route = (id: string, model: string, extra: Partial<ModelRoute> = {}): ModelRoute => ({
  id, tenantId: "t", label: id, provider: "openai", model, backend: "litellm", external: true, fallbacks: [], inputPer1M: 0, outputPer1M: 0, active: true, ...extra,
});

const host = (calls: unknown[] = []): ToolHost => ({
  tools: [{ name: "lookup", description: "Find an invoice", shape: { q: z.string().min(3) } }],
  call: async (name, args) => { calls.push({ name, args }); return { text: `ref=r_1 invoice ${String(args.q)} overdue 64 days`, isError: false }; },
  label: (name, input) => (name === "lookup" ? { kind: "tool", label: `Looking up ${String(input.q)}`, doneLabel: `Looked up ${String(input.q)}` } : null),
});

test("streamChat streams text deltas, reads usage and sends the key", async () => {
  const deltas: string[] = [];
  const r = await streamChat({ baseUrl: base, apiKey: "sk-unit", model: "plain", messages: [{ role: "user", content: "hai" }], tools: [], signal: new AbortController().signal, onText: (d) => deltas.push(d) });
  assert.deepEqual(deltas, ["Halo ", "Rina"]);
  assert.equal(r.text, "Halo Rina");
  assert.deepEqual(r.usage, { input: 40, output: 3 });
  assert.equal(r.finish, "stop");
  assert.equal(seen.at(-1)?.auth, "Bearer sk-unit");
});

test("a 500 is a fallback-worthy error; a 400 is not", async () => {
  const call = (model: string) => streamChat({ baseUrl: base, apiKey: null, model, messages: [{ role: "user", content: "x" }], tools: [], signal: new AbortController().signal, onText: () => {} });
  await assert.rejects(call("fail500"), (e: unknown) => e instanceof GatewayError && e.status === 500 && e.fallback && /upstream down/.test(e.message));
  await assert.rejects(call("bad400"), (e: unknown) => e instanceof GatewayError && e.status === 400 && !e.fallback);
});

test("an unreachable gateway is fallback-worthy", async () => {
  await assert.rejects(
    streamChat({ baseUrl: "http://127.0.0.1:1", apiKey: null, model: "x", messages: [], tools: [], signal: new AbortController().signal, onText: () => {} }),
    (e: unknown) => e instanceof GatewayError && e.fallback && e.status === null,
  );
});

test("the loop runs a tool round trip and emits the same events as the SDK path", async () => {
  const events: StreamEvent[] = [];
  const calls: unknown[] = [];
  const r = await runLoop({ baseUrl: base, apiKey: null, route: route("r1", "tooler"), system: "sys", history: [{ role: "user", content: "earlier" }], userText: "check SO-24051", host: host(calls), emit: (e) => events.push(e), signal: new AbortController().signal });
  assert.equal(r.failure, null);
  assert.equal(r.answer, "SO-24051 is open and unshipped.");
  assert.deepEqual(calls, [{ name: "lookup", args: { q: "SO-24051" } }]);
  assert.deepEqual(r.usage, { input: 320, output: 24 });
  assert.equal(r.trace.length, 1);
  assert.equal(r.trace[0].label, "Looked up SO-24051");
  assert.equal(r.trace[0].status, "done");
  const steps = events.filter((e) => e.t === "step");
  assert.deepEqual(steps.map((e) => (e as { status: string }).status), ["running", "done"]);
  // The tool result went back to the model, and the history came before the user text.
  const last = seen.at(-1)!;
  assert.deepEqual(last.messages.map((m) => m.role), ["system", "user", "user", "assistant", "tool"]);
  assert.match(String(last.messages[4].content), /overdue 64 days/);
});

test("invalid tool arguments are returned to the model as a failed step, not run", async () => {
  const calls: unknown[] = [];
  const h = host(calls);
  h.tools[0].shape = { q: z.string().min(20) };
  const events: StreamEvent[] = [];
  const r = await runLoop({ baseUrl: base, apiKey: null, route: route("r1", "tooler"), system: "s", history: [], userText: "x", host: h, emit: (e) => events.push(e), signal: new AbortController().signal });
  assert.equal(calls.length, 0);
  assert.equal(r.trace[0].status, "failed");
  assert.match(r.trace[0].detail, /Invalid arguments/);
});

test("fallback: a route that fails before anything streamed hands over to the next one", async () => {
  const switched: string[] = [];
  const out = await withFallback([route("a", "fail500"), route("b", "plain")], (r) => runLoop({ baseUrl: base, apiKey: null, route: r, system: "s", history: [], userText: "hai", host: host(), emit: () => {}, signal: new AbortController().signal }), (to) => switched.push(to.id));
  assert.equal(out.route.id, "b");
  assert.equal(out.result.failure, null);
  assert.equal(out.result.answer, "Halo Rina");
  assert.deepEqual(switched, ["b"]);
  assert.equal(out.tried.length, 2);
});

test("no fallback once text reached the user", async () => {
  const switched: string[] = [];
  const events: StreamEvent[] = [];
  const out = await withFallback([route("a", "text-then-die"), route("b", "plain")], (r) => runLoop({ baseUrl: base, apiKey: null, route: r, system: "s", history: [], userText: "hai", host: host(), emit: (e) => events.push(e), signal: new AbortController().signal }), (to) => switched.push(to.id));
  assert.equal(out.route.id, "a");
  assert.ok(out.result.failure);
  assert.equal(out.result.answer, "Sebagian jawa");
  assert.deepEqual(switched, []);
});

test("a non-fallback error (400) stops without trying the next route", async () => {
  const out = await withFallback([route("a", "bad400"), route("b", "plain")], (r) => runLoop({ baseUrl: base, apiKey: null, route: r, system: "s", history: [], userText: "hai", host: host(), emit: () => {}, signal: new AbortController().signal }), () => {});
  assert.equal(out.route.id, "a");
  assert.match(out.result.failure ?? "", /400/);
});

test("tool specs are JSON Schema objects without the $schema key", () => {
  const [spec] = toolSpecs([{ name: "lookup", description: "d", shape: { q: z.string(), limit: z.number().int().optional() } }]);
  assert.equal(spec.function.name, "lookup");
  assert.equal(spec.function.parameters.type, "object");
  assert.equal("$schema" in spec.function.parameters, false);
  assert.deepEqual(spec.function.parameters.required, ["q"]);
});

test("text written before a working step is narration: it is reset and not part of the answer", async () => {
  const events: StreamEvent[] = [];
  const r = await runLoop({ baseUrl: base, apiKey: null, route: route("r1", "narrator"), system: "s", history: [], userText: "check SO-24051", host: host([]), emit: (e) => events.push(e), signal: new AbortController().signal });
  assert.equal(r.answer, "SO-24051 is open and unshipped.");
  const kinds = events.map((e) => e.t);
  assert.ok(kinds.indexOf("reset") > kinds.indexOf("text") && kinds.indexOf("reset") < kinds.lastIndexOf("text"), kinds.join(","));
});

test("text before showing the answer is dropped when an answer follows, and comes back when nothing follows", async () => {
  const run = (model: string) => runLoop({ baseUrl: base, apiKey: null, route: route("r1", model), system: "s", history: [], userText: "open orders", host: host([]), emit: () => {}, signal: new AbortController().signal });
  assert.equal((await run("presenter")).answer, "There are 3 open orders.");
  assert.equal((await run("silent-presenter")).answer, "Here are the results as a table.");
});
