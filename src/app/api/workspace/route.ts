import { requireUser } from "@/platform/auth";
import { pathLabel, resolveEffective } from "@/platform/org";
import { scopeSummary } from "@/platform/policy";
import { queueFor, teamMetrics } from "@/platform/work";
import { dataStarters } from "@/platform/starters";
import { list } from "@/platform/store";
import type { WorkspaceResponse } from "@/platform/api-types";
import { fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    const unitId = new URL(req.url).searchParams.get("unitId") ?? "";
    if (!unitId) return fail(API.unitIdRequired);
    let eff;
    try { eff = resolveEffective(user.id, unitId); } catch { return fail(API.notMember, 403); }
    // Only objects and columns this team may read shape the opening questions.
    const visible = list("catalog", tenant.id).flatMap((o) => {
      const grant = o.exposed ? eff.data[o.connectionId]?.[o.name] : undefined;
      return grant ? [{ ...o, columns: o.columns.filter((c) => grant.columns[c.name] === "show") }] : [];
    });
    const body: WorkspaceResponse = {
      unit: { id: eff.unit.id, name: eff.unit.name, code: eff.unit.code, path: pathLabel(eff.path) },
      role: eff.role,
      scope: scopeSummary(eff),
      queue: queueFor(user.id, unitId),
      metrics: await teamMetrics(eff),
      starters: dataStarters(visible),
    };
    return json(body);
  });
}
