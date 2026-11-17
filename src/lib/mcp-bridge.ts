// The app's tools for an agent CLI that runs as its own process (Codex): one MCP endpoint, one bearer token per turn.
// The token maps to that turn's tool host, so every call still runs with the turn's scope, masking and audit, and stops
// working the moment the turn ends.
import crypto from "node:crypto";
import { z } from "zod";
import type { ToolHost } from "../platform/gateway/loop.ts";
import { CODEX } from "../config/server.ts";

type Open = { host: ToolHost; until: number };
const g = globalThis as unknown as { orderDeskMcp?: Map<string, Open> };
const turns = (g.orderDeskMcp ??= new Map());

/** A token for this turn's tools, valid until `close` is called or the time limit passes. */
export function openTurn(host: ToolHost, ttlMs: number): { token: string; close: () => void } {
  const token = crypto.randomBytes(24).toString("base64url");
  turns.set(token, { host, until: Date.now() + ttlMs });
  return { token, close: () => turns.delete(token) };
}

function hostFor(token: string | null): ToolHost | null {
  if (!token) return null;
  const t = turns.get(token);
  if (!t) return null;
  if (t.until < Date.now()) { turns.delete(token); return null; }
  return t.host;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One MCP JSON-RPC message (Streamable HTTP, JSON responses). Returns null for a notification. */
export async function handleMcp(token: string | null, msg: Rpc): Promise<{ status: number; body: unknown } | null> {
  const host = hostFor(token);
  if (!host) return { status: 401, body: fail(msg.id, -32001, "Unknown or expired turn") };
  if (msg.id === undefined || msg.id === null) return null;
  switch (msg.method) {
    case "initialize":
      return { status: 200, body: ok(msg.id, { protocolVersion: String(msg.params?.protocolVersion ?? "2025-06-18"), capabilities: { tools: {} }, serverInfo: { name: CODEX.mcpServer, version: "1" } }) };
    case "ping":
      return { status: 200, body: ok(msg.id, {}) };
    case "tools/list":
      return { status: 200, body: ok(msg.id, { tools: host.tools.map((t) => {
        const { $schema: _s, ...inputSchema } = z.toJSONSchema(z.object(t.shape)) as Record<string, unknown>;
        return { name: t.name, description: t.description, inputSchema };
      }) }) };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const t = host.tools.find((x) => x.name === name);
      if (!t) return { status: 200, body: ok(msg.id, { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true }) };
      const parsed = z.object(t.shape).safeParse(args);
      if (!parsed.success) return { status: 200, body: ok(msg.id, { content: [{ type: "text", text: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }], isError: true }) };
      try {
        const r = await host.call(name, parsed.data as Record<string, unknown>);
        return { status: 200, body: ok(msg.id, { content: [{ type: "text", text: r.text }], isError: r.isError }) };
      } catch (err) {
        return { status: 200, body: ok(msg.id, { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true }) };
      }
    }
    default:
      return { status: 200, body: fail(msg.id, -32601, `Method not found: ${msg.method}`) };
  }
}
