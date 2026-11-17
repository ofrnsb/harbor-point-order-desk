import { requireUser } from "@/platform/auth";
import { unitsOf } from "@/platform/org";
import type { MeResponse } from "@/platform/api-types";
import { handle, json } from "@/platform/route-kit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const { user, tenant } = requireUser(req);
    const body: MeResponse = {
      user: { id: user.id, name: user.name, email: user.email, title: user.title, platformRoles: user.platformRoles },
      tenant: { id: tenant.id, name: tenant.name, levels: tenant.levels, currency: tenant.currency, locale: tenant.locale, timezone: tenant.timezone },
      memberships: unitsOf(user.id).map((m) => ({ id: m.unit.id, name: m.unit.name, code: m.unit.code, path: m.path, role: m.role })),
    };
    return json(body);
  });
}
