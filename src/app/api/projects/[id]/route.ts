import { deleteChat, listChats } from "@/lib/store";
import { requireUser } from "@/platform/auth";
import { resolveEffective } from "@/platform/org";
import { deleteProject, ownedProject, ProjectInput, saveProject } from "@/platform/projects";
import { body, fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(req: Request, ctx: Ctx) {
  const { user } = requireUser(req);
  const unitId = new URL(req.url).searchParams.get("unitId") ?? "";
  let eff;
  try { eff = resolveEffective(user.id, unitId); } catch { return { error: fail(API.notMember, 403) }; }
  const project = ownedProject(eff, (await ctx.params).id);
  return project ? { eff, project } : { error: fail(API.projectNotFound, 404) };
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const r = await load(req, ctx);
    if ("error" in r) return r.error!;
    const input = await body(req, ProjectInput);
    const saved = saveProject(r.eff, input, r.project);
    return typeof saved === "string" ? fail(saved) : json(saved);
  });
}

/** Deletes the project and the owner's conversations in it; they cannot run without its scope. */
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const r = await load(req, ctx);
    if ("error" in r) return r.error!;
    const chats = (await listChats(r.eff.user.id)).filter((c) => c.projectId === r.project.id);
    await Promise.all(chats.map((c) => deleteChat(c.id)));
    deleteProject(r.project.id);
    return json({ ok: true, chats: chats.length });
  });
}
