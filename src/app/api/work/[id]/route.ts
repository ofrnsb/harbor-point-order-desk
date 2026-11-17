import { z } from "zod";
import { requireUser } from "@/platform/auth";
import { decideWorkItem } from "@/platform/work";
import { get } from "@/platform/store";
import { body, fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";
import { API_LIMITS } from "@/config/app";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** An approver approves or rejects a work item waiting on them. decideWorkItem checks that they may. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user } = requireUser(req);
    const id = (await params).id;
    const item = get("work", id);
    if (!item || item.tenantId !== user.tenantId) return fail(API.workNotFound, 404);
    const { decision, note } = await body(req, z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(API_LIMITS.workNote).optional() }));
    try { return json({ item: await decideWorkItem(id, user.id, decision, note) }); }
    catch (err) { return fail(err instanceof Error ? err.message : String(err), 409); }
  });
}
