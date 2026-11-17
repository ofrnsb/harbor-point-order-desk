import { requireUser } from "@/platform/auth";
import { resolveEffective } from "@/platform/org";
import { PinInput, pinsFor, savePin } from "@/platform/pins";
import { body, fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

const effFor = (req: Request) => {
  const { user } = requireUser(req);
  const unitId = new URL(req.url).searchParams.get("unitId") ?? "";
  try { return unitId ? resolveEffective(user.id, unitId) : null; } catch { return null; }
};

export async function GET(req: Request) {
  return handle(async () => {
    const eff = effFor(req);
    if (!eff) return fail(API.notMember, 403);
    return json({ pins: pinsFor(eff, new URL(req.url).searchParams.get("projectId") || null) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const eff = effFor(req);
    if (!eff) return fail(API.notMember, 403);
    const saved = savePin(eff, await body(req, PinInput));
    return typeof saved === "string" ? fail(saved) : json(saved, 201);
  });
}
