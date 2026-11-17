import { requireUser } from "@/platform/auth";
import { resolveEffective } from "@/platform/org";
import { scopeSummary } from "@/platform/policy";
import { ProjectInput, projectsFor, saveProject } from "@/platform/projects";
import { body, fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

const effFor = (userId: string, unitId: string) => {
  try { return resolveEffective(userId, unitId); } catch { return null; }
};

/** The signed-in user's projects in one team, plus the sources a new project may pick from. */
export async function GET(req: Request) {
  return handle(async () => {
    const { user } = requireUser(req);
    const unitId = new URL(req.url).searchParams.get("unitId") ?? "";
    if (!unitId) return fail(API.unitIdRequired);
    const eff = effFor(user.id, unitId);
    if (!eff) return fail(API.notMember, 403);
    return json({ projects: projectsFor(eff), systems: scopeSummary(eff).systems });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { user } = requireUser(req);
    const unitId = new URL(req.url).searchParams.get("unitId") ?? "";
    const eff = unitId ? effFor(user.id, unitId) : null;
    if (!eff) return fail(API.notMember, 403);
    const input = await body(req, ProjectInput);
    const saved = saveProject(eff, input);
    return typeof saved === "string" ? fail(saved) : json(saved, 201);
  });
}
