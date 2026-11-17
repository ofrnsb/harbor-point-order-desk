import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { get, list, put, remove } from "@/platform/store";
import { gatewayStatus } from "@/platform/gateway/status";
import type { ModelRoute } from "@/platform/contract";
import type { RoutesResponse } from "@/platform/api-types";
import { RouteS, adminAudit, body, fail, handle, json, owned, slug } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";

export const dynamic = "force-dynamic";

function checkRoute(r: Omit<ModelRoute, "tenantId">, tenantId: string): string | null {
  const bad = r.fallbacks.find((f) => f === r.id || get("route", f)?.tenantId !== tenantId);
  return bad ? M.badFallback(bad) : null;
}

export async function GET(req: Request) {
  return handle(async () => {
    const { tenant } = requireAdmin(req, "company_admin");
    return json({ routes: list("route", tenant.id), gateway: await gatewayStatus() } satisfies RoutesResponse);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, RouteS);
    const id = b.id ?? slug(`${b.provider}-${b.model}`);
    if (get("route", id)) return fail(M.routeExists(id), 409);
    const r: ModelRoute = { ...b, id, tenantId: tenant.id };
    const problem = checkRoute(r, tenant.id);
    if (problem) return fail(problem, 422);
    put("route", r);
    adminAudit(user, id, { op: "create_route", provider: b.provider, model: b.model, external: b.external });
    return json({ route: r }, 201);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, RouteS.and(z.object({ id: z.string().min(1) })));
    owned("route", b.id, tenant.id);
    const r: ModelRoute = { ...b, tenantId: tenant.id };
    const problem = checkRoute(r, tenant.id);
    if (problem) return fail(problem, 422);
    put("route", r);
    adminAudit(user, b.id, { op: "update_route", active: b.active, external: b.external });
    return json({ route: r });
  });
}

export async function DELETE(req: Request) {
  return handle(() => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const id = new URL(req.url).searchParams.get("id") ?? "";
    owned("route", id, tenant.id);
    remove("route", id);
    adminAudit(user, id, { op: "delete_route" });
    return json({ ok: true });
  });
}
