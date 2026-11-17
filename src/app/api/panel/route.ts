import { domain } from "@/domain";
import { requireUser } from "@/platform/auth";
import { resolveEffective } from "@/platform/org";
import { handle } from "@/platform/route-kit";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

/** The domain panel for the unit the user is acting as (?unitId=), or the unscoped panel without one. */
export async function GET(req: Request) {
  return handle(async () => {
    const { user } = requireUser(req);
    const unitId = new URL(req.url).searchParams.get("unitId");
    let scope;
    if (unitId) {
      try { scope = { eff: resolveEffective(user.id, unitId) }; } catch { return Response.json({ error: API.notMember }, { status: 403 }); }
    }
    try { return Response.json(await domain.panel(scope)); }
    catch (err) { return Response.json({ error: err instanceof Error ? err.message : API.panelUnavailable }, { status: 502 }); }
  });
}
