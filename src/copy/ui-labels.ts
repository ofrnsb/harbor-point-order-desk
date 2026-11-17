// Names of roles, sensitivity levels, column modes, connection kinds and action states, as people read them.
import { BRAND } from "./brand.ts";
export const LABELS = {
  role: { viewer: "Viewer", operator: "Operator", approver: "Approver", unit_admin: "Unit admin" } as Record<string, string>,
  platformRole: { company_admin: "Company admin", security_admin: "Security admin" } as Record<string, string>,
  sensitivity: { public: "Public", internal: "Internal", confidential: "Confidential", restricted: "Restricted" } as Record<string, string>,
  mode: { show: "Show", mask: "Mask", hash: "Hash", aggregate: "Aggregate only", deny: "Deny" } as Record<string, string>,
  kindShort: { sqlite: "sqlite" } as Record<string, string>,
  state: {
    awaiting_confirm: "Awaiting confirmation", awaiting_approval: "Awaiting approver", executing: "Writing", executed: "Executed",
    rejected: "Rejected", cancelled: "Cancelled", failed: "Failed",
  } as Record<string, string>,
} as const;

export const CLIENT = {
  unreachable: `Could not reach the ${BRAND.product} server. Check your connection, then try again.`,
  requestFailed: (status: number) => `Request failed (HTTP ${status})`,
  agoNow: "just now",
  agoMin: (n: number) => `${n} min ago`,
  agoHour: (n: number) => `${n} h ago`,
  agoDay: (n: number) => `${n} d ago`,
} as const;
