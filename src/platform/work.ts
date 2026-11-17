// Work items: every write the agent proposes. The requester confirms; above the team's threshold (or for high-risk
// templates) an approver from the same unit or above decides; only then does the write credential touch the system.
import crypto from "node:crypto";
import { getChat, saveChat } from "../lib/store.ts";
import { settle } from "../lib/actions.ts";
import type { Field, Metric } from "../lib/types.ts";
import type { WorkItemView, WorkspaceResponse } from "./api-types.ts";
import { record } from "./audit.ts";
import { connectorFor } from "./connectors/index.ts";
import type { Effective, WorkItem } from "./contract.ts";
import { approversFor, canApprove, isWithin, resolveEffective } from "./org.ts";
import { prepareWrite } from "./write-guard.ts";
import { budgetStatus, scopeSummary } from "./policy.ts";
import { get, list, memberships, put } from "./store.ts";
import { ERR, LABEL } from "../copy/server.ts";
import { DAY_MS, WEEK_DAYS } from "../config/locale.ts";
import { BUDGET_TONE, ERROR_DETAIL_CHARS, QUEUE } from "../config/server.ts";
import { moneyText } from "../lib/values.ts";

const now = () => new Date().toISOString();

export function newRef(prefix: string, at = new Date()): string {
  const yymm = `${String(at.getFullYear()).slice(2)}${String(at.getMonth() + 1).padStart(2, "0")}`;
  return `${prefix}-${yymm}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function createWorkItem(w: Pick<WorkItem, "tenantId" | "templateId" | "title" | "chatId" | "actionId" | "requestedBy" | "unitId" | "params" | "key" | "amount" | "needsApproval" | "preview" | "summary">, prefix: string): WorkItem {
  const t = now();
  return put("work", { ...w, id: `wi_${crypto.randomUUID().slice(0, 10)}`, ref: newRef(prefix), state: "awaiting_confirm", createdAt: t, updatedAt: t });
}

export const workByAction = (tenantId: string, actionId: string) => list("work", tenantId).find((w) => w.actionId === actionId) ?? null;

const nameOf = (userId: string | undefined) => (userId ? get("user", userId)?.name ?? userId : "");

/** A line the agent reads at the start of the chat's next turn: something happened since the user last wrote. */
export async function noteChat(chatId: string, note: string) {
  const chat = await getChat(chatId);
  if (!chat) return;
  chat.notes.push(note);
  await saveChat(chat);
}

async function execute(item: WorkItem, approverId?: string): Promise<WorkItem> {
  const template = get("action", item.templateId);
  const conn = template ? get("connection", template.connectionId) : null;
  const user = get("user", item.requestedBy);
  const unit = get("unit", item.unitId);
  if (!template || !conn || !user || !unit) throw new Error(ERR.proposalTargetGone);
  const actor = { userId: approverId ?? user.id, unitId: unit.id, role: approverId ? "approver" : "requester" };
  try {
    // Re-checked at write time: the requester's scope may have changed since the proposal, and the row must still be
    // exactly what was reviewed (compare-and-set inside the write's transaction).
    const { compiled } = await prepareWrite(resolveEffective(user.id, unit.id), template, item.params, item.key);
    if (template.op === "update" && item.preview?.before) compiled.expect = item.preview.before;
    const res = await connectorFor(conn, "write").execute(compiled);
    const ev = record({ tenantId: item.tenantId, actor, kind: "execute", target: `${conn.code}/${template.object}`, detail: { ref: item.ref, op: template.op, affected: res.affected, approvedBy: approverId ?? null, workId: item.id, changed: changedValues(res.before, res.after, Object.keys(compiled.values)) } });
    const receipt: Field[] = [
      { label: LABEL.referensi, value: item.ref },
      { label: LABEL.sistem, value: `${conn.code} · ${conn.name}` },
      { label: LABEL.objek, value: template.object },
      { label: LABEL.baris, value: LABEL.rowsAffected(res.affected, template.op === "insert") },
      ...(res.id ? [{ label: LABEL.no(conn.code), value: res.id }] : []),
      { label: LABEL.confirmedBy, value: user.name },
      { label: LABEL.approvedBy, value: approverId ? nameOf(approverId) : ERR.noApprovalNeeded },
      { label: LABEL.audit, value: `#${ev.seq}` },
    ];
    return put("work", { ...item, state: "executed", receipt, auditSeq: ev.seq, images: { before: res.before, after: res.after }, updatedAt: now(), ...(approverId ? { decidedBy: approverId, decidedAt: now() } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record({ tenantId: item.tenantId, actor, kind: "fail", target: `${conn.code}/${template.object}`, detail: { ref: item.ref, error: msg.slice(0, ERROR_DETAIL_CHARS) } });
    put("work", { ...item, state: "failed", error: msg, updatedAt: now() });
    throw new Error(ERR.writeFailed(conn.code, msg));
  }
}

/** Only the columns the write set, before and after: the audit trail never copies whole rows of personal data. */
const changedValues = (before: Record<string, unknown> | null, after: Record<string, unknown> | null, columns: string[]) =>
  Object.fromEntries(columns.map((c) => [c, { before: before?.[c] ?? null, after: after?.[c] ?? null }]));

/** Runs when the requester presses Confirm on the proposal card. Returns the receipt fields shown on the card. */
export async function confirmWorkItem(tenantId: string, actionId: string): Promise<{ receipt: Field[]; awaitingApproval: boolean }> {
  const item = workByAction(tenantId, actionId);
  if (!item) throw new Error(ERR.proposalNotFound);
  if (item.state !== "awaiting_confirm") throw new Error(ERR.proposalAlreadyProcessed);
  const claimed = item.needsApproval ? item : put("work", { ...item, state: "executing", updatedAt: now() });
  record({ tenantId, actor: { userId: item.requestedBy, unitId: item.unitId, role: "requester" }, kind: "confirm", target: item.ref, detail: { workId: item.id, needsApproval: item.needsApproval } });
  if (item.needsApproval) {
    put("work", { ...item, state: "awaiting_approval", updatedAt: now() });
    const approvers = approversFor(item.unitId, item.requestedBy).map((u) => u.name);
    return { awaitingApproval: true, receipt: [
      { label: LABEL.referensi, value: item.ref },
      { label: LABEL.status, value: LABEL.awaitingApproval },
      { label: LABEL.approver, value: approvers.join(", ") || "No approver in this unit yet" },
    ] };
  }
  return { awaitingApproval: false, receipt: (await execute(claimed)).receipt ?? [] };
}

export async function cancelWorkItem(tenantId: string, actionId: string): Promise<void> {
  const item = workByAction(tenantId, actionId);
  if (item?.state === "awaiting_confirm") put("work", { ...item, state: "cancelled", updatedAt: now() });
}

export async function decideWorkItem(id: string, userId: string, decision: "approve" | "reject", note?: string): Promise<WorkItem> {
  const item = get("work", id);
  if (!item) throw new Error(ERR.proposalNotFound);
  if (item.state !== "awaiting_approval") throw new Error(ERR.proposalAlreadyDecided);
  if (item.requestedBy === userId) throw new Error(ERR.cannotApproveOwn);
  if (!canApprove(userId, item)) throw new Error(ERR.andaBukanApproverUnit);
  const approver = nameOf(userId);
  if (decision === "reject") {
    record({ tenantId: item.tenantId, actor: { userId, unitId: item.unitId, role: "approver" }, kind: "reject", target: item.ref, detail: { workId: id, note: note ?? null } });
    const done = put("work", { ...item, state: "rejected", decidedBy: userId, decidedAt: now(), ...(note ? { note } : {}), updatedAt: now() });
    await settle(item.actionId, { error: ERR.rejectedBy(item.title, item.ref, approver, note ? `: ${note}` : "") });
    await noteChat(item.chatId, ERR.rejectedBy(item.title, item.ref, approver, note ? `: ${note}` : ""));
    return done;
  }
  // Claimed synchronously, before any await: a second approval of the same item finds it executing and is refused.
  const claimed = put("work", { ...item, state: "executing", ...(note ? { note } : {}), updatedAt: now() });
  record({ tenantId: item.tenantId, actor: { userId, unitId: item.unitId, role: "approver" }, kind: "approve", target: item.ref, detail: { workId: id, note: note ?? null } });
  try {
    const done = await execute(claimed, userId);
    await settle(item.actionId, { receipt: done.receipt ?? [] });
    await noteChat(item.chatId, ERR.approvedAndExecuted(item.title, item.ref, approver, done.receipt?.find((f) => f.label === "Audit")?.value ?? ""));
    return done;
  } catch (err) {
    const why = ERR.approvedButFailed(item.title, item.ref, approver, err instanceof Error ? err.message : String(err));
    await settle(item.actionId, { error: why });
    await noteChat(item.chatId, why);
    throw err;
  }
}

export function viewOf(item: WorkItem): WorkItemView {
  const template = get("action", item.templateId);
  const conn = template ? get("connection", template.connectionId) : null;
  const { preview: _preview, images: _images, ...shown } = item;
  return {
    ...shown,
    requestedByName: nameOf(item.requestedBy),
    unitName: get("unit", item.unitId)?.name ?? item.unitId,
    templateName: template?.name ?? item.templateId,
    owner: template?.owner ?? "",
    system: conn?.code ?? "",
  };
}

export function queueFor(userId: string, unitId: string): WorkspaceResponse["queue"] {
  const user = get("user", userId);
  if (!user) return { awaitingMe: [], mine: [], recent: [] };
  const all = list("work", user.tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const weekAgo = new Date(Date.now() - WEEK_DAYS * DAY_MS).toISOString();
  const approverUnits = memberships({ userId }).filter((m) => m.role === "approver" || m.role === "unit_admin").map((m) => m.unitId);
  return {
    awaitingMe: all.filter((w) => canApprove(userId, w)).slice(0, QUEUE.awaitingMax).map(viewOf),
    mine: all.filter((w) => w.requestedBy === userId && w.unitId === unitId && (w.state === "awaiting_confirm" || w.state === "awaiting_approval")).slice(0, QUEUE.mineMax).map(viewOf),
    recent: all.filter((w) => ["executed", "rejected", "failed"].includes(w.state) && w.updatedAt >= weekAgo && (isWithin(w.unitId, unitId) || approverUnits.some((u) => isWithin(w.unitId, u)))).slice(0, QUEUE.recentMax).map(viewOf),
  };
}


/** Figures every team has on this platform, computed from the platform's own records. */
export async function teamMetrics(eff: Effective): Promise<Metric[]> {
  const items = list("work", eff.tenant.id).filter((w) => isWithin(w.unitId, eff.unit.id));
  const weekAgo = new Date(Date.now() - WEEK_DAYS * DAY_MS).toISOString();
  const waiting = items.filter((w) => w.state === "awaiting_approval").length;
  const executed = items.filter((w) => w.state === "executed" && w.updatedAt >= weekAgo).length;
  const scope = scopeSummary(eff);
  const budget = budgetStatus(eff);
  const out: Metric[] = [
    { label: LABEL.awaitingApproval, value: String(waiting), tone: waiting ? "warn" : "neutral" },
    { label: LABEL.executedSevenDays, value: String(executed), tone: "good" },
    { label: LABEL.systemsInScope, value: LABEL.msg(scope.systems.length, scope.systems.length + scope.outOfScope.length), tone: "info" },
  ];
  out.push(budget.limit
    ? { label: LABEL.aiBudgetThisMonth, value: `${moneyText(budget.used)} / ${moneyText(budget.limit)}`, tone: budget.used / budget.limit > BUDGET_TONE.bad ? "bad" : budget.used / budget.limit > BUDGET_TONE.warn ? "warn" : "neutral" }
    : { label: LABEL.aiBudgetThisMonth, value: LABEL.noLimit, tone: "neutral" });
  return out;
}
