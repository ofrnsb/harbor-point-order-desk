// The catalog the agent assembles screens from. Add a component: write src/lib/lego/parts/<name>.ts (server) and
// src/components/lego/<name>.tsx (client), then list both in parts.ts and src/components/lego/views.tsx.
import { z } from "zod";
import { pageSize, type LegoSpec } from "./contract.ts";
import { PARTS } from "./parts.ts";
import { ERR } from "../../copy/server.ts";

export const LEGO: LegoSpec[] = PARTS as LegoSpec[];
export const legoByName = new Map(LEGO.map((s) => [s.name, s]));

/** zod schemas for the agent's present call, one per component, discriminated by `type`. */
export const legoInputs = LEGO.map((s) => {
  if ("type" in s.input) throw new Error(ERR.legoPartInputMay(s.name));
  // Every part that lists rows pages them; the agent may set the page size per question.
  return z.object({ ...s.input, page_size: pageSize, type: z.literal(s.name) });
});

/** The catalog as the agent reads it in the present tool's description, grouped. */
export function legoCatalog(): string {
  const groups = new Map<string, LegoSpec[]>();
  for (const s of LEGO) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  return [...groups.entries()].map(([g, ss]) => `${g}: ${ss.map((s) => `${s.name} (${s.use})`).join("; ")}`).join("\n");
}
