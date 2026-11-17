// Projects narrow a team's scope to the sources one piece of work needs, and carry that work's goal and instructions.
// The narrowing runs on every turn against the live effective scope, so a project can never see more than its team.
import { z } from "zod";
import type { Effective, Project } from "./contract.ts";
import { list, put, remove, get } from "./store.ts";
import { COUNT, LEN } from "../config/data.ts";
import { ERR } from "../copy/server.ts";

export const ProjectInput = z.object({
  name: z.string().trim().min(1, ERR.projectNameRequired).max(LEN.label),
  goal: z.string().trim().max(LEN.note).default(""),
  instructions: z.string().trim().max(LEN.doc).default(""),
  sources: z.array(z.string().min(1).max(LEN.line)).max(COUNT.long).default([]),
});

const inSource = (sources: string[], connectionId: string, object?: string) =>
  sources.includes(connectionId) || (object !== undefined && sources.includes(`${connectionId}/${object}`));

/** Sources the team may read right now, as "connectionId" and "connectionId/object" keys. */
export function availableSources(eff: Effective): Set<string> {
  return new Set(Object.entries(eff.data).flatMap(([c, objs]) => [c, ...Object.keys(objs).map((o) => `${c}/${o}`)]));
}

/** The team's scope cut down to the project's sources. Action templates that write outside them drop out too. */
export function narrowToProject(eff: Effective, project: Project | null): Effective {
  if (!project || project.sources.length === 0) return eff;
  const data: Effective["data"] = {};
  for (const [c, objs] of Object.entries(eff.data)) {
    const kept = Object.fromEntries(Object.entries(objs).filter(([o]) => inSource(project.sources, c, o)));
    if (Object.keys(kept).length) data[c] = kept;
  }
  const actions = eff.actions.filter((id) => {
    const a = get("action", id);
    return !!a && !!data[a.connectionId]?.[a.object];
  });
  return { ...eff, data, actions };
}

export function projectsFor(eff: Effective): Project[] {
  return list("project", eff.tenant.id)
    .filter((p) => p.ownerId === eff.user.id && p.unitId === eff.unit.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Returns the project only to its owner, inside the team it was made in. */
export function ownedProject(eff: Effective, id: string): Project | null {
  const p = get("project", id);
  return p && p.tenantId === eff.tenant.id && p.ownerId === eff.user.id && p.unitId === eff.unit.id ? p : null;
}

export function saveProject(eff: Effective, input: z.infer<typeof ProjectInput>, existing?: Project): Project | string {
  const allowed = availableSources(eff);
  const outside = input.sources.filter((s) => !allowed.has(s));
  if (outside.length) return ERR.sourcesOutsideTeamScope(outside.join(", "));
  const now = new Date().toISOString();
  return put("project", {
    id: existing?.id ?? `prj_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    tenantId: eff.tenant.id, unitId: eff.unit.id, ownerId: eff.user.id,
    name: input.name, goal: input.goal, instructions: input.instructions, sources: [...new Set(input.sources)],
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

export const deleteProject = (id: string) => remove("project", id);

/** Prompt section for a project: its goal, instructions and the boundary of its data. */
export function projectPrompt(project: Project | null, excluded: string[] = []): string {
  if (!project) return "";
  return [
    `Project: "${project.name}".${project.goal ? ` Goal: ${project.goal}` : ""}`,
    project.instructions ? ERR.projectInstructionsFromUser(project.instructions) : "",
    project.sources.length ? ERR.thisProjectReadsOnly : "",
    excluded.length
      ? ERR.leftOutByThis(excluded.join(", "))
      : "",
  ].filter(Boolean).join("\n");
}

/** Objects the team may read that the project leaves out, as "CODE.object (label)". */
export function excludedByProject(team: Effective, narrowed: Effective): string[] {
  const conns = list("connection", team.tenant.id);
  const catalog = list("catalog", team.tenant.id);
  return Object.entries(team.data).flatMap(([c, objs]) =>
    Object.keys(objs).filter((o) => !narrowed.data[c]?.[o]).map((o) => {
      const code = conns.find((x) => x.id === c)?.code ?? c;
      const lbl = catalog.find((x) => x.connectionId === c && x.name === o)?.label;
      return `${code}.${o}${lbl ? ` (${lbl})` : ""}`;
    }));
}
