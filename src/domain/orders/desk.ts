// The Order Desk queue: the inbox is ingested as one record per email, the agent files its decision on each, clean
// orders within the limit are released, and everything else waits for a person to approve, edit or reject.
import { record } from "../../platform/audit.ts";
import { isWithin, resolveEffective, unitPath } from "../../platform/org.ts";
import { get, list, memberships, put } from "../../platform/store.ts";
import { AGENT_ACTOR, AUTO_RELEASE, CREDIT_KINDS, DESKS, NON_HOLDING_FLAGS, type AgentFlag, type DeskId, type RequestKind, type TriageState } from "../../config/orders.ts";
import { ORDER_TOOLS as F, REVIEW as R } from "../../copy/orders.ts";
import { moneyText } from "../../lib/values.ts";
import { applyProposal, erpDb, erpView, inboxEmails } from "./erp.ts";
import { blocking, checkProposal, needsCredit } from "./rules.ts";
import type { Checked, Proposal, Triage } from "./types.ts";

const now = () => new Date().toISOString();
/** Emails are dated in the sender's zone: the calendar day written in the timestamp is the order date. */
const dayOf = (iso: string) => iso.slice(0, 10);
const FINAL: readonly TriageState[] = ["released", "approved", "rejected", "merged"];
export const totalOf = (checked: Checked[]) => checked.reduce((s, c) => s + Math.max(c.total, 0), 0);

export function ingestInbox(tenantId: string): Triage[] {
  const have = new Set(list("triage", tenantId).map((t) => t.id));
  for (const e of inboxEmails(erpDb()).filter((e) => !have.has(e.email_id))) {
    put("triage", {
      id: e.email_id, tenantId, receivedAt: e.received_at, fromName: e.from_name, fromEmail: e.from_email.toLowerCase(), subject: e.subject,
      state: "queued", kind: null, customerId: null, summary: "", reasons: [], nextStep: "", flags: [], reply: null,
      proposals: [], checked: [], desk: DESKS.orderDesk, related: [], chatId: null, updatedAt: now(),
    });
  }
  return queue(tenantId);
}

/**
 * Emails a new run picks up: not triaged, failed, or left "working" by a run that died with the server (a run only
 * starts when none is active, so any "working" record at that moment is stale). `ids` narrows it to those emails.
 */
const RUNNABLE: readonly TriageState[] = ["queued", "failed", "working"];
export const runnable = (items: Triage[], ids?: string[]): Triage[] =>
  items.filter((t) => RUNNABLE.includes(t.state) && (!ids || ids.includes(t.id)));

/** Earlier emails from the same sender still waiting for review: a follow-up most likely belongs with one of them. */
export const openEarlier = (t: Triage): Triage[] =>
  queue(t.tenantId).filter((x) => x.fromEmail === t.fromEmail && x.id !== t.id && x.receivedAt <= t.receivedAt && x.state === "needs_review");

export const queue = (tenantId: string): Triage[] =>
  list("triage", tenantId).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));

const pendingPos = (t: Triage) => list("triage", t.tenantId)
  .filter((x) => x.id !== t.id && x.state === "needs_review")
  .flatMap((x) => x.proposals.flatMap((p) => (p.action === "create" && p.customerPo ? [{ po: p.customerPo, emailId: x.id }] : [])));

const recheck = (t: Triage, p: Proposal, alsoOrdered = 0): Checked =>
  checkProposal(erpView(erpDb()), p, { orderDate: dayOf(t.receivedAt), fromEmail: t.fromEmail, pendingPos: pendingPos(t), alsoOrdered });

const customerOf = (p: Proposal) => (p.action === "create" ? p.customerId : erpView(erpDb()).order(p.soNumber)?.customer_id ?? "");

/** Checks an email's orders in turn; each one's credit check counts the ones before it for the same customer. */
export function recheckAll(t: Triage, proposals: Proposal[]): Checked[] {
  const exposure = new Map<string, number>();
  return proposals.map((p) => {
    const key = customerOf(p);
    const c = recheck(t, p, exposure.get(key) ?? 0);
    exposure.set(key, (exposure.get(key) ?? 0) + Math.max(c.total, 0));
    return c;
  });
}

const deskFor = (kind: RequestKind | null, checked: Checked[]): DeskId =>
  (kind && CREDIT_KINDS.includes(kind)) || checked.some(needsCredit) ? DESKS.creditControl : DESKS.orderDesk;

