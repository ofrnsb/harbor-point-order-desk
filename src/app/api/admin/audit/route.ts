import { requireAdmin } from "@/platform/auth";
import { auditPage, list } from "@/platform/store";
import type { AuditResponse } from "@/platform/api-types";
import { handle, json } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";
import { API_LIMITS, AUDIT_KINDS, SYSTEM_ACTOR } from "@/config/app";

export const dynamic = "force-dynamic";
const KINDS = new Set<string>(AUDIT_KINDS);

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req, "security_admin");
    const q = new URL(req.url).searchParams;
    const before = Number(q.get("before")) || undefined;
    const kind = q.get("kind") && KINDS.has(q.get("kind")!) ? q.get("kind")! : undefined;
    const p = API_LIMITS.auditPage;
    const limit = Math.min(Math.max(Number(q.get("limit")) || p.default, p.min), p.max);
    const events = auditPage(tenant.id, { beforeSeq: before, limit, kind, userId: q.get("userId") || undefined });
    const names = new Map(list("user", tenant.id).map((u) => [u.id, u.name]));
    // Targets are stored as ids; the reader sees what they name. An id nothing names any more is shown as it was.
    const conns = list("connection", tenant.id);
    const targets = new Map<string, string>([
      ...[...names].map(([id, n]) => [id, n] as [string, string]),
      ...conns.map((c) => [c.id, `${c.code} · ${c.name}`] as [string, string]),
      ...list("unit", tenant.id).map((u) => [u.id, u.name] as [string, string]),
      ...list("route", tenant.id).map((r) => [r.id, r.label] as [string, string]),
      ...list("action", tenant.id).map((a) => [a.id, a.name] as [string, string]),
    ]);
    const targetName = (t: string) => targets.get(t) ?? ((m) => (m ? `${conns.find((c) => c.id === m[1])?.code ?? m[1]} · ${m[2]}` : t))(/^([^/]+)\/(.+)$/.exec(t));
    const body: AuditResponse = {
      events: events.map((e) => ({ ...e, targetName: targetName(e.target), actorName: names.get(e.actor.userId) ?? (e.actor.userId === SYSTEM_ACTOR ? M.systemActor : e.actor.userId) })),
      next: events.length === limit ? events[events.length - 1].seq : null,
    };
    return json(body);
  });
}
