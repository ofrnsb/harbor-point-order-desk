// Pins: questions a user keeps, each one view on the canvas. Opening a pin asks the question again, so the view is always current.
import { z } from "zod";
import type { Effective, Pin } from "./contract.ts";
import { ownedProject } from "./projects.ts";
import { get, list, put, remove } from "./store.ts";
import { LEN } from "../config/data.ts";
import { PINS_MAX } from "../config/server.ts";
import { ERR } from "../copy/server.ts";

export const MAX_PINS = PINS_MAX;

export const PinInput = z.object({
  projectId: z.string().min(1).max(LEN.key).nullable().default(null),
  title: z.string().trim().min(1).max(LEN.title),
  ask: z.string().trim().min(1).max(LEN.long),
  view: z.string().trim().min(1).max(LEN.id),
});

const mine = (eff: Effective, p: Pin) => p.tenantId === eff.tenant.id && p.ownerId === eff.user.id && p.unitId === eff.unit.id;

export function pinsFor(eff: Effective, projectId: string | null): Pin[] {
  return list("pin", eff.tenant.id).filter((p) => mine(eff, p) && p.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pinning the same question twice keeps one pin; the newest title wins. */
export function savePin(eff: Effective, input: z.infer<typeof PinInput>): Pin | string {
  if (input.projectId && !ownedProject(eff, input.projectId)) return ERR.projectNotFound;
  const existing = pinsFor(eff, input.projectId);
  const same = existing.find((p) => p.ask === input.ask);
  if (!same && existing.length >= MAX_PINS) return ERR.palingBanyakSematanLepas(MAX_PINS);
  return put("pin", {
    id: same?.id ?? `pin_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    tenantId: eff.tenant.id, unitId: eff.unit.id, ownerId: eff.user.id, projectId: input.projectId,
    title: input.title, ask: input.ask, view: input.view,
    createdAt: same?.createdAt ?? new Date().toISOString(),
  });
}

export function removePin(eff: Effective, id: string): boolean {
  const p = get("pin", id);
  return !!p && mine(eff, p) && remove("pin", id);
}
