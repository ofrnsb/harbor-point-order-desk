import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { validateProfile } from "@/platform/org";
import { list, memberships, put, remove } from "@/platform/store";
import type { UnitsResponse } from "@/platform/api-types";
import { unitTree, ProfileS, adminAudit, body, emptyProfile, fail, handle, json, newId, owned } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";
import { API_LIMITS } from "@/config/app";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req, "company_admin");
    return json({ units: unitTree(list("unit", tenant.id), tenant.levels) } satisfies UnitsResponse);
  });
}

const Code = z.string().trim().min(API_LIMITS.unitCode.min).max(API_LIMITS.unitCode.max).regex(/^[A-Z0-9-]+$/, M.codeFormat);

export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, z.object({ parentId: z.string().min(1), name: z.string().trim().min(API_LIMITS.name.min).max(API_LIMITS.name.max), code: Code }));
    owned("unit", b.parentId, tenant.id);
    if (list("unit", tenant.id).some((u) => u.code === b.code)) return fail(M.codeTaken(b.code), 409);
    const unit = put("unit", { id: newId("unit", b.code), tenantId: tenant.id, parentId: b.parentId, name: b.name, code: b.code, profile: emptyProfile() });
    adminAudit(user, unit.id, { op: "create_unit", parentId: b.parentId, name: b.name });
    return json({ unit }, 201);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, z.object({ id: z.string().min(1), name: z.string().trim().min(API_LIMITS.name.min).max(API_LIMITS.name.max).optional(), code: Code.optional(), profile: ProfileS.optional() }));
    const unit = owned("unit", b.id, tenant.id);
    if (b.code && b.code !== unit.code && list("unit", tenant.id).some((u) => u.code === b.code)) return fail(M.codeTaken(b.code), 409);
    if (b.profile) {
      const problems = validateProfile(unit.id, b.profile);
      if (problems.length) return fail(M.profileTooWide, 422, { problems });
    }
    const next = put("unit", { ...unit, ...(b.name ? { name: b.name } : {}), ...(b.code ? { code: b.code } : {}), ...(b.profile ? { profile: b.profile } : {}) });
    adminAudit(user, unit.id, { op: "update_unit", fields: Object.keys(b).filter((k) => k !== "id") });
    return json({ unit: next });
  });
}

export async function DELETE(req: Request) {
  return handle(() => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const unit = owned("unit", id, tenant.id);
    if (!unit.parentId) return fail(M.rootUnit, 409);
    if (list("unit", tenant.id).some((u) => u.parentId === id)) return fail(M.subUnitsFirst, 409);
    if (memberships({ unitId: id }).length) return fail(M.unitHasMembers, 409);
    remove("unit", id);
    adminAudit(user, id, { op: "delete_unit", name: unit.name });
    return json({ ok: true });
  });
}
