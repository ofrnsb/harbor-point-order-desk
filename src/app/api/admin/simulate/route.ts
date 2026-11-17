import { requireAdmin } from "@/platform/auth";
import { pathLabel, resolveEffective } from "@/platform/org";
import { scopeSummary } from "@/platform/policy";
import type { SimulateResponse } from "@/platform/api-types";
import { fail, handle, json, owned } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";

export const dynamic = "force-dynamic";

/** "View as": the exact scope a user gets while acting as a unit, computed by the same code the agent uses. */
export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req, "company_admin");
    const q = new URL(req.url).searchParams;
    const userId = q.get("userId") ?? "";
    const unitId = q.get("unitId") ?? "";
    const u = owned("user", userId, tenant.id);
    owned("unit", unitId, tenant.id);
    let eff;
    try { eff = resolveEffective(userId, unitId); } catch (err) { return fail(err instanceof Error ? err.message : M.notUnitMember, 422); }
    const body: SimulateResponse = {
      user: { id: eff.unit.id, name: eff.unit.name, code: eff.unit.code, path: pathLabel(eff.path), userName: u.name, role: eff.role },
      scope: scopeSummary(eff), can: eff.can,
    };
    return json(body);
  });
}
