import { requireAdmin } from "@/platform/auth";
import { record } from "@/platform/audit";
import { auditAll, get } from "@/platform/store";
import { handle } from "@/platform/route-kit";
import { AUDIT_EXPORT_COLUMNS, AUDIT_EXPORT_MAX_TO } from "@/config/app";

export const dynamic = "force-dynamic";

/** One CSV cell: quoted, and neutralised when a spreadsheet would read it as a formula. */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The whole chain (or ?from=&to= ISO dates) as CSV for auditors, hashes included so it can be re-verified offline. */
export async function GET(req: Request) {
  return handle(() => {
    const { user, tenant } = requireAdmin(req, "security_admin");
    const q = new URL(req.url).searchParams;
    const from = q.get("from") ?? "";
    const to = q.get("to") ?? AUDIT_EXPORT_MAX_TO;
    const events = auditAll(tenant.id).filter((e) => e.at >= from && e.at <= to);
    const names = new Map<string, string>();
    const nameOf = (id: string) => names.get(id) ?? (names.set(id, get("user", id)?.name ?? id), names.get(id)!);
    const head = AUDIT_EXPORT_COLUMNS;
    const rows = events.map((e) => [e.seq, e.at, e.actor.userId, nameOf(e.actor.userId), e.actor.unitId, e.actor.role, e.kind, e.target, e.detail, e.prevHash, e.hash].map(csvCell).join(","));
    record({ tenantId: tenant.id, actor: { userId: user.id, unitId: null, role: "security_admin" }, kind: "admin", target: "audit:export", detail: { from: from || null, to: q.get("to"), events: events.length } });
    return new Response([head.join(","), ...rows].join("\r\n") + "\r\n", {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${tenant.id}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  });
}
