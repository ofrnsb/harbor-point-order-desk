import { requireAdmin } from "@/platform/auth";
import { auditAll, lastAudit, list, spendByUnit } from "@/platform/store";
import { verifyEvents } from "@/platform/audit";
import { monthStartIso } from "@/platform/policy";
import type { AdminOverview } from "@/platform/api-types";
import { handle, json } from "@/platform/route-kit";
import { MONEY_DECIMALS_FACTOR } from "@/config/app";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req);
    const catalog = list("catalog", tenant.id);
    const head = lastAudit(tenant.id);
    const waiting = list("work", tenant.id).filter((w) => w.state === "awaiting_approval");
    const root = list("unit", tenant.id).find((u) => !u.parentId);
    const body: AdminOverview = {
      tenant,
      counts: {
        units: list("unit", tenant.id).length, users: list("user", tenant.id).length, connections: list("connection", tenant.id).length,
        objects: catalog.length, restrictedColumns: catalog.reduce((n, o) => n + o.columns.filter((c) => c.sensitivity === "restricted").length, 0),
        actions: list("action", tenant.id).length, routes: list("route", tenant.id).length,
        pendingApprovals: waiting.length,
      },
      spendThisMonth: Math.round(Object.values(spendByUnit(tenant.id, monthStartIso())).reduce((a, b) => a + b, 0) * MONEY_DECIMALS_FACTOR) / MONEY_DECIMALS_FACTOR,
      auditHead: head ? { seq: head.seq, hash: head.hash } : null,
      audit: verifyEvents(auditAll(tenant.id)),
      budgetMonthly: root?.profile.budgetMonthly ?? null,
      attention: {
        approvals: { count: waiting.length, oldestAt: waiting.map((w) => w.createdAt).sort()[0] ?? null },
        failing: list("connection", tenant.id).filter((c) => c.status === "error").map((c) => ({ connectionId: c.id, code: c.code, name: c.name, note: c.statusNote })),
      },
    };
    return json(body);
  });
}
