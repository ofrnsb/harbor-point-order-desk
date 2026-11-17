import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { COLUMN_MODES, SENSITIVITIES } from "@/platform/contract";
import { put } from "@/platform/store";
import { adminAudit, body, handle, json } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";
import { MIN_GROUP_SIZE } from "@/config/app";
import { LEN } from "@/config/data";
import { applyWorkspace } from "@/config/locale";
import { SetupS } from "@/platform/setup";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => json({ tenant: requireAdmin(req).tenant }));
}

/** Company-wide data settings. Restricted columns may never default to a looser mode than confidential ones. */
export async function PATCH(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "company_admin");
    const b = await body(req, z.object({
      restrictedRouting: z.enum(["mask", "local_model"]).optional(),
      sensitivityDefaults: z.object(Object.fromEntries(SENSITIVITIES.map((s) => [s, z.enum(COLUMN_MODES)])) as Record<(typeof SENSITIVITIES)[number], z.ZodEnum<{ [K in (typeof COLUMN_MODES)[number]]: K }>>).optional(),
      minGroupSize: z.number().int().min(MIN_GROUP_SIZE.min).max(MIN_GROUP_SIZE.max).optional(),
      // Where the company is: the currency its money is kept in, how numbers and dates are written, its clock.
      currency: SetupS.shape.company.shape.currency.unwrap().optional(),
      locale: SetupS.shape.company.shape.locale.unwrap().optional(),
      timezone: z.string().trim().min(3).max(LEN.name).refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }).optional(),
    }));
    const next = { ...tenant, ...b };
    if (next.sensitivityDefaults.restricted === "show") return json({ error: M.restrictedShown }, 400);
    put("tenant", next);
    applyWorkspace(next);
    adminAudit(user, "tenant", b);
    return json({ tenant: next });
  });
}
