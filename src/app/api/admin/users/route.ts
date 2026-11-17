import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { get, list, memberships, put, setPasswordHash } from "@/platform/store";
import { hashPassword } from "@/platform/passwords";
import { PASSWORD } from "@/config/server";
import type { User } from "@/platform/contract";
import type { UsersResponse } from "@/platform/api-types";
import { adminAudit, body, fail, handle, json, newId, owned } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";
import { API_LIMITS } from "@/config/app";

export const dynamic = "force-dynamic";

const Attr = z.record(z.string().max(API_LIMITS.attrKey), z.union([z.string().max(API_LIMITS.attrValue), z.array(z.string().max(API_LIMITS.attrValue)).max(API_LIMITS.attrValues)]));
const Password = z.string().min(PASSWORD.minLength).max(PASSWORD.maxLength);
const Roles = z.array(z.enum(["company_admin", "security_admin"])).max(API_LIMITS.platformRoles);

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req, "company_admin");
    const units = new Map(list("unit", tenant.id).map((u) => [u.id, u.name]));
    const all = memberships({});
    const users = list("user", tenant.id).map((u) => ({ ...u, memberships: all.filter((m) => m.userId === u.id).map((m) => ({ ...m, unitName: units.get(m.unitId) ?? m.unitId })) }));
    return json({ users } satisfies UsersResponse);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { user: admin, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, z.object({ email: z.email().max(API_LIMITS.email), name: z.string().trim().min(API_LIMITS.name.min).max(API_LIMITS.name.max), title: z.string().trim().max(API_LIMITS.title), attributes: Attr.default({}), platformRoles: Roles.default([]), password: Password }));
    const email = b.email.toLowerCase();
    if (list("user", tenant.id).some((u) => u.email.toLowerCase() === email)) return fail(M.emailTaken, 409);
    const u: User = { id: newId("usr", b.name.split(" ")[0]), tenantId: tenant.id, email, name: b.name, title: b.title, attributes: b.attributes, platformRoles: b.platformRoles, active: true };
    put("user", u);
    setPasswordHash(u.id, hashPassword(b.password));
    adminAudit(admin, u.id, { op: "create_user", email, platformRoles: u.platformRoles, passwordSet: true });
    return json({ user: u }, 201);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { user: admin, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, z.object({ id: z.string().min(1), name: z.string().trim().min(API_LIMITS.name.min).max(API_LIMITS.name.max).optional(), title: z.string().trim().max(API_LIMITS.title).optional(), attributes: Attr.optional(), platformRoles: Roles.optional(), active: z.boolean().optional(), password: Password.optional() }));
    const u = owned("user", b.id, tenant.id);
    const next: User = { ...u, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => k !== "id" && k !== "password" && v !== undefined)) } as User;
    // The tenant always keeps at least one active company admin.
    const admins = list("user", tenant.id).filter((x) => x.active && x.platformRoles.includes("company_admin") && x.id !== u.id);
    if ((!next.active || !next.platformRoles.includes("company_admin")) && u.platformRoles.includes("company_admin") && admins.length === 0) return fail(M.lastAdmin, 409);
    put("user", next);
    if (b.password) setPasswordHash(u.id, hashPassword(b.password));
    adminAudit(admin, u.id, { op: "update_user", fields: Object.keys(b).filter((k) => k !== "id"), ...(b.platformRoles ? { platformRoles: b.platformRoles } : {}), ...(b.active !== undefined ? { active: b.active } : {}) });
    return json({ user: get("user", u.id) });
  });
}
