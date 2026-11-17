// Communication and follow-up: messages to an outbox, tasks, notes on records and reminders.
// Anything that changes state is proposed and runs only after the user confirms. The outbox never claims delivery:
// a channel integration (email gateway, WhatsApp Business API) sends from it.
import { z } from "zod";
import { defineTool, type ToolCtx } from "../../lib/domain.ts";
import { get, list, put } from "../../platform/store.ts";
import type { Access, Toolkit } from "./index.ts";
import type { TkMessage, TkNote, TkReminder, TkTask } from "./records.ts";
import { col, makeRows, newId, newRef, ownerPayload, rowsRef, type OwnerPayload } from "./shared.ts";
import { SHARED, TK_WORK as T } from "../../copy/domain.ts";
import { ID_PREFIX, MESSAGE, NO_DUE_SORT_KEY, NOTE, OUTBOX_LISTED, REF_PREFIX, REMINDER_TEXT, TASK, TIME_ARG_MAX, TOOL_ARG } from "../../config/domain.ts";
import { LOCALE } from "../../config/locale.ts";

const when = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }) : SHARED.empty);
const future = (iso: string | undefined, what: string) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(T.badTime(what, iso));
  return new Date(t).toISOString();
};
/** Records a user may see: their own, or their unit's when `unit` is asked. */
const visible = <T extends { tenantId: string; unitId: string; userId: string }>(rows: T[], ctx: ToolCtx, scope: "mine" | "unit") =>
  rows.filter((r) => r.tenantId === ctx.eff.tenant.id && (scope === "unit" ? r.unitId === ctx.eff.unit.id : r.userId === ctx.principal.userId));

/** Fill {column} placeholders from one row. Unknown placeholders stay visible so the user sees what is missing. */
export function merge(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (row[k] === null || row[k] === undefined ? m : String(row[k])));
}

