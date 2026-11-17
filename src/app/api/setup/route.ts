import crypto from "node:crypto";
import { sessionCookie } from "@/platform/auth";
import { setupCompany, SetupS } from "@/platform/setup";
import { listTenants } from "@/platform/store";
import { body, fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";
import { env } from "@/config/env";

export const dynamic = "force-dynamic";

/** Whether this installation still needs its company set up. */
export async function GET() {
  return handle(() => json({ needed: listTenants().length === 0, tokenRequired: !!env.setupToken }));
}

/** First run only. Production installs set SIMPUL_SETUP_TOKEN so only the operator can claim the installation. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req, SetupS);
    const expected = env.setupToken;
    if (expected) {
      const got = Buffer.from(b.token ?? "");
      const want = Buffer.from(expected);
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return fail(API.setupTokenMismatch, 403);
    }
    const created = setupCompany(b);
    if (!created) return fail(API.setupDone, 409);
    const res = json({ ok: true, tenantId: created.tenant.id, userId: created.admin.id }, 201);
    res.headers.append("set-cookie", sessionCookie(created.admin.id));
    return res;
  });
}
