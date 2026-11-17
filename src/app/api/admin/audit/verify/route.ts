import { requireAdmin } from "@/platform/auth";
import { verifyChain } from "@/platform/audit";
import { handle, json } from "@/platform/route-kit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req, "security_admin");
    return json(verifyChain(tenant.id));
  });
}
