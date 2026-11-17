import { requireAdmin } from "@/platform/auth";
import { list, usageRows } from "@/platform/store";
import type { UsageResponse } from "@/platform/api-types";
import { handle, json } from "@/platform/route-kit";
import { API_LIMITS, MONEY_DECIMALS_FACTOR } from "@/config/app";
import { DAY_MS } from "@/config/locale";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req, "company_admin");
    const d = API_LIMITS.usageDays;
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days") ?? d.default) || d.default, d.min), d.max);
    const sinceIso = new Date(Date.now() - days * DAY_MS).toISOString();
    const rows = usageRows(tenant.id, sinceIso);
    const units = list("unit", tenant.id);
    const routes = list("route", tenant.id);
    const users = list("user", tenant.id);
    // A unit's own limit, or the nearest ancestor's; 0 when none is set.
    const limitOf = (id: string): number => {
      for (let u = units.find((x) => x.id === id); u; u = units.find((x) => x.id === u!.parentId)) if (u.profile.budgetMonthly !== null) return u.profile.budgetMonthly;
      return 0;
    };
    const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
      const m = new Map<K, typeof rows>();
      for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
      return [...m.entries()];
    };
    const sum = (rs: typeof rows, f: (r: (typeof rows)[number]) => number) => Math.round(rs.reduce((s, r) => s + f(r), 0) * MONEY_DECIMALS_FACTOR) / MONEY_DECIMALS_FACTOR;
    const body: UsageResponse = {
      sinceIso,
      byUnit: group((r) => r.unitId).map(([unitId, rs]) => ({ unitId, unitName: units.find((u) => u.id === unitId)?.name ?? unitId, cost: sum(rs, (r) => r.cost), limit: limitOf(unitId), calls: rs.length })).sort((a, b) => b.cost - a.cost),
      byRoute: group((r) => r.routeId).map(([routeId, rs]) => ({ routeId, label: routes.find((x) => x.id === routeId)?.label ?? routeId, cost: sum(rs, (r) => r.cost), inputTokens: sum(rs, (r) => r.inputTokens), outputTokens: sum(rs, (r) => r.outputTokens), calls: rs.length })).sort((a, b) => b.cost - a.cost),
      byUser: group((r) => r.userId).map(([userId, rs]) => ({ userId, name: users.find((u) => u.id === userId)?.name ?? userId, cost: sum(rs, (r) => r.cost), calls: rs.length })).sort((a, b) => b.cost - a.cost),
    };
    return json(body);
  });
}
