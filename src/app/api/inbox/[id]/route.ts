import { requireUser } from "@/platform/auth";
import { get } from "@/platform/store";
import { body, fail, handle, json } from "@/platform/route-kit";
import { decide } from "@/domain/orders/desk";
import { DecisionSchema } from "@/domain/orders/schema";
import { deskSeat, detailOf, viewOf } from "@/domain/orders/views";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** One email's full story: the email, the agent's steps and reads, the checks, and every audit event about it. */
export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    if (!deskSeat(user.id)) return fail(API.notOnDesk, 403);
    const t = get("triage", (await params).id);
    if (!t || t.tenantId !== tenant.id) return fail(API.workNotFound, 404);
    return json(detailOf(t, user.id));
  });
}

/** A person approves (as filed or edited) or rejects. decide() checks that they may, and re-checks the ERP. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    if (!deskSeat(user.id)) return fail(API.notOnDesk, 403);
    const input = await body(req, DecisionSchema);
    try { return json({ item: viewOf(decide(tenant.id, (await params).id, user.id, input), user.id) }); }
    catch (err) { return fail(err instanceof Error ? err.message : String(err), 409); }
  });
}
