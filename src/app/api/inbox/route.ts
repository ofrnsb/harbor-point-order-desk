import { requireUser } from "@/platform/auth";
import { fail, handle, json } from "@/platform/route-kit";
import { ingestInbox } from "@/domain/orders/desk";
import { runStatus } from "@/domain/orders/pipeline";
import { deskSeat, mayRun, viewOf } from "@/domain/orders/views";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

/** The queue: every inbound email and what happened to it, plus the agent's run. Reading it ingests new emails. */
export async function GET(req: Request) {
  return handle(() => {
    const { user, tenant } = requireUser(req);
    const seat = deskSeat(user.id);
    if (!seat) return fail(API.notOnDesk, 403);
    return json({ items: ingestInbox(tenant.id).map((t) => viewOf(t, user.id)), run: runStatus(), canRun: mayRun(seat) });
  });
}
