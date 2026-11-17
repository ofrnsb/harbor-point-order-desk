import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { get, list, put, remove } from "@/platform/store";
import type { ActionTemplate } from "@/platform/contract";
import type { ActionsResponse } from "@/platform/api-types";
import { ActionTemplateS, adminAudit, body, fail, handle, json, newId, owned, slug } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";

export const dynamic = "force-dynamic";

/** The template must point at a catalogued object whose columns exist, so a bad template never reaches the database. */
function checkTemplate(t: Omit<ActionTemplate, "id" | "tenantId">, tenantId: string): string | null {
  const conn = get("connection", t.connectionId);
  if (!conn || conn.tenantId !== tenantId) return M.connectionNotFound;
  if (!conn.writeSecret) return M.noWriteCreds(conn.code);
  const obj = get("catalog", `${t.connectionId}/${t.object}`);
  if (!obj) return M.objectNotCatalogued(t.object, conn.code);
  const cols = new Set(obj.columns.map((c) => c.name));
  const missing = [...t.fields.map((f) => f.column), ...(t.keyColumn ? [t.keyColumn] : [])].filter((c) => !cols.has(c));
  if (missing.length) return M.columnsMissing(t.object, missing.join(M.listSep));
  if (t.amountField && !t.fields.some((f) => f.column === t.amountField)) return M.amountNotField(t.amountField);
  return null;
}

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req, "company_admin");
    return json({ actions: list("action", tenant.id) } satisfies ActionsResponse);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, ActionTemplateS);
    const problem = checkTemplate(b, tenant.id);
    if (problem) return fail(problem, 422);
    const id = b.id ?? newId("act", slug(b.name)).replace(/^act_/, "");
    if (get("action", id)) return fail(M.actionExists(id), 409);
    const t: ActionTemplate = { ...b, id, tenantId: tenant.id };
    put("action", t);
    adminAudit(user, id, { op: "create_action", object: `${b.connectionId}/${b.object}`, kind: b.op });
    return json({ action: t }, 201);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, ActionTemplateS.and(z.object({ id: z.string().min(1) })));
    owned("action", b.id, tenant.id);
    const problem = checkTemplate(b, tenant.id);
    if (problem) return fail(problem, 422);
    const t: ActionTemplate = { ...b, tenantId: tenant.id };
    put("action", t);
    adminAudit(user, b.id, { op: "update_action" });
    return json({ action: t });
  });
}

export async function DELETE(req: Request) {
  return handle(() => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const id = new URL(req.url).searchParams.get("id") ?? "";
    owned("action", id, tenant.id);
    const pending = list("work", tenant.id).filter((w) => w.templateId === id && (w.state === "awaiting_confirm" || w.state === "awaiting_approval"));
    if (pending.length) return fail(M.actionPending(pending.length), 409);
    remove("action", id);
    adminAudit(user, id, { op: "delete_action" });
    return json({ ok: true });
  });
}
