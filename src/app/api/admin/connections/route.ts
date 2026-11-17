import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { storeCredentials } from "@/platform/secrets";
import { db, list, put, remove } from "@/platform/store";
import type { Connection } from "@/platform/contract";
import type { ConnectionRow, ConnectionsResponse } from "@/platform/api-types";
import { ConnectionConfigS, ConnectionInputS, CredS, adminAudit, body, fail, handle, json, owned } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";
import { API_LIMITS, CONNECTION_ID_PREFIX } from "@/config/app";

export const dynamic = "force-dynamic";

const row = (c: Connection, objects: number): ConnectionRow => {
  const { readSecret: _r, writeSecret, ...rest } = c;
  return { ...rest, hasWrite: !!writeSecret, objects };
};

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req); // read for every admin (grant editors need names); credentials never leave the server
    const catalog = list("catalog", tenant.id);
    const connections = list("connection", tenant.id).map((c) => row(c, catalog.filter((o) => o.connectionId === c.id).length));
    return json({ connections } satisfies ConnectionsResponse);
  });
}

/** Credentials are encrypted on arrival and never returned. */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "security_admin");
    const b = await body(req, ConnectionInputS);
    const id = `${CONNECTION_ID_PREFIX}${b.code.toLowerCase()}`;
    if (list("connection", tenant.id).some((c) => c.id === id || c.code === b.code)) return fail(M.codeTaken(b.code), 409);
    const c: Connection = {
      id, tenantId: tenant.id, code: b.code, name: b.name, kind: b.kind, config: b.config,
      readSecret: storeCredentials(tenant.id, b.read), writeSecret: b.write ? storeCredentials(tenant.id, b.write) : null,
      status: "untested", statusNote: M.untested, introspectedAt: null,
    };
    put("connection", c);
    adminAudit(user, id, { op: "create_connection", kind: b.kind, code: b.code, write: !!b.write });
    return json({ connection: row(c, 0) }, 201);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "security_admin");
    const b = await body(req, z.object({ id: z.string().min(1), name: z.string().min(API_LIMITS.name.min).max(API_LIMITS.name.max).optional(), config: ConnectionConfigS.optional(), read: CredS.optional(), write: CredS.nullable().optional() }));
    const c = owned("connection", b.id, tenant.id);
    const next: Connection = {
      ...c,
      ...(b.name ? { name: b.name } : {}),
      ...(b.config ? { config: b.config } : {}),
      ...(b.read ? { readSecret: storeCredentials(tenant.id, b.read, c.readSecret) } : {}),
      ...(b.write === null ? { writeSecret: null } : b.write ? { writeSecret: storeCredentials(tenant.id, b.write, c.writeSecret ?? undefined) } : {}),
      ...(b.config || b.read || b.write !== undefined ? { status: "untested" as const, statusNote: M.changedUntested } : {}),
    };
    put("connection", next);
    adminAudit(user, c.id, { op: "update_connection", fields: Object.keys(b).filter((k) => k !== "id"), rotatedRead: !!b.read, write: b.write === null ? "removed" : b.write ? "rotated" : "unchanged" });
    return json({ connection: row(next, list("catalog", tenant.id).filter((o) => o.connectionId === c.id).length) });
  });
}

export async function DELETE(req: Request) {
  return handle(() => {
    const { user, tenant } = requireAdmin(req, "security_admin");
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const c = owned("connection", id, tenant.id);
    const using = list("action", tenant.id).filter((a) => a.connectionId === id);
    if (using.length) return fail(M.inUseByActions(using.map((a) => a.name).join(M.listSep)), 409);
    for (const o of list("catalog", tenant.id).filter((o) => o.connectionId === id)) remove("catalog", `${id}/${o.name}`);
    for (const s of [c.readSecret, c.writeSecret]) if (s) db().prepare("DELETE FROM secrets WHERE id = ?").run(s);
    remove("connection", id);
    adminAudit(user, id, { op: "delete_connection", code: c.code });
    return json({ ok: true });
  });
}
