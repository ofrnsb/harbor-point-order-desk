// The order a reviewer works the queue in. Pure, so the queue screen and the tests share it.
import { DESKS } from "../../config/orders.ts";
import type { Triage } from "./types.ts";

/** The earliest delivery date asked for on any of the email's new orders. */
export const dueOf = (t: Pick<Triage, "proposals">): string | null =>
  t.proposals.flatMap((p) => (p.action === "create" && p.requestedDate ? [p.requestedDate] : [])).sort()[0] ?? null;

const LAST_DAY = "9999-12-31";
const rank = (t: Triage) => [t.flags.includes("urgent") ? 0 : 1, dueOf(t) ?? LAST_DAY, t.desk === DESKS.creditControl ? 0 : 1, t.receivedAt] as const;

/** What to work first: what the customer called urgent, then the nearest delivery date, then credit cases, then arrival. */
export function byPriority(a: Triage, b: Triage): number {
  const [x, y] = [rank(a), rank(b)];
  return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2] || x[3].localeCompare(y[3]);
}
