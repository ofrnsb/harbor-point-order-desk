// Our own tool loop over an OpenAI-compatible gateway. It emits the same stream events and trace as the Claude SDK path,
// so the UI cannot tell the backends apart.
import { z } from "zod";
import type { Effective, ModelRoute } from "../contract.ts";
import type { Chat, StreamEvent, TraceStep } from "../../lib/types.ts";
import { GatewayError, streamChat, type ChatMsg, type ToolSpec } from "./litellm.ts";
import { GATEWAY } from "../../config/server.ts";
import { PRESENT_TOOL } from "../../config/tools.ts";
import { ERR } from "../../copy/server.ts";

export type HostTool = { name: string; description: string; shape: z.ZodRawShape };
export type StepLabel = { kind: "tool"; label: string; doneLabel: string; writing?: string };
/** What the engine hands the loop: the tools, how to run one, and how to label it. */
export type ToolHost = {
  tools: HostTool[];
  call: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
  label: (name: string, input: Record<string, unknown>) => StepLabel | null;
};

export const MAX_ITERATIONS = GATEWAY.maxIterations;
export function toolSpecs(tools: HostTool[]): ToolSpec[] {
  return tools.map((t) => {
    const { $schema: _s, ...parameters } = z.toJSONSchema(z.object(t.shape)) as Record<string, unknown>;
    return { type: "function", function: { name: t.name, description: t.description, parameters } };
  });
}

/** A run_tool call that shows the answer on screen. */
const isPresent = (args: Record<string, unknown>) => args.name === PRESENT_TOOL;

export type LoopResult = { answer: string; trace: TraceStep[]; usage: { input: number; output: number }; failure: string | null; progressed: boolean };

export async function runLoop(o: {
  baseUrl: string; apiKey: string | null; route: ModelRoute;
  system: string; history: ChatMsg[]; userText: string;
  host: ToolHost;
  emit: (e: StreamEvent) => void; signal: AbortSignal;
  idleMs?: number;
}): Promise<LoopResult> {
  const specs = toolSpecs(o.host.tools);
  const messages: ChatMsg[] = [{ role: "system", content: o.system }, ...o.history, { role: "user", content: o.userText }];
  const trace: TraceStep[] = [];
  const usage = { input: 0, output: 0 };
  let answer = "";
  let held = "";
  let progressed = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let sawText = false;
    let res;
    try {
      res = await streamChat({
        baseUrl: o.baseUrl, apiKey: o.apiKey, model: o.route.model, messages, tools: specs, signal: o.signal, idleMs: o.idleMs,
        onText: (d) => {
          if (!sawText && answer.trim() && progressed) { answer += "\n\n"; o.emit({ t: "text", d: "\n\n" }); }
          sawText = true; progressed = true;
          answer += d; o.emit({ t: "text", d });
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const canFallback = err instanceof GatewayError && err.fallback && !progressed;
      return { answer: answer.trim(), trace, usage, failure: msg, progressed: progressed || !canFallback };
    }
    usage.input += res.usage.input;
    usage.output += res.usage.output;
    if (!res.toolCalls.length) {
      if (!answer.trim() && held) { answer = held; o.emit({ t: "text", d: held }); }
      return { answer: answer.trim(), trace, usage, failure: null, progressed };
    }

    messages.push({ role: "assistant", content: res.text || null, tool_calls: res.toolCalls });
    progressed = true;
    // Announce every call first so the bubbles appear together, then run them in order.
    const parsed = res.toolCalls.map((c) => {
      let args: Record<string, unknown> = {};
      let bad: string | null = null;
      try { const v = JSON.parse(c.function.arguments || "{}"); if (v && typeof v === "object" && !Array.isArray(v)) args = v; else bad = ERR.argumentsMustJsonObject; }
      catch { bad = ERR.argumentsWereNotValid; }
      const l = o.host.label(c.function.name, args);
      if (l) o.emit({ t: "step", id: c.id, ...l, status: "running" });
      return { c, args, bad, l, at: Date.now() };
    });
    // Text that came with steps was narration about them: drop it. Text before showing the answer alone is kept aside,
    // and comes back only if the model says nothing after showing the blocks.
    if (sawText) { held = parsed.every((p) => isPresent(p.args)) ? answer : ""; answer = ""; o.emit({ t: "reset" }); }
    for (const p of parsed) {
      let out: { text: string; isError: boolean };
      if (p.bad) out = { text: p.bad, isError: true };
      else if (!o.host.tools.some((t) => t.name === p.c.function.name)) out = { text: ERR.toolNotAvailable(p.c.function.name), isError: true };
      else {
        const t = o.host.tools.find((x) => x.name === p.c.function.name)!;
        const check = z.object(t.shape).safeParse(p.args);
        if (!check.success) out = { text: ERR.invalidArguments(check.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")), isError: true };
        else {
          try { out = await o.host.call(t.name, check.data as Record<string, unknown>); }
          catch (err) { out = { text: err instanceof Error ? err.message : String(err), isError: true }; }
        }
      }
      messages.push({ role: "tool", tool_call_id: p.c.id, content: out.text });
      if (p.l) {
        const status = out.isError ? "failed" : "done";
        const detail = out.text.split("\n")[0].slice(0, GATEWAY.traceDetailChars);
        trace.push({ id: p.c.id, kind: p.l.kind, label: p.l.doneLabel, detail, status, ms: Date.now() - p.at });
        o.emit({ t: "step", id: p.c.id, ...p.l, status, detail });
      }
      if (o.signal.aborted) return { answer: answer.trim(), trace, usage, failure: ERR.stopped, progressed };
    }
  }
  return { answer: answer.trim(), trace, usage, failure: ERR.stoppedAtStepLimit, progressed };
}

/** Tries candidates in order; moves on only when an attempt failed before anything reached the user. */
export async function withFallback<T extends { failure: string | null; progressed: boolean }>(
  candidates: ModelRoute[],
  attempt: (route: ModelRoute) => Promise<T>,
  onSwitch: (to: ModelRoute, reason: string) => void,
): Promise<{ route: ModelRoute; result: T; tried: { route: ModelRoute; result: T }[] }> {
  if (!candidates.length) throw new Error(ERR.noModelRouteAvailable);
  const tried: { route: ModelRoute; result: T }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const route = candidates[i];
    if (i > 0) onSwitch(route, tried[i - 1].result.failure ?? ERR.previousRouteFailed);
    const result = await attempt(route);
    tried.push({ route, result });
    if (!result.failure || result.progressed) return { route, result, tried };
  }
  const last = tried[tried.length - 1];
  return { route: last.route, result: last.result, tried };
}

/** Earlier turns as chat messages for the gateway loop, which keeps no server-side session. */
export function historyMessages(chat: Pick<Chat, "messages">, max = GATEWAY.historyMessages): ChatMsg[] {
  return chat.messages.slice(-max).filter((m) => m.text.trim()).map((m) => (m.role === "user" ? { role: "user" as const, content: m.text } : { role: "assistant" as const, content: m.text }));
}

/** Allowed fallbacks after `primary`: active, granted to the unit, and never external when the primary was kept internal. */
export function candidateRoutes(primary: ModelRoute, routes: ModelRoute[], eff: Pick<Effective, "models">, externalAllowed: boolean): ModelRoute[] {
  const out = [primary];
  for (const id of primary.fallbacks) {
    const r = routes.find((x) => x.id === id);
    if (!r || !r.active || !eff.models.includes(r.id) || out.includes(r)) continue;
    if (r.external && !externalAllowed) continue;
    out.push(r);
  }
  return out;
}

