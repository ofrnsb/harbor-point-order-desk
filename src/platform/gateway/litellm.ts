// OpenAI-compatible chat completions client for the LiteLLM proxy (or any OpenAI-compatible endpoint).
import { env } from "../../config/env.ts";
import { ERROR_DETAIL_CHARS, GATEWAY } from "../../config/server.ts";
import { ERR } from "../../copy/server.ts";
import { SECOND_MS } from "../../config/locale.ts";
// Streams text deltas, assembles tool calls from their deltas, and reads usage from the final chunk.

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type Completion = { text: string; toolCalls: ToolCall[]; usage: { input: number; output: number }; finish: string | null };

/** `fallback` says whether another route is worth trying (network, timeout, rate limit, 5xx, unknown model). */
export class GatewayError extends Error {
  readonly status: number | null;
  readonly fallback: boolean;
  constructor(message: string, status: number | null, fallback: boolean) { super(message); this.name = "GatewayError"; this.status = status; this.fallback = fallback; }
}

export function gatewayUrl(): string | null {
  const u = env.litellmUrl?.trim();
  return u ? u.replace(/\/+$/, "") : null;
}

export type StreamOpts = {
  baseUrl: string; apiKey: string | null; model: string;
  messages: ChatMsg[]; tools: ToolSpec[];
  signal: AbortSignal; onText: (d: string) => void;
  /** Max wait for the first byte and between chunks. */
  idleMs?: number;
  maxTokens?: number;
};

export async function streamChat(o: StreamOpts): Promise<Completion> {
  const idleMs = o.idleMs ?? GATEWAY.idleMs;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  o.signal.addEventListener("abort", onAbort);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, idleMs); };
  arm();
  try {
    let res: Response;
    try {
      res = await fetch(`${o.baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) },
        body: JSON.stringify({
          model: o.model, messages: o.messages, stream: true, stream_options: { include_usage: true },
          ...(o.tools.length ? { tools: o.tools, tool_choice: "auto" } : {}),
          ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
        }),
      });
    } catch (err) {
      if (o.signal.aborted) throw new GatewayError(ERR.dihentikan, null, false);
      throw new GatewayError(timedOut ? ERR.modelGatewayDidNot(Math.round(idleMs / SECOND_MS)) : ERR.modelGatewayUnreachable(err instanceof Error ? err.message : String(err)), null, true);
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const detail = (() => { try { const j = JSON.parse(body); return j?.error?.message ?? j?.detail ?? body; } catch { return body; } })();
      const fallback = res.status === 429 || res.status >= 500 || res.status === 404 || res.status === 408;
      throw new GatewayError(ERR.modelGateway(res.status, String(detail).slice(0, ERROR_DETAIL_CHARS)), res.status, fallback);
    }

    const out: Completion = { text: "", toolCalls: [], usage: { input: 0, output: 0 }, finish: null };
    const calls: { id: string; name: string; args: string }[] = [];
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let j: {
        choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        error?: { message?: string };
      };
      try { j = JSON.parse(data); } catch { return; }
      if (j.error) throw new GatewayError(ERR.modelError(j.error.message ?? "unknown"), null, !out.text);
      if (j.usage) out.usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
      for (const c of j.choices ?? []) {
        const d = c.delta ?? {};
        if (d.content) { out.text += d.content; o.onText(d.content); }
        for (const t of d.tool_calls ?? []) {
          const i = t.index ?? calls.length;
          calls[i] ??= { id: "", name: "", args: "" };
          if (t.id) calls[i].id = t.id;
          if (t.function?.name) calls[i].name += t.function.name;
          if (t.function?.arguments) calls[i].args += t.function.arguments;
        }
        if (c.finish_reason) out.finish = c.finish_reason;
      }
    };
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch (err) {
        if (o.signal.aborted) throw new GatewayError(ERR.dihentikan, null, false);
        throw new GatewayError(timedOut ? ERR.modelStreamStalledS(Math.round(idleMs / SECOND_MS)) : ERR.modelStreamBroke(err instanceof Error ? err.message : String(err)), null, !out.text);
      }
      if (chunk.done) break;
      arm();
      buf += dec.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, nl).replace(/\r$/, "")); buf = buf.slice(nl + 1); }
    }
    if (buf.trim()) handle(buf.trim());
    out.toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${i}_${crypto.randomUUID().slice(0, 6)}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
    return out;
  } finally {
    if (timer) clearTimeout(timer);
    o.signal.removeEventListener("abort", onAbort);
  }
}
