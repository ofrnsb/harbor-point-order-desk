import type { RequestDesk } from "../lib/requests.ts";
import { list } from "../platform/store.ts";
import { DESK_DEFAULT_SLA_DAYS, DESK_HANDLES_CHARS, DESK_SLA_ATTR } from "../config/domain.ts";

/** The company's own divisions are its desks: every unit directly under the root, its description saying what it handles. */
export function desksOf(tenantId: string): RequestDesk[] {
  const units = list("unit", tenantId);
  const root = units.find((u) => !u.parentId);
  return units.filter((u) => root && u.parentId === root.id).map((u) => ({
    name: u.name,
    handles: (u.profile.description || u.name).split(/(?<=\.)\s/)[0].slice(0, DESK_HANDLES_CHARS),
    workingDays: Number(u.profile.attributes[DESK_SLA_ATTR]) > 0 ? Number(u.profile.attributes[DESK_SLA_ATTR]) : DESK_DEFAULT_SLA_DAYS,
  }));
}
