// New data into the ERP and the inbox without touching anything already there unless the upload changes it: every file
// is read (datasets.ts), emails are recognised by Message-ID or content and skipped when known, ERP rows are merged on
// their keys (load.ts). An upload is checked first and written only when the person applies it; then the checks on
// every email still waiting for review run again against the new data.
import { record } from "../../platform/audit.ts";
import { ERP_TABLES as T } from "../../config/erp.ts";
import { INGEST } from "../../config/orders.ts";
import { INGEST_TEXT as M } from "../../copy/orders.ts";
import { erpDb } from "./erp.ts";
import { ingestInbox, recheckOpen } from "./desk.ts";
import { fingerprint, type ParsedEmail } from "./mail.ts";
import { readUploads, type Read, type Upload } from "./datasets.ts";
import { loadBatches, type TableReport } from "./load.ts";

export type { Upload } from "./datasets.ts";
export type IngestReport = {
  applied: boolean;
  added: { id: string; subject: string; from: string }[];
  duplicates: { source: string; id: string }[];
  rejected: { source: string; reason: string }[];
  tables: TableReport[];
  rechecked: number;
};
export type Uploader = { tenantId: string; userId: string; unitId: string; role: string; mayChangeErp: boolean };

const MB = 1_000_000;
const idOf = (n: number) => `${INGEST.idPrefix}${String(n).padStart(INGEST.idDigits, "0")}`;
const ROLLBACK = Symbol("preview");

/** Refuses an upload over the limits before anything is read. */
export function checkUploadSize(files: { size: number }[]): string | null {
  if (!files.length) return M.noFiles;
  if (files.length > INGEST.filesMax) return M.tooMany(INGEST.filesMax);
  return files.reduce((s, f) => s + f.size, 0) > INGEST.totalBytesMax ? M.tooBig(INGEST.totalBytesMax / MB) : null;
}

function storeEmails(emails: { source: string; email: ParsedEmail }[], report: IngestReport): void {
  const d = erpDb();
  const known = d.prepare(`SELECT email_id FROM ${T.inbox} WHERE message_id = ? OR fingerprint = ?`);
  const insert = d.prepare(`INSERT INTO ${T.inbox} (email_id, received_at, from_name, from_email, to_address, subject, body, attachments, message_id, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let next = ((d.prepare(`SELECT max(CAST(substr(email_id, ${INGEST.idPrefix.length + 1}) AS INTEGER)) AS n FROM ${T.inbox}`).get() as { n: number | null }).n ?? 0) + 1;
  for (const { source, email: e } of emails) {
    const print = fingerprint(e);
    const twin = known.get(e.messageId, print) as { email_id: string } | undefined;
    if (twin) { report.duplicates.push({ source, id: twin.email_id }); continue; }
    const id = idOf(next++);
    insert.run(id, e.receivedAt, e.fromName, e.fromEmail, e.to, e.subject, e.body, JSON.stringify(e.attachments), e.messageId, print);
    report.added.push({ id, subject: e.subject, from: e.fromEmail });
  }
}

/** Splits what was read into what this person may write, and what is refused with a reason. */
function permitted(read: Read, by: Uploader, report: IngestReport) {
  report.rejected.push(...read.unreadable);
  for (const e of read.emails) if (!e.parsed.ok) report.rejected.push({ source: e.source, reason: e.parsed.reason });
  if (!by.mayChangeErp) report.rejected.push(...read.batches.map((b) => ({ source: b.source, reason: M.erpAdminOnly })));
  const emails = read.emails.flatMap((e) => (e.parsed.ok ? [{ source: e.source, email: e.parsed.email }] : []));
  return { emails, batches: by.mayChangeErp ? read.batches : [] };
}

/** Reads an upload and writes it in one transaction: committed when `apply`, rolled back for a preview. */
export function ingestUploads(by: Uploader, uploads: Upload[], apply: boolean): IngestReport {
  const report: IngestReport = { applied: false, added: [], duplicates: [], rejected: [], tables: [], rechecked: 0 };
  const read = readUploads(uploads);
  const all = uploads.map((u) => u.name).join(", ");
  if (read.emails.length > INGEST.emailsMax) return { ...report, rejected: [{ source: all, reason: M.tooManyEmails(INGEST.emailsMax) }] };
  if (read.batches.reduce((s, b) => s + b.rows.length, 0) > INGEST.rowsMax) return { ...report, rejected: [{ source: all, reason: M.tooManyRows(INGEST.rowsMax) }] };
  const { emails, batches } = permitted(read, by, report);
  try {
    erpDb().transaction(() => {
      report.tables = loadBatches(erpDb(), batches);
      storeEmails(emails, report);
      if (!apply) throw ROLLBACK;
    })();
  } catch (err) { if (err !== ROLLBACK) throw err; return report; }
  ingestInbox(by.tenantId);
  const rechecked = report.tables.some((t) => t.added + t.updated > 0) ? recheckOpen(by.tenantId) : 0;
  record({ tenantId: by.tenantId, actor: { userId: by.userId, unitId: by.unitId, role: by.role }, kind: "ingest", target: "inbox", detail: { added: report.added.map((a) => a.id), duplicates: report.duplicates.length, rejected: report.rejected.length, tables: report.tables.map((t) => ({ table: t.table, source: t.source, added: t.added, updated: t.updated, changes: t.changes })), rechecked, files: uploads.map((u) => u.name) } });
  return { ...report, applied: true, rechecked };
}
