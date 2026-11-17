// Works the inbox: every email not yet triaged gets one agent turn that ends in file_triage. One sender's emails run in
// the order they arrived, so a follow-up sees what happened to the first; different senders run side by side.
import { runTurn } from "../../lib/agent.ts";
import { createChat, getChat, saveChat } from "../../lib/store.ts";
import type { Principal } from "../../platform/contract.ts";
import { get, put } from "../../platform/store.ts";
import { TRIAGE } from "../../config/orders.ts";
import { DRAFT_LINE, STATE_LABEL, TRIAGE_EARLIER, TRIAGE_RUN as R, TRIAGE_TASK } from "../../copy/orders.ts";
import { erpDb, inboxEmails, type EmailRow } from "./erp.ts";
import { ingestInbox, queue, runnable } from "./desk.ts";
import type { Proposal, Triage } from "./types.ts";

export type RunStatus = { running: boolean; total: number; done: number; working: string[]; startedAt: string | null; finishedAt: string | null };

const g = globalThis as unknown as { orderDeskRun?: RunStatus };
const idle = (): RunStatus => ({ running: false, total: 0, done: 0, working: [], startedAt: null, finishedAt: null });
export const runStatus = (): RunStatus => g.orderDeskRun ?? idle();


const lines = (p: { lines: { sku: string; qty: number }[] }) => p.lines.map((l) => DRAFT_LINE.line(l.sku, l.qty)).join(DRAFT_LINE.sep);
const draftLine = (p: Proposal) =>
  p.action === "create" ? DRAFT_LINE.create(p.customerId, p.shipToId, p.customerPo, lines(p)) : p.action === "change" ? DRAFT_LINE.change(p.soNumber, lines(p)) : DRAFT_LINE.cancel(p.soNumber);

function earlierFrom(t: Triage, all: Triage[]): string {
  return all.filter((x) => x.fromEmail === t.fromEmail && x.receivedAt < t.receivedAt)
    .map((x) => TRIAGE_EARLIER(x.id, x.receivedAt, x.subject, STATE_LABEL[x.state], x.summary, x.proposals.map(draftLine), x.state === "needs_review")).join("\n");
}

async function triageOne(email: EmailRow, principal: Principal, status: RunStatus): Promise<void> {
  const t = get("triage", email.email_id);
  if (!t) return;
  status.working.push(t.id);
  put("triage", { ...t, state: "working", updatedAt: new Date().toISOString() });
  const text = TRIAGE_TASK({ id: t.id, receivedAt: email.received_at, receivedDay: email.received_at.slice(0, 10), from: `${email.from_name} <${email.from_email}>`, to: email.to_address, subject: email.subject, body: email.body, attachments: email.attachments, earlier: earlierFrom(t, queue(t.tenantId)) });
  const chat = await createChat(R.chatTitle(t.id, t.subject), { model: "", userId: principal.userId, unitId: principal.unitId, origin: "triage" });
  chat.messages.push({ id: crypto.randomUUID(), role: "user", text, at: new Date().toISOString() });
  await saveChat(chat);
  try {
    const { message, sessionId } = await runTurn({ chat, principal, userText: text, emit: () => {}, signal: AbortSignal.timeout(TRIAGE.turnMs) });
    const fresh = (await getChat(chat.id)) ?? chat;
    await saveChat({ ...fresh, messages: [...fresh.messages, message], sessionId, updatedAt: new Date().toISOString() });
    const after = get("triage", t.id);
    if (after?.state === "working") put("triage", { ...after, state: "failed", chatId: chat.id, error: (message.role === "agent" ? message.error : null) ?? R.notFiled, updatedAt: new Date().toISOString() });
  } catch (err) {
    const after = get("triage", t.id) ?? t;
    put("triage", { ...after, state: "failed", chatId: chat.id, error: err instanceof Error ? err.message : String(err), updatedAt: new Date().toISOString() });
  } finally {
    status.working = status.working.filter((id) => id !== t.id);
    status.done += 1;
  }
}

/** Starts a run in the background and returns at once; the queue screen polls runStatus. `ids` limits it to those emails. */
export function startRun(principal: Principal, ids?: string[]): RunStatus {
  if (g.orderDeskRun?.running) throw new Error(R.busy);
  const todo = new Set(runnable(ingestInbox(principal.tenantId), ids).map((t) => t.id));
  const emails = inboxEmails(erpDb()).filter((e) => todo.has(e.email_id));
  const bySender = new Map<string, EmailRow[]>();
  for (const e of emails) bySender.set(e.from_email.toLowerCase(), [...(bySender.get(e.from_email.toLowerCase()) ?? []), e]);
  const lanes = [...bySender.values()];
  const status: RunStatus = { running: true, total: emails.length, done: 0, working: [], startedAt: new Date().toISOString(), finishedAt: null };
  g.orderDeskRun = status;
  const worker = async () => { for (let lane = lanes.shift(); lane; lane = lanes.shift()) for (const e of lane) await triageOne(e, principal, status); };
  void Promise.all(Array.from({ length: TRIAGE.concurrency }, worker)).finally(() => { status.running = false; status.finishedAt = new Date().toISOString(); });
  return status;
}
