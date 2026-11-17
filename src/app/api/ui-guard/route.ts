// Dev only: collects the browser's visibility, motion and runtime-error reports for verification.
import { API } from "@/copy/app-api";
import { GUARD_ERRORS_KEPT } from "@/config/app";
import { env } from "@/config/env";
const g = globalThis as unknown as { appGuard?: { ui?: unknown; motion?: unknown; errors?: unknown[] } };
const off = () => env.production;

export async function POST(req: Request) {
  if (off()) return new Response(null, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const last = (g.appGuard ??= {});
  if (body.error) last.errors = [...(last.errors ?? []), body.error].slice(-GUARD_ERRORS_KEPT);
  else if (body.motion) last.motion = body.motion;
  else last.ui = body;
  return Response.json({ ok: true });
}

export async function GET() {
  if (off()) return new Response(null, { status: 404 });
  const last = g.appGuard;
  return Response.json(last?.ui || last?.motion || last?.errors ? last : { note: API.guardEmpty });
}

export async function DELETE() {
  if (off()) return new Response(null, { status: 404 });
  g.appGuard = {};
  return Response.json({ ok: true });
}
