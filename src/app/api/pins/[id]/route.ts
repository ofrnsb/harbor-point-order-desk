import { requireUser } from "@/platform/auth";
import { resolveEffective } from "@/platform/org";
import { removePin } from "@/platform/pins";
import { fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { user } = requireUser(req);
    const unitId = new URL(req.url).searchParams.get("unitId") ?? "";
    let eff;
    try { eff = resolveEffective(user.id, unitId); } catch { return fail(API.notMember, 403); }
    return removePin(eff, (await ctx.params).id) ? json({ ok: true }) : fail(API.pinNotFound, 404);
  });
}