export const work = (_a: Access): Toolkit => ({
  tools: [
    defineTool({
      name: "send_message",
      category: "messages",
      description: T.send.description,
      shape: {
        channel: z.enum(["email", "internal"]),
        to: z.string().trim().max(MESSAGE.to).optional().describe(T.send.to),
        to_name: z.string().trim().max(MESSAGE.toName).optional(),
        recipients_ref: z.string().max(TOOL_ARG.ref).optional(), recipient_column: z.string().max(TOOL_ARG.name).optional(), name_column: z.string().max(TOOL_ARG.name).optional(),
        subject: z.string().trim().max(MESSAGE.subject).optional(), body: z.string().trim().min(MESSAGE.body.min).max(MESSAGE.body.max),
        send_at: z.string().max(TIME_ARG_MAX).optional().describe(T.send.sendAt),
      },
      label: (i) => ({ running: T.send.running(String(i.channel)), done: T.send.done(String(i.channel)) }),
      run: async ({ channel, to, to_name, recipients_ref, recipient_column, name_column, subject, body, send_at }, ctx) => {
        const sendAt = future(send_at, "send_at");
        let messages: { to: string; toName: string; subject: string; body: string }[];
        if (recipients_ref) {
          if (!recipient_column) throw new Error(T.send.needColumn);
          const r = rowsRef(ctx, recipients_ref);
          if (!r.columns.some((c) => c.name === recipient_column)) throw new Error(T.send.columnMissing(recipient_column, recipients_ref, r.columns.map((c) => c.name).join(SHARED.columnSep)));
          messages = r.rows.filter((row) => row[recipient_column]).slice(0, MESSAGE.recipients).map((row) => ({ to: String(row[recipient_column]), toName: name_column ? String(row[name_column] ?? "") : "", subject: merge(subject ?? "", row), body: merge(body, row) }));
          if (!messages.length) throw new Error(T.send.noRecipients(recipient_column));
          if (messages.some((m) => T.send.maskedValue.test(m.to))) throw new Error(T.send.masked(recipient_column));
        } else {
          if (!to) throw new Error(T.send.needTo);
          messages = [{ to, toName: to_name ?? "", subject: subject ?? "", body }];
        }
        const first = messages[0];
        const a = await ctx.propose({
          type: "tk_send_message",
          payload: { ...ownerPayload(ctx), channel, sendAt, messages },
          title: messages.length > 1 ? T.send.titleMany(messages.length, channel) : T.send.titleOne(channel, first.toName || first.to),
          summary: [
            { label: T.send.channel, value: T.channels[channel] },
            { label: T.send.recipient, value: messages.length > 1 ? T.send.recipientsMany(messages.length, first.toName || first.to) : first.toName ? T.send.recipientNamed(first.toName, first.to) : first.to },
            ...(first.subject ? [{ label: T.send.subject, value: first.subject }] : []),
            { label: T.send.body, value: first.body.slice(0, MESSAGE.summaryBody) },
            { label: T.send.sendTime, value: sendAt ? when(sendAt, ctx.eff.tenant.timezone) : T.send.now },
          ],
          consequence: T.send.consequence(channel, !!sendAt),
          danger: messages.length > MESSAGE.dangerAbove,
        });
        return T.send.result(a.id, messages.length);
      },
    }),
    defineTool({
      name: "list_outbox",
      category: "messages",
      description: T.outbox.description,
      shape: { scope: z.enum(["mine", "unit"]).optional() },
      label: () => ({ running: T.outbox.running, done: T.outbox.done }),
      run: async ({ scope }, ctx) => {
        const rows = visible(list("tk_message", ctx.eff.tenant.id), ctx, scope ?? "mine").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, OUTBOX_LISTED);
        const C = T.outbox.cols;
        const saved = ctx.save(makeRows(T.outbox.title, [col("ref", C.ref), col("to", C.to), col("channel", C.channel, "text", { role: "category" }), col("subject", C.subject), col("send_at", C.sendAt, "date", { role: "date" }), col("status", C.status, "text", { role: "status" }), col("by", C.by)],
          rows.map((m) => ({ ref: m.ref, to: m.toName ? T.send.recipientNamed(m.toName, m.to) : m.to, channel: m.channel, subject: m.subject || m.body.slice(0, MESSAGE.subjectPreview), send_at: m.sendAt, status: m.status === "scheduled" ? T.outbox.scheduled : T.outbox.queued, by: m.userName }))));
        return T.outbox.result(saved.id, rows.length);
      },
    }),
    defineTool({
      name: "create_task",
      category: "tasks",
      description: T.createTask.description,
      shape: {
        title: z.string().trim().min(TASK.title.min).max(TASK.title.max), detail: z.string().trim().max(TASK.detail).optional(),
        assignee_user_id: z.string().max(TOOL_ARG.name).optional().describe(T.createTask.assignee),
        due_at: z.string().max(TIME_ARG_MAX).optional(), record_key: z.string().max(TASK.recordKey).optional(),
      },
      label: (i) => ({ running: T.createTask.running(String(i.title ?? "")).trim(), done: T.createTask.done }),
      run: async ({ title, detail, assignee_user_id, due_at, record_key }, ctx) => {
        const dueAt = future(due_at, "due_at");
        const assignee = assignee_user_id ? get("user", assignee_user_id) : ctx.eff.user;
        if (!assignee || assignee.tenantId !== ctx.eff.tenant.id) throw new Error(T.userMissing(assignee_user_id));
        const a = await ctx.propose({
          type: "tk_create_task",
          payload: { ...ownerPayload(ctx), title, detail: detail ?? "", assigneeId: assignee.id, assigneeName: assignee.name, dueAt, recordKey: record_key ?? null },
          title: T.createTask.title(title),
          summary: [{ label: T.createTask.task, value: title }, { label: T.owner, value: assignee.name }, { label: T.createTask.due, value: when(dueAt, ctx.eff.tenant.timezone) }, ...(record_key ? [{ label: T.related, value: record_key }] : [])],
          consequence: T.createTask.consequence(assignee.name),
          danger: false,
        });
        return T.pending(a.id);
      },
    }),
    defineTool({
      name: "update_task",
      category: "tasks",
      description: T.updateTask.description,
      shape: { ref: z.string().max(TOOL_ARG.ref), status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(), assignee_user_id: z.string().max(TOOL_ARG.name).optional(), due_at: z.string().max(TIME_ARG_MAX).optional(), note: z.string().max(TASK.note).optional() },
      label: (i) => ({ running: T.updateTask.running(String(i.ref)), done: T.updateTask.done(String(i.ref)) }),
      run: async ({ ref, status, assignee_user_id, due_at, note }, ctx) => {
        const t = list("tk_task", ctx.eff.tenant.id).find((x) => x.ref === ref);
        if (!t || (t.userId !== ctx.principal.userId && t.assigneeId !== ctx.principal.userId)) throw new Error(T.updateTask.notFound(ref));
        const assignee = assignee_user_id ? get("user", assignee_user_id) : null;
        if (assignee_user_id && (!assignee || assignee.tenantId !== ctx.eff.tenant.id)) throw new Error(T.userMissing(assignee_user_id));
        const dueAt = due_at ? future(due_at, "due_at") : undefined;
        const changes = [status && T.updateTask.status(status), assignee && T.updateTask.owner(assignee.name), dueAt && T.updateTask.due(when(dueAt, ctx.eff.tenant.timezone))].filter(Boolean);
        if (!changes.length) throw new Error(T.updateTask.nothing);
        const a = await ctx.propose({
          type: "tk_update_task", payload: { id: t.id, status, assigneeId: assignee?.id, assigneeName: assignee?.name, dueAt, note },
          title: T.updateTask.title(t.ref), summary: [{ label: T.createTask.task, value: t.title }, { label: T.updateTask.changes, value: changes.join(T.updateTask.changeSep) }], consequence: T.updateTask.consequence, danger: false,
        });
        return T.pending(a.id);
      },
    }),
    defineTool({
      name: "list_tasks",
      category: "tasks",
      description: T.listTasks.description,
      shape: { scope: z.enum(["mine", "created", "unit"]).optional(), include_done: z.boolean().optional() },
      label: () => ({ running: T.listTasks.running, done: T.listTasks.done }),
      run: async ({ scope, include_done }, ctx) => {
        const s = scope ?? "mine", now = new Date().toISOString();
        const rows = list("tk_task", ctx.eff.tenant.id).filter((t) => (s === "mine" ? t.assigneeId === ctx.principal.userId : s === "created" ? t.userId === ctx.principal.userId : t.unitId === ctx.eff.unit.id))
          .filter((t) => include_done || (t.status !== "done" && t.status !== "cancelled"))
          .sort((a, b) => (a.dueAt ?? NO_DUE_SORT_KEY).localeCompare(b.dueAt ?? NO_DUE_SORT_KEY)).slice(0, TASK.listed);
        const overdue = rows.filter((t) => t.dueAt && t.dueAt < now && t.status !== "done").length;
        const C = T.listTasks.cols;
        const saved = ctx.save(makeRows(T.listTasks.title, [col("ref", C.ref, "text", { role: "key" }), col("title", C.title, "text", { role: "title" }), col("assignee", C.assignee, "text", { role: "category" }), col("due_at", C.due, "date", { role: "start" }), col("status", C.status, "text", { role: "status" }), col("record", C.record)],
          rows.map((t) => ({ ref: t.ref, title: t.title, assignee: t.assigneeName, due_at: t.dueAt, status: t.status, record: t.recordKey }))));
        return T.listTasks.result(saved.id, rows.length, overdue);
      },
    }),
    defineTool({
      name: "add_note",
      category: "tasks",
      description: T.addNote.description,
      shape: { record_key: z.string().trim().min(1).max(TASK.recordKey), text: z.string().trim().min(NOTE.text.min).max(NOTE.text.max) },
      label: (i) => ({ running: T.addNote.running(String(i.record_key)), done: T.addNote.done(String(i.record_key)) }),
      run: async ({ record_key, text }, ctx) => {
        put("tk_note", { id: newId(ID_PREFIX.note), ...ownerPayload(ctx), createdAt: new Date().toISOString(), recordKey: record_key, text } satisfies TkNote);
        return T.addNote.result(record_key);
      },
    }),
    defineTool({
      name: "list_notes",
      category: "tasks",
      description: T.listNotes.description,
      shape: { record_key: z.string().trim().min(1).max(TASK.recordKey) },
      label: (i) => ({ running: T.listNotes.running(String(i.record_key)), done: T.listNotes.done(String(i.record_key)) }),
      run: async ({ record_key }, ctx) => {
        const rows = visible(list("tk_note", ctx.eff.tenant.id), ctx, "unit").filter((n) => n.recordKey === record_key).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (!rows.length) return T.listNotes.none(record_key);
        const C = T.listNotes.cols;
        const saved = ctx.save(makeRows(T.listNotes.title(record_key), [col("at", C.at, "date", { role: "date" }), col("text", C.text), col("by", C.by)], rows.map((n) => ({ at: n.createdAt, text: n.text, by: n.userName }))));
        return T.listNotes.result(saved.id, rows.length, rows.slice(0, NOTE.lines).map((n) => T.listNotes.line(when(n.createdAt, ctx.eff.tenant.timezone), n.userName, n.text)).join("\n"));
      },
    }),
    defineTool({
      name: "set_reminder",
      category: "tasks",
      description: T.setReminder.description,
      shape: { text: z.string().trim().min(REMINDER_TEXT.min).max(REMINDER_TEXT.max), due_at: z.string().max(TIME_ARG_MAX), record_key: z.string().max(TASK.recordKey).optional() },
      label: () => ({ running: T.setReminder.running, done: T.setReminder.done }),
      run: async ({ text, due_at, record_key }, ctx) => {
        const dueAt = future(due_at, "due_at")!;
        if (Date.parse(dueAt) < Date.now()) throw new Error(T.setReminder.past);
        const a = await ctx.propose({
          type: "tk_set_reminder", payload: { ...ownerPayload(ctx), text, dueAt, recordKey: record_key ?? null },
          title: T.setReminder.title, summary: [{ label: T.setReminder.reminder, value: text }, { label: T.timeLabel, value: when(dueAt, ctx.eff.tenant.timezone) }, ...(record_key ? [{ label: T.related, value: record_key }] : [])],
          consequence: T.setReminder.consequence, danger: false,
        });
        return T.pending(a.id);
      },
    }),
    defineTool({
      name: "list_reminders",
      category: "tasks",
      description: T.listReminders.description,
      shape: {},
      label: () => ({ running: T.listReminders.running, done: T.listReminders.done }),
      run: async (_i, ctx) => {
        const now = new Date().toISOString();
        const rows = visible(list("tk_reminder", ctx.eff.tenant.id), ctx, "mine").sort((a, b) => a.dueAt.localeCompare(b.dueAt));
        const C = T.listReminders.cols;
        const saved = ctx.save(makeRows(T.listReminders.title, [col("ref", C.ref, "text", { role: "key" }), col("text", C.text, "text", { role: "title" }), col("due_at", C.due, "date", { role: "start" }), col("state", C.state, "text", { role: "status" }), col("record", C.record)],
          rows.map((r) => ({ ref: r.ref, text: r.text, due_at: r.dueAt, state: r.dueAt <= now ? T.listReminders.due : T.listReminders.scheduled, record: r.recordKey }))));
        return T.listReminders.result(saved.id, rows.length, rows.filter((r) => r.dueAt <= now).length);
      },
    }),
  ],
  actions: {
    tk_send_message: async (a) => {
      const p = a.payload as OwnerPayload & { channel: TkMessage["channel"]; sendAt: string | null; messages: { to: string; toName: string; subject: string; body: string }[] };
      const refs: string[] = [];
      for (const m of p.messages) {
        const ref = newRef(REF_PREFIX.message);
        refs.push(ref);
        put("tk_message", { id: newId(ID_PREFIX.message), tenantId: p.tenantId, unitId: p.unitId, userId: p.userId, userName: p.userName, createdAt: new Date().toISOString(), ref, channel: p.channel, ...m, sendAt: p.sendAt ?? new Date().toISOString(), status: p.sendAt ? "scheduled" : "queued" } satisfies TkMessage);
      }
      return [{ label: T.refLabel, value: refs.length > 1 ? T.send.refMany(refs[0], refs.length - 1) : refs[0] }, { label: T.statusLabel, value: p.sendAt ? T.send.scheduled : T.send.queued }, { label: T.send.count, value: String(refs.length) }];
    },
    tk_create_task: async (a) => {
      const p = a.payload as OwnerPayload & { title: string; detail: string; assigneeId: string; assigneeName: string; dueAt: string | null; recordKey: string | null };
      const ref = newRef(REF_PREFIX.task), now = new Date().toISOString();
      put("tk_task", { id: newId(ID_PREFIX.task), tenantId: p.tenantId, unitId: p.unitId, userId: p.userId, userName: p.userName, createdAt: now, updatedAt: now, ref, title: p.title, detail: p.detail, assigneeId: p.assigneeId, assigneeName: p.assigneeName, dueAt: p.dueAt, status: "open", recordKey: p.recordKey } satisfies TkTask);
      return [{ label: T.refLabel, value: ref }, { label: T.owner, value: p.assigneeName }];
    },
    tk_update_task: async (a) => {
      const p = a.payload as { id: string; status?: TkTask["status"]; assigneeId?: string; assigneeName?: string; dueAt?: string; note?: string };
      const t = get("tk_task", p.id);
      if (!t) throw new Error(T.updateTask.gone);
      const next: TkTask = { ...t, ...(p.status ? { status: p.status } : {}), ...(p.assigneeId ? { assigneeId: p.assigneeId, assigneeName: p.assigneeName! } : {}), ...(p.dueAt ? { dueAt: p.dueAt } : {}), detail: p.note ? `${t.detail}\n${p.note}`.trim() : t.detail, updatedAt: new Date().toISOString() };
      put("tk_task", next);
      return [{ label: T.refLabel, value: t.ref }, { label: T.statusLabel, value: next.status }];
    },
    tk_set_reminder: async (a) => {
      const p = a.payload as OwnerPayload & { text: string; dueAt: string; recordKey: string | null };
      const ref = newRef(REF_PREFIX.reminder);
      put("tk_reminder", { id: newId(ID_PREFIX.reminder), tenantId: p.tenantId, unitId: p.unitId, userId: p.userId, userName: p.userName, createdAt: new Date().toISOString(), ref, text: p.text, dueAt: p.dueAt, recordKey: p.recordKey } satisfies TkReminder);
      return [{ label: T.refLabel, value: ref }, { label: T.timeLabel, value: new Date(p.dueAt).toLocaleString(LOCALE) }];
    },
  },
});
