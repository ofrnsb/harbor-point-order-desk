"use client";
// Adds new data from files the person picks: emails, or ERP records (customers, prices, stock, orders) as CSV, JSON or
// SQLite. The upload is checked first and shown; nothing is written until the person presses Apply.
import { useRef, useState } from "react";
import { motion } from "motion/react";
import { INGEST } from "@/config/orders";
import { API } from "@/config/routes";
import { INBOX, INGEST_TEXT, TABLE_LABEL } from "@/copy/orders";
import type { IngestReport } from "@/domain/orders/ingest";
import { Badge, Button, Notice } from "../ui";
import { D, EASE } from "../motion";
import { ICheck, IClose, IPlus } from "../icons";
import { api } from "../sp/client";
import { refreshInbox } from "./store";

const T = INBOX.upload;
type Tone = "good" | "neutral" | "warn" | "info";
type Line = { key: string; label: string; tone: Tone; name: string; detail: string };
export type Upload = { files: File[]; report: IngestReport | null; error: string | null; busy: boolean };

function linesOf(r: IngestReport): Line[] {
  return [
    ...r.tables.map((t): Line => ({ key: `t-${t.source}`, label: TABLE_LABEL[t.table] ?? t.table, tone: "info", name: t.source, detail: T.tableLine(t.added, t.updated, t.unchanged) })),
    ...r.tables.flatMap((t) => t.rejected.map((x): Line => ({ key: `tr-${t.source}-${x.row}`, label: T.status.skipped, tone: "warn", name: t.source, detail: T.rowRefused(TABLE_LABEL[t.table] ?? t.table, x.row, x.reason) }))),
    ...r.added.map((a): Line => ({ key: `a-${a.id}`, label: T.status.added, tone: "good", name: a.id, detail: T.addedLine(a.subject, a.from) })),
    ...r.duplicates.map((d, i): Line => ({ key: `d-${i}-${d.source}`, label: T.status.known, tone: "neutral", name: d.source, detail: INGEST_TEXT.duplicateOf(d.id) })),
    ...r.rejected.map((x, i): Line => ({ key: `r-${i}-${x.source}`, label: T.status.skipped, tone: "warn", name: x.source, detail: x.reason })),
  ];
}

const changed = (r: IngestReport) => r.added.length + r.tables.reduce((s, t) => s + t.added + t.updated, 0);
const skipped = (r: IngestReport) => r.rejected.length + r.tables.reduce((s, t) => s + t.rejected.length, 0);

/** What an upload holds (before Apply) or did (after), one line per table, email or refusal. */
export function UploadReport({ u, onApply, onClose }: { u: Upload; onApply: () => void; onClose: () => void }) {
  if (u.error) return <Notice tone="bad" onClose={onClose}>{T.failed}: {u.error}</Notice>;
  const r = u.report;
  if (!r) return null;
  const records = r.tables.reduce((s, t) => s + t.added + t.updated, 0);
  return (
    <motion.section className="hp-report" aria-label={T.button} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d2, ease: EASE }}>
      <header className="hp-report-head">
        <span className="hp-report-title">
          <span className="hp-muted">{r.applied ? T.appliedTitle : T.previewTitle}</span>
          <strong>{T.summary(r.added.length, r.duplicates.length, records, skipped(r))}</strong>
        </span>
        {r.applied || !changed(r)
          ? <Button tone="ghost" icon={<IClose size={14} />} onClick={onClose}>{T.dismiss}</Button>
          : <span className="hp-report-actions">
              <Button tone="ghost" onClick={onClose} disabled={u.busy}>{T.cancel}</Button>
              <Button tone="primary" icon={<ICheck size={14} />} onClick={onApply} disabled={u.busy}>{u.busy ? T.applying : T.apply}</Button>
            </span>}
      </header>
      <ul className="hp-report-lines">
        {linesOf(r).map((l) => (
          <li key={l.key}>
            <Badge tone={l.tone}>{l.label}</Badge>
            <span className="hp-mono">{l.name}</span>
            <span className="hp-muted" dir="auto">{l.detail}</span>
          </li>
        ))}
      </ul>
      {r.applied && r.rechecked > 0 && <span className="hp-muted">{T.rechecked(r.rechecked)}</span>}
    </motion.section>
  );
}

/** Sends the files to be checked (apply false) or written (apply true). */
export async function sendUpload(files: File[], apply: boolean): Promise<IngestReport> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  form.append("apply", String(apply));
  const r = await api<IngestReport>(API.inboxIngest, { method: "POST", body: form });
  if (apply) await refreshInbox();
  return r;
}

/** The button and its file picker; the screen shows the check under its header. */
export function AddData({ onUpload }: { onUpload: (u: Upload) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setBusy(true);
    onUpload({ files, report: null, error: null, busy: true });
    try { onUpload({ files, report: await sendUpload(files, false), error: null, busy: false }); }
    catch (err) { onUpload({ files, report: null, error: err instanceof Error ? err.message : T.failed, busy: false }); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return (
    <>
      <input ref={input} type="file" multiple accept={INGEST.accept} hidden aria-label={T.button} onChange={(e) => void pick(e.target.files)} data-testid="add-data-input" />
      <Button tone="secondary" icon={<IPlus size={15} />} disabled={busy} title={T.hint} onClick={() => input.current?.click()}>{busy ? T.reading : T.button}</Button>
    </>
  );
}
