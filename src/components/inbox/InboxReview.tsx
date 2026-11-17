"use client";
// One email under review: the email beside the agent's decision, the orders it would put into the ERP (editable, with
// the checks re-run as the reviewer types), the reply it drafted, and what it did to get there. Approve, edit or reject.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { INBOX_POLL } from "@/config/orders";
import { API } from "@/config/routes";
import { AUDIT } from "@/copy/app-admin";
import { ACCOUNT_STATUS_LABEL, CHECK_LABEL, FLAG_LABEL, FLAG_TEXT, INBOX as T, KIND_LABEL, STATE_LABEL } from "@/copy/orders";
import { moneyText } from "@/lib/values";
import type { Checked, DraftLine, Proposal } from "@/domain/orders/types";
import type { TriageDetail } from "@/domain/orders/views";
import { Badge, Button, Notice, Status, Text, TextArea, TextInput } from "../ui";
import { Skeleton } from "../ui/skeleton";
import { State } from "../ui/state";
import { IArrowLeft, ICheck, IClose, IChat, IInfo } from "../icons";
import { D, EASE } from "../motion";
import { api } from "../sp/client";
import { SEVERITY_TONE, STATE_TONE, issuesOf, longDay, stampOf, timeOf } from "./format";
import { refreshInbox, useInbox } from "./store";

const TITLE_OF = (p: Proposal) => (p.action === "create" ? T.proposalTitle.create : `${T.proposalTitle[p.action]} ${p.soNumber}`);

function approveLabel(proposals: Proposal[]): string {
  const kinds = new Set(proposals.map((p) => p.action));
  if (!kinds.size) return T.approve.reply;
  return kinds.size === 1 ? T.approve[[...kinds][0]] : T.approve.mixed;
}

