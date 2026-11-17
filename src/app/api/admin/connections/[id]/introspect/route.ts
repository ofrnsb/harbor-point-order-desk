import { requireAdmin } from "@/platform/auth";
import { record } from "@/platform/audit";
import { introspectConnection } from "@/platform/catalog";
import { fail, handle, json, owned } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Reads the schema again. Labels and sensitivity an admin set by hand survive the refresh. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "security_admin");
    const id = (await params).id;
    owned("connection", id, tenant.id);
    try {
      const objects = await introspectConnection(id);
      record({ tenantId: tenant.id, actor: { userId: user.id, unitId: null, role: "security_admin" }, kind: "introspect", target: id, detail: { objects: objects.length, columns: objects.reduce((n, o) => n + o.columns.length, 0) } });
      return json({ objects });
    } catch (err) {
      return fail(M.introspectFailed(err instanceof Error ? err.message : String(err)), 502);
    }
  });
}
