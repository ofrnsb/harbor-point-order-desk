import { requireUser } from "@/platform/auth";
import { fail, handle, json } from "@/platform/route-kit";
import { checkUploadSize, ingestUploads } from "@/domain/orders/ingest";
import { deskSeat, mayRun } from "@/domain/orders/views";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

/** Checks (apply=false) or writes (apply=true) uploaded data: emails for the Order Desk, ERP records for a company admin. */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    const seat = deskSeat(user.id);
    if (!seat || !mayRun(seat)) return fail(API.cannotIngest, 403);
    const form = await req.formData().catch(() => null);
    const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
    const tooBig = checkUploadSize(files);
    if (tooBig) return fail(tooBig, 400);
    const uploads = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: f.size, data: Buffer.from(await f.arrayBuffer()) })));
    const by = { tenantId: tenant.id, userId: user.id, unitId: seat.unitId, role: seat.role, mayChangeErp: user.platformRoles.includes("company_admin") };
    return json(ingestUploads(by, uploads, form?.get("apply") === "true"));
  });
}