/** The Order Desk's approval limit, the tightest on its path: the ceiling for what the agent releases on its own. */
export function deskLimit(): number {
  const limits = unitPath(DESKS.orderDesk).map((u) => u.profile.approvalOver).filter((n): n is number => n !== null);
  return limits.length ? Math.min(...limits) : 0;
}

function releasable(kind: RequestKind, proposals: Proposal[], checked: Checked[], flags: AgentFlag[]): boolean {
  if (!proposals.length || !AUTO_RELEASE.kinds.includes(kind) || flags.some((f) => !NON_HOLDING_FLAGS.includes(f))) return false;
  const named = proposals.every((p) => p.action === "create" && (!AUTO_RELEASE.requireSkuNamed || p.lines.every((l) => l.skuNamed)));
  const limit = deskLimit();
  return named && checked.every((c) => c.issues.length === 0) && limit > 0 && totalOf(checked) <= limit;
}

/** Writes every proposal of one email in one transaction: all of its orders go in, or none. */
function applyAll(t: Triage, proposals: Proposal[], checked: Checked[]) {
  const d = erpDb();
  return d.transaction(() => proposals.map((p, i) => applyProposal(d, p, checked[i], { orderDate: dayOf(t.receivedAt) })))();
}

const domainOf = (email: string) => email.slice(email.indexOf("@") + 1);
const earlierFromSameSender = (t: Triage, id: string) => {
  const e = get("triage", id);
  return !!e && e.id !== t.id && domainOf(e.fromEmail) === domainOf(t.fromEmail) && e.receivedAt <= t.receivedAt;
};

/** The agent closes an email only when the server can see why, so a misread can never hide a real order. */
const CLOSE_GUARDS: Partial<Record<RequestKind, (t: Triage, input: FileInput) => boolean>> = {
  duplicate: (t, input) => [...input.related, ...(input.supersedes ? [input.supersedes] : [])].some((id) => earlierFromSameSender(t, id)),
  spam: (t) => !erpView(erpDb()).contact(t.fromEmail),
  auto_reply: () => true,
};
const closable = (t: Triage, input: FileInput) => !input.proposals.length && (CLOSE_GUARDS[input.kind]?.(t, input) ?? false);

export type FileInput = {
  emailId: string; kind: RequestKind; customerId: string | null; summary: string; reasons: string[]; nextStep: string;
  flags: AgentFlag[]; related: string[]; reply: string | null; proposals: Proposal[]; supersedes: string | null;
};
type Filer = { tenantId: string; userId: string; unitId: string; chatId: string };

/** Requests that are not orders: their lines never become order lines by folding (a quote stays a quote). */
const UNFOLDABLE: readonly RequestKind[] = ["quote_request", "return_request", "invoice_dispute", "complaint"];

/** Folds the earlier draft into this one; its flags come along, so a warning on the first email is not lost. */
function merge(t: Triage, supersedes: string | null): AgentFlag[] {
  if (!supersedes) return [];
  const earlier = get("triage", supersedes);
  if (!earlier || earlier.fromEmail !== t.fromEmail || earlier.state !== "needs_review" || earlier.receivedAt > t.receivedAt) throw new Error(F.badSupersede(supersedes));
  if (earlier.kind && UNFOLDABLE.includes(earlier.kind)) throw new Error(F.notFoldable(supersedes, earlier.kind));
  put("triage", { ...earlier, state: "merged", mergedInto: t.id, updatedAt: now() });
  return earlier.flags;
}

function release(t: Triage, by: Filer): Triage {
  const applied = applyAll(t, t.proposals, t.checked);
  const soNumbers = applied.map((a) => a.soNumber);
  const ev = record({ tenantId: t.tenantId, actor: { ...AGENT_ACTOR, unitId: by.unitId }, kind: "release", target: t.id, detail: { soNumbers, value: totalOf(t.checked), allocated: applied.map((a) => a.allocated), runBy: by.userId, chatId: by.chatId } });
  return { ...t, state: "released", released: { soNumbers, auditSeq: ev.seq } };
}

