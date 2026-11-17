// What the queue screen reads: who may see and work the queue, each email's record, and one email's full story (the
// email itself, the agent's steps and reads, and every audit event about it).
import type { AuditEvent, Membership } from "../../platform/contract.ts";
import { isWithin } from "../../platform/org.ts";
import { auditAll, get, memberships } from "../../platform/store.ts";
import { AGENT_ACTOR, DESKS } from "../../config/orders.ts";
import { INBOX } from "../../copy/orders.ts";
import { erpDb, inboxEmails, type EmailRow } from "./erp.ts";
import { mayDecide, refusal } from "./desk.ts";
import type { Triage } from "./types.ts";

const onDesk = (m: Membership) => Object.values(DESKS).some((d) => isWithin(d, m.unitId));

/** The membership a person works the queue through: their Order Desk seat first, else any seat over a desk. */
export function deskSeat(userId: string): Membership | null {
  const seats = memberships({ userId }).filter(onDesk);
  return seats.find((m) => m.unitId === DESKS.orderDesk) ?? seats.find((m) => isWithin(DESKS.orderDesk, m.unitId)) ?? seats[0] ?? null;
}

/** Starting the agent on the inbox writes to the queue, so it takes a seat on (or over) the Order Desk that can propose. */
export const mayRun = (m: Membership | null) => !!m && m.role !== "viewer" && isWithin(DESKS.orderDesk, m.unitId);

const nameOf = (id: string | undefined) => (id ? get("user", id)?.name ?? id : null);
/** Reads made inside the agent's triage turn are the agent's, done with the scope of the person who started the run. */
const actorName = (id: string, byAgent: boolean) => (id === AGENT_ACTOR.userId ? INBOX.agentActor : byAgent ? INBOX.agentFor(nameOf(id) ?? id) : nameOf(id) ?? id);

/** `whyNot`: when the email waits for a decision this person may not make, the reason in their terms. */
export type TriageView = Triage & { decidedByName: string | null; canDecide: boolean; whyNot: string | null };
export function viewOf(t: Triage, userId: string): TriageView {
  const open = t.state === "needs_review";
  const canDecide = open && mayDecide(userId, t, t.checked);
  return { ...t, decidedByName: nameOf(t.decision?.by), canDecide, whyNot: open && !canDecide ? refusal(userId, t.desk) : null };
}

export type TriageDetail = {
  item: TriageView;
  email: EmailRow | null;
  audit: (AuditEvent & { actorName: string })[];
};

export function detailOf(t: Triage, userId: string): TriageDetail {
  const targets = new Set([t.id, ...(t.released?.soNumbers ?? []), ...(t.decision?.soNumbers ?? [])]);
  const audit = auditAll(t.tenantId).filter((e) => targets.has(e.target) || (t.chatId && e.detail.chatId === t.chatId)).map((e) => ({ ...e, actorName: actorName(e.actor.userId, !!t.chatId && e.detail.chatId === t.chatId && e.kind !== "triage") }));
  return {
    item: viewOf(t, userId),
    email: inboxEmails(erpDb()).find((e) => e.email_id === t.id) ?? null,
    audit,
  };
}
