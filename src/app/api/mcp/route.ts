import { handleMcp } from "@/lib/mcp-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The app's tools over MCP for an agent CLI the server started for one turn; the bearer token is that turn's. */
export async function POST(req: Request) {
  const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
  const msg = await req.json().catch(() => null);
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  const r = await handleMcp(token, msg);
  return r ? Response.json(r.body, { status: r.status }) : new Response(null, { status: 202 });
}

/** No server-initiated stream: every reply comes back on its POST. */
export function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
