import { z } from "zod";
import { requireUser } from "@/platform/auth";
import { get } from "@/platform/store";
import { body, fail, handle, json } from "@/platform/route-kit";
import { recheckAll } from "@/domain/orders/desk";
import { ProposalSchema } from "@/domain/orders/schema";
import { TRIAGE } from "@/config/orders";
import { deskSeat } from "@/domain/orders/views";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Checks a reviewer's edit against the ERP without saving it, so the review screen shows prices and issues as they type. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    if (!deskSeat(user.id)) return fail(API.notOnDesk, 403);
    const t = get("triage", (await params).id);
    if (!t || t.tenantId !== tenant.id) return fail(API.workNotFound, 404);
    const { proposals } = await body(req, z.object({ proposals: z.array(ProposalSchema).max(TRIAGE.proposalsMax) }));
    return json({ checked: recheckAll(t, proposals) });
  });
}
