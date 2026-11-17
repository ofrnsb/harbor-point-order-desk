// What the toolkit keeps in the platform store. Every record carries its tenant, unit and the user who made it,
// so list tools only ever show a user their own records or their unit's.
export type Owned = { id: string; tenantId: string; unitId: string; userId: string; userName: string; createdAt: string };

/** A finalized document in the company's register. */
export type TkDocument = Owned & { ref: string; title: string; docType: string; body: string; facts: { label: string; value: string }[] };
/** A message waiting in the outbox. Nothing here is ever marked delivered: a channel integration does that. */
export type TkMessage = Owned & { ref: string; channel: "email" | "internal"; to: string; toName: string; subject: string; body: string; sendAt: string; status: "queued" | "scheduled" };
export type TkTask = Owned & { ref: string; title: string; detail: string; assigneeId: string; assigneeName: string; dueAt: string | null; status: "open" | "in_progress" | "done" | "cancelled"; recordKey: string | null; updatedAt: string };
export type TkNote = Owned & { recordKey: string; text: string };
export type TkReminder = Owned & { ref: string; text: string; dueAt: string; recordKey: string | null };
export type TkWatch = Owned & {
  ref: string; name: string; system: string; object: string;
  filters: { column: string; op: string; value?: unknown }[];
  condition: { kind: "count_gt" | "count_gte" | "count_lt" | "count_eq" | "any_new"; value: number };
  keyColumn: string | null; lastCheckedAt: string | null; lastCount: number | null; lastKeys: string[];
};
