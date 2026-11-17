import { z } from "zod";
import { requireUser } from "@/platform/auth";
import { body, fail, handle, json } from "@/platform/route-kit";
import { TRIAGE } from "@/config/orders";
import { startRun } from "@/domain/orders/pipeline";
import { deskSeat, mayRun } from "@/domain/orders/views";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

const Body = z.object({ ids: z.array(z.string().regex(TRIAGE.emailId)).min(1).max(TRIAGE.runMax).optional() });

/** Starts the agent on every email not yet triaged (and any that failed), or on the `ids` given. Returns at once; the queue polls the run. */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    const seat = deskSeat(user.id);
    if (!seat || !mayRun(seat)) return fail(API.cannotRun, 403);
    const { ids } = req.headers.get("content-type")?.includes("json") ? await body(req, Body) : {};
    try { return json({ run: startRun({ tenantId: tenant.id, userId: user.id, unitId: seat.unitId }, ids) }); }
    catch (err) { return fail(err instanceof Error ? err.message : String(err), 409); }
  });
}