/** The agent's decision on one email. Every check is re-run here: what the agent claims about the ERP is not trusted. */
export function fileTriage(input: FileInput, by: Filer): Triage {
  const t = get("triage", input.emailId);
  if (!t || t.tenantId !== by.tenantId) throw new Error(F.noEmail(input.emailId));
  if (FINAL.includes(t.state)) throw new Error(F.decided(t.id, t.state));
  const checked = recheckAll(t, input.proposals);
  const flags = [...new Set([...input.flags, ...merge(t, input.supersedes)])];
  const base: Triage = {
    ...t, kind: input.kind, customerId: checked[0]?.customerId ?? input.customerId, summary: input.summary, reasons: input.reasons,
    nextStep: input.nextStep, flags, reply: input.reply, proposals: input.proposals, checked,
    related: [...new Set([...input.related, ...(input.supersedes ? [input.supersedes] : [])])],
    desk: deskFor(input.kind, checked), chatId: by.chatId, state: "needs_review", updatedAt: now(),
  };
  delete base.error;
  const closes = closable(t, input);
  const filed = closes ? { ...base, state: "closed" as const } : releasable(input.kind, input.proposals, checked, flags) ? release(base, by) : base;
  record({ tenantId: t.tenantId, actor: { ...AGENT_ACTOR, unitId: by.unitId }, kind: "triage", target: t.id, detail: { kind: input.kind, state: filed.state, desk: filed.desk, issues: checked.flatMap((c) => c.issues.map((i) => i.code)), flags, runBy: by.userId, chatId: by.chatId } });
  return put("triage", filed);
}

/** After ERP data changes: every email still waiting for review is checked again against it, and re-routed if a credit
 * issue appeared or cleared. Returns how many were re-checked. */
export function recheckOpen(tenantId: string): number {
  const open = queue(tenantId).filter((t) => t.state === "needs_review" && t.proposals.length);
  for (const t of open) {
    const checked = recheckAll(t, t.proposals);
    put("triage", { ...t, checked, desk: deskFor(t.kind, checked), updatedAt: now() });
  }
  return open.length;
}

/** Who may decide: an approver on the desk (or above it), or an operator there for drafts within the desk's limit. */
export function mayDecide(userId: string, t: Pick<Triage, "desk">, checked: Checked[]): boolean {
  return memberships({ userId }).some((m) => {
    if (!isWithin(t.desk, m.unitId)) return false;
    if (m.role === "approver" || m.role === "unit_admin") return true;
    return m.role === "operator" && totalOf(checked) <= resolveEffective(userId, m.unitId).approvalOver;
  });
}

export type DecisionInput = { decision: "approve" | "reject"; proposals?: Proposal[]; reply?: string; note?: string };

function settle(t: Triage, userId: string, input: DecisionInput, proposals: Proposal[], checked: Checked[], edited: boolean): Triage {
  const approved = input.decision === "approve";
  const soNumbers = approved ? applyAll(t, proposals, checked).map((a) => a.soNumber) : [];
  const ev = record({ tenantId: t.tenantId, actor: { userId, unitId: t.desk, role: "reviewer" }, kind: approved ? "approve" : "reject", target: t.id, detail: { soNumbers, edited, value: totalOf(checked), note: input.note ?? null } });
  const decision = { by: userId, at: now(), outcome: approved ? "approved" as const : "rejected" as const, edited, soNumbers, auditSeq: ev.seq, ...(input.note ? { note: input.note } : {}) };
  return put("triage", { ...t, proposals, checked, reply: input.reply ?? t.reply, state: decision.outcome, decision, updatedAt: now() });
}

/** Why a person may not decide: not on the desk the email now belongs to, or over their desk's limit. */
export function refusal(userId: string, desk: DeskId): string {
  if (desk === DESKS.creditControl) return R.creditOnly;
  const seated = memberships({ userId }).some((m) => isWithin(desk, m.unitId));
  return seated ? R.overLimit(moneyText(deskLimit())) : R.orderDeskOnly;
}

/** A person approves (as filed, or edited), or rejects. An approval re-checks against the ERP as it is now. */
export function decide(tenantId: string, id: string, userId: string, input: DecisionInput): Triage {
  const t = get("triage", id);
  if (!t || t.tenantId !== tenantId) throw new Error(R.notFound(id));
  if (t.state !== "needs_review") throw new Error(R.notOpen(id, t.state));
  const proposals = input.proposals ?? t.proposals;
  const edited = JSON.stringify(proposals) !== JSON.stringify(t.proposals) || (input.reply !== undefined && input.reply !== t.reply);
  const checked = input.decision === "approve" ? recheckAll(t, proposals) : t.checked;
  const desk = deskFor(t.kind, checked);
  if (!mayDecide(userId, { desk }, checked)) throw new Error(refusal(userId, desk));
  const blocked = input.decision === "approve" ? checked.flatMap(blocking) : [];
  if (blocked.length) throw new Error(R.blocked(blocked.map((i) => i.message).join(" ")));
  return settle({ ...t, desk }, userId, input, proposals, checked, edited);
}
