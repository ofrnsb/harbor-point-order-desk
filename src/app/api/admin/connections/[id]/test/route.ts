import { requireAdmin } from "@/platform/auth";
import { testConnection } from "@/platform/catalog";
import { get } from "@/platform/store";
import { adminAudit, handle, json, owned } from "@/platform/route-kit";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "security_admin");
    const id = (await params).id;
    owned("connection", id, tenant.id);
    const r = await testConnection(id);
    const c = get("connection", id)!;
    adminAudit(user, id, { op: "test_connection", ok: r.ok, note: r.note });
    const { readSecret: _r, writeSecret, ...rest } = c;
    return json({ connection: { ...rest, hasWrite: !!writeSecret } });
  });
}
