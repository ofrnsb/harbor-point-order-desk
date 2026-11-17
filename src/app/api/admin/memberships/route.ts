import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { setMembership } from "@/platform/store";
import { ROLES } from "@/platform/contract";
import { adminAudit, body, handle, json, owned } from "@/platform/route-kit";

export const dynamic = "force-dynamic";

/** Sets a user's role in a unit, or removes them from it with role null. */
export async function POST(req: Request) {
  return handle(async () => {
    const { user: admin, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, z.object({ userId: z.string().min(1), unitId: z.string().min(1), role: z.enum(ROLES).nullable() }));
    owned("user", b.userId, tenant.id);
    owned("unit", b.unitId, tenant.id);
    setMembership(b);
    adminAudit(admin, b.userId, { op: b.role ? "set_membership" : "remove_membership", unitId: b.unitId, role: b.role });
    return json({ ok: true });
  });
}