function LineRow({ l, i, edit, onChange, onRemove }: { l: Checked["lines"][number]; i: number; edit: boolean; onChange: (patch: Partial<DraftLine>) => void; onRemove: () => void }) {
  const short = l.name && l.available < l.qty - (l.previousQty ?? 0);
  return (
    <tr>
      <td dir="auto">
        <span className="hp-cell-main">{l.name || CHECK_LABEL.unknown_sku}</span>
        <span className="hp-line-sub">
          {edit ? <input className="sp-input hp-sku-input" value={l.sku} aria-label={`${T.line.sku} ${i + 1}`} spellCheck={false} onChange={(e) => onChange({ sku: e.target.value.toUpperCase(), skuNamed: false })} /> : <span className="hp-mono">{l.sku}</span>}
          {l.name && <span className="hp-muted" data-tone={short ? "bad" : undefined}>{T.stock(l.available, l.nextSupply)}</span>}
        </span>
      </td>
      <td className="ap-num hp-num">
        <span className="hp-cell-main">{edit ? <input className="sp-input ap-num hp-qty" inputMode="numeric" aria-label={`${T.line.qty} ${l.sku}`} value={String(l.qty)} onChange={(e) => onChange({ qty: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /> : l.qty} <span className="hp-muted">{l.uom}</span></span>
        {l.previousQty !== undefined && <span className="hp-muted">{T.line.was} {l.previousQty}</span>}
      </td>
      <td className="ap-num hp-num"><span className="hp-cell-main">{moneyText(l.unitPrice)}</span><span className="hp-muted">{T.priceSource[l.priceSource]}</span></td>
      <td className="ap-num hp-num"><span className="hp-cell-main">{moneyText(l.value)}</span></td>
      {edit && <td className="hp-line-end"><Button tone="ghost" icon={<IClose size={13} />} aria-label={`${T.removeLine} ${l.sku}`} onClick={onRemove}>{T.removeLine}</Button></td>}
    </tr>
  );
}

function ProposalView({ p, c, edit, onEdit }: { p: Proposal; c: Checked | undefined; edit: boolean; onEdit: (p: Proposal) => void }) {
  const lines = "lines" in p ? p.lines : [];
  const setLine = (i: number, patch: Partial<DraftLine>) => "lines" in p && onEdit({ ...p, lines: lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const drop = (i: number) => "lines" in p && lines.length > 1 && onEdit({ ...p, lines: lines.filter((_, j) => j !== i) });
  return (
    <section className="hp-proposal">
      <header className="hp-proposal-head">
        <strong>{TITLE_OF(p)}</strong>
        {c?.customerName && <span className="hp-muted">{c.customerName}</span>}
        {c?.shipTo && <span className="hp-muted">{T.shipTo}: {c.shipTo.name}, {c.shipTo.address}</span>}
        {p.action === "create" && p.customerPo && <span className="hp-muted">{T.po}: <span className="hp-mono">{p.customerPo}</span></span>}
        {p.action === "create" && p.requestedDate && <span className="hp-muted">{T.requested}: {longDay(p.requestedDate)}</span>}
        {p.action === "cancel" && <span className="hp-muted">{p.reason}</span>}
      </header>
      {c && c.lines.length > 0 && (
        <div className="hp-lines-wrap">
          <table className="hp-lines">
            <thead><tr><th>{T.line.product}</th><th className="hp-num">{T.line.qty}</th><th className="hp-num">{T.line.price}</th><th className="hp-num">{T.line.value}</th>{edit && p.action !== "cancel" && <th><span className="hp-sr">{T.removeLine}</span></th>}</tr></thead>
            <tbody>{c.lines.map((l, i) => <LineRow key={`${i}-${l.sku}`} l={l} i={i} edit={edit && p.action !== "cancel"} onChange={(patch) => setLine(i, patch)} onRemove={() => drop(i)} />)}</tbody>
          </table>
        </div>
      )}
      {c && (
        <footer className="hp-proposal-foot">
          <span><span className="hp-muted">{p.action === "create" ? T.total : T.change}</span> <strong className="ap-num">{moneyText(c.total)}</strong></span>
          {c.credit && <span className="hp-muted">{T.credit(moneyText(c.credit.after), moneyText(c.credit.limit), ACCOUNT_STATUS_LABEL[c.credit.status] ?? c.credit.status)}</span>}
        </footer>
      )}
      {!!c?.issues.length && (
        <ul className="hp-issues">
          {c.issues.map((x, i) => <li key={`${i}-${x.code}`}><Badge tone={SEVERITY_TONE[x.severity]}>{CHECK_LABEL[x.code]}</Badge><span dir="auto">{x.message}</span></li>)}
        </ul>
      )}
    </section>
  );
}

/** Two letters for the sender, like a mail client. */
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/** The attachments column holds a JSON list of file names. */
function attachmentsOf(raw: string | undefined): string {
  const names = raw ? (JSON.parse(raw) as string[]) : [];
  return names.length ? T.attachedFiles(names.join(", ")) : T.noAttachments;
}

type AuditRow = TriageDetail["audit"][number];
const objectOf = (e: AuditRow) => e.target.split("/").pop() ?? e.target;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");

/** Each audit event as a sentence; anything without one falls back to the audit log's own name for it. */
const EVENT_TEXT: Partial<Record<string, (e: AuditRow) => string>> = {
  query: (e) => T.event.query(objectOf(e), Number(e.detail.rows ?? 0)),
  aggregate: (e) => T.event.aggregate(objectOf(e)),
  denied: (e) => T.event.denied(objectOf(e)),
  triage: (e) => T.event.triage(STATE_LABEL[e.detail.state as keyof typeof STATE_LABEL] ?? str(e.detail.state)),
  release: (e) => T.event.release(list(e.detail.soNumbers)),
  approve: (e) => T.event.approve(list(e.detail.soNumbers), e.detail.edited === true),
  reject: (e) => T.event.reject(str(e.detail.note)),
  ingest: () => T.event.ingest,
};
const eventText = (e: AuditRow) => EVENT_TEXT[e.kind]?.(e) ?? AUDIT.kinds[e.kind as keyof typeof AUDIT.kinds] ?? e.kind;
const QUIET_EVENTS = new Set(["model_call"]);

/** One timeline of everything that happened to the email, from the hash-chained audit log. */
function Trail({ d }: { d: TriageDetail }) {
  return (
    <ol className="hp-timeline">
      {d.audit.filter((e) => !QUIET_EVENTS.has(e.kind)).map((e) => (
        <li key={e.seq}>
          <span className="hp-timeline-at ap-num">{timeOf(e.at)}</span>
          <span className="hp-timeline-main">
            <span dir="auto">{eventText(e)}</span>
            <span className="hp-muted">{e.actorName}</span>
          </span>
          <span className="hp-muted ap-num">{T.event.seq(e.seq)}</span>
        </li>
      ))}
    </ol>
  );
}

export function InboxReview({ id, onBack, onAsk }: { id: string; onBack: () => void; onAsk: (text: string) => void }) {
  const [d, setD] = useState<TriageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [checked, setChecked] = useState<Checked[]>([]);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api<TriageDetail>(API.inboxItem(id));
      setD(r); setProposals(r.item.proposals); setChecked(r.item.checked); setReply(r.item.reply ?? ""); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [id]);
  useEffect(() => { void load(); return () => { if (debounce.current) clearTimeout(debounce.current); }; }, [load]);
  // The queue polls; when this email's record changes there (the agent filed it, someone decided), read it again.
  const changedAt = useInbox().data?.items.find((x) => x.id === id)?.updatedAt;
  useEffect(() => { if (changedAt && d && changedAt !== d.item.updatedAt) void load(); }, [changedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (i: number, p: Proposal) => {
    const next = proposals.map((x, j) => (j === i ? p : x));
    setProposals(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const n = ++latest.current;
      try {
        const r = await api<{ checked: Checked[] }>(API.inboxCheck(id), { method: "POST", json: { proposals: next } });
        if (n === latest.current) setChecked(r.checked);
      } catch (err) { setFailed(err instanceof Error ? err.message : String(err)); }
    }, INBOX_POLL.checkDebounceMs);
  };

  const decide = async (decision: "approve" | "reject") => {
    if (!d) return;
    setBusy(true); setFailed(null);
    const changed = JSON.stringify(proposals) !== JSON.stringify(d.item.proposals);
    try {
      await api(API.inboxItem(id), { method: "POST", json: { decision, ...(changed ? { proposals } : {}), ...(reply !== (d.item.reply ?? "") ? { reply } : {}), ...(note.trim() ? { note: note.trim() } : {}) } });
      await Promise.all([load(), refreshInbox()]);
    } catch (err) { setFailed(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  if (error) return <Notice tone="bad" onRetry={() => void load()}>{error}</Notice>;
  if (!d) return <div className="hp-review"><Skeleton rows={6} height={48} label={T.checking} /></div>;
  const t = d.item;
  const stops = issuesOf(checked).filter((x) => x.severity !== "warn");
  const blocked = stops.length > 0;
  const creditStop = stops.some((x) => x.severity === "credit");
  const outcome = t.decision ? `${STATE_LABEL[t.decision.outcome]}${t.decision.edited ? ` (${T.edited})` : ""}` : "";

  return (
    <motion.div className="hp-review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d3, ease: EASE }}>
      <div className="hp-review-bar">
        <Button tone="ghost" icon={<IArrowLeft size={15} />} onClick={onBack}>{T.back}</Button>
        <span className="hp-mono">{t.id}</span>
        {t.kind && <Badge>{KIND_LABEL[t.kind]}</Badge>}
        <Status tone={STATE_TONE[t.state]} live={t.state === "working"}>{STATE_LABEL[t.state]}</Status>
        <span className="hp-grow" />
        <Button tone="ghost" icon={<IChat size={15} />} onClick={() => onAsk(T.askText(t.id, t.subject))}>{T.ask}</Button>
      </div>

      <h1 className="hp-review-subject" dir="auto">{t.subject || T.noSubject}</h1>

      <div className="hp-review-grid">
        <article className="hp-email" aria-label={T.email}>
          <header className="hp-email-head">
            <span className="hp-email-avatar" aria-hidden>{initialsOf(t.fromName)}</span>
            <span className="hp-email-from">
              <strong dir="auto">{t.fromName}</strong>
              <span className="hp-review-addr">{t.fromEmail}</span>
            </span>
            <span className="hp-email-when">
              <span>{stampOf(t.receivedAt)}</span>
              <span>{attachmentsOf(d.email?.attachments)}</span>
            </span>
          </header>
          <pre className="hp-email-body" dir="auto">{d.email?.body}</pre>
        </article>

        <div className="hp-decision" aria-label={T.decision}>
          {t.summary && <h2 className="hp-finding" dir="auto">{t.summary}</h2>}
          {t.state === "failed" && <Notice tone="bad">{T.failed}: {t.error}</Notice>}
          {t.released && <Notice tone="good">{T.releasedBy(t.released.soNumbers.join(", "))} · {T.audit(t.released.auditSeq)}</Notice>}
          {t.state === "closed" && <Notice tone="info">{T.closedBy}</Notice>}
          {t.mergedInto && <Notice tone="info">{T.mergedInto(t.mergedInto)}</Notice>}
          {t.decision && <Notice tone={t.decision.outcome === "approved" ? "good" : "warn"}>{T.decided(outcome, t.decidedByName ?? t.decision.by, stampOf(t.decision.at))}{t.decision.soNumbers.length ? ` · ${t.decision.soNumbers.join(", ")}` : ""} · {T.audit(t.decision.auditSeq)}{t.decision.note ? ` · ${t.decision.note}` : ""}</Notice>}

          {!!t.reasons.length && <div><h3>{T.why}</h3><ul className="hp-reasons">{t.reasons.map((r, i) => <li key={`${i}-${r.slice(0, 12)}`} dir="auto">{r}</li>)}</ul></div>}
          {t.nextStep && <div><h3>{T.next}</h3><Text>{t.nextStep}</Text></div>}
          {!!t.flags.length && <div><h3>{T.flags}</h3><ul className="hp-issues">{t.flags.map((f) => <li key={f}><Badge tone={f === "prompt_injection" || f === "urgent" ? "bad" : "warn"}>{FLAG_LABEL[f]}</Badge><span>{FLAG_TEXT[f]}</span></li>)}</ul></div>}
          {!!t.related.length && <span className="hp-muted">{T.related}: {t.related.join(", ")}</span>}

          {!t.kind && t.state !== "failed" && <State icon={<IInfo size={16} />} title={t.state === "working" ? T.untriaged.working : T.untriaged.title} body={T.untriaged.body} />}

          {t.kind && <div>
            <h3>{T.proposals}</h3>
            {t.canDecide && proposals.length > 0 && <span className="hp-muted">{T.editHint}</span>}
            {proposals.length ? proposals.map((p, i) => <ProposalView key={`${i}-${p.action}`} p={p} c={checked[i]} edit={t.canDecide} onEdit={(np) => edit(i, np)} />) : <Text tone="muted">{T.noProposal}</Text>}
          </div>}

          {(t.reply || t.canDecide) && (
            <div>
              <h3>{T.reply}</h3>
              <span className="hp-muted">{T.replyHint}</span>
              <TextArea rows={reply ? 7 : 3} value={reply} onChange={setReply} readOnly={!t.canDecide} placeholder={T.replyPlaceholder} />
            </div>
          )}

          {t.state === "needs_review" && (t.canDecide ? (
            <div className="hp-decide">
              <TextInput value={note} onChange={setNote} placeholder={T.notePlaceholder} aria-label={T.note} maxLength={500} />
              {failed && <Notice tone="bad">{failed}</Notice>}
              {blocked && <span className="hp-muted" data-tone="bad">{creditStop ? T.creditBlocked : T.blocked}</span>}
              <div className="hp-decide-actions">
                <Button tone="danger" icon={<IClose size={14} />} disabled={busy} onClick={() => decide("reject")}>{T.reject}</Button>
                <Button tone="primary" icon={<ICheck size={14} />} disabled={busy || blocked} onClick={() => decide("approve")}>{busy ? T.deciding : approveLabel(proposals)}</Button>
              </div>
            </div>
          ) : <Notice tone="info">{T.readOnly(t.whyNot ?? "")}</Notice>)}
        </div>
      </div>

      {d.audit.length > 0 && (
        <section className="hp-trail-wrap" aria-label={T.trail}>
          <h2 className="hp-trail-title">{T.trail}</h2>
          <Trail d={d} />
        </section>
      )}
    </motion.div>
  );
}
