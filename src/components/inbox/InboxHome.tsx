"use client";
// The Order Desk's home: today's inbox as a queue, what the agent decided on each email, and the agent's run. Opening an
// email shows the review screen in its place; the composer below stays for asking the agent anything.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DESKS, INBOX_PAGE, OPEN_STATES, type DeskId } from "@/config/orders";
import { API } from "@/config/routes";
import { INBOX as T, KIND_LABEL, STATE_LABEL } from "@/copy/orders";
import { moneyText } from "@/lib/values";
import { Badge, Button, Notice, Segmented, Status, Text } from "../ui";
import { State } from "../ui/state";
import { UI } from "@/copy/ui-common";
import { numFmt } from "@/config/locale";
import { Skeleton } from "../ui/skeleton";
import { IAlert, ICheck, IChevronLeft, IChevronRight, IInfo, IRefresh } from "../icons";
import { D, EASE, stagger } from "../motion";
import { api } from "../sp/client";
import { byPriority, dueOf, dueText, FILTERS, issuesOf, SEVERITY_TONE, STATE_TONE, dayOf, timeOf, valueOf, type FilterKey } from "./format";
import { openEmail, refreshInbox, useInbox } from "./store";
import { InboxReview } from "./InboxReview";
import { AddData, sendUpload, UploadReport, type Upload } from "./AddData";
import type { TriageView } from "@/domain/orders/views";
import "./inbox.css";

type DeskFilter = DeskId | "all";

/** The days the inbox spans, as one day or a range. */
function daysOf(items: TriageView[]): string {
  const days = items.map((t) => dayOf(t.receivedAt));
  const [first, last] = [days[0], days[days.length - 1]];
  return first === last ? first : T.dayRange(first, last);
}

function RunControl({ todo }: { todo: number }) {
  const { data } = useInbox();
  const [error, setError] = useState<string | null>(null);
  const run = data?.run;
  if (run?.running) return <Status tone="info" live>{T.running(run.done, run.total)}</Status>;
  if (!data?.canRun || !todo) return null;
  const start = async () => {
    setError(null);
    try { await api(API.inboxRun, { method: "POST" }); await refreshInbox(); }
    catch (err) { setError(err instanceof Error ? err.message : T.runFailed); }
  };
  return (
    <div className="hp-run">
      <Button tone="primary" icon={<IRefresh size={15} />} onClick={start}>{T.run(todo)}</Button>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / INBOX_PAGE);
  if (pages <= 1) return null;
  const nf = numFmt();
  return (
    <nav className="sp-ui-pager" aria-label={UI.pages}>
      <span className="ap-num">{UI.range(nf.format(page * INBOX_PAGE + 1), nf.format(Math.min(total, (page + 1) * INBOX_PAGE)), nf.format(total))}</span>
      <Button tone="ghost" icon={<IChevronLeft size={16} />} aria-label={UI.prev} disabled={page === 0} onClick={() => onPage(page - 1)} />
      <span className="ap-num">{UI.page(page + 1, pages)}</span>
      <Button tone="ghost" icon={<IChevronRight size={16} />} aria-label={UI.next} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} />
    </nav>
  );
}

/** What an empty filter means, and the one way forward: the filter that has emails, or every desk. */
function EmptyQueue({ filter, desk, counts, running, onFilter, onAllDesks }: { filter: FilterKey; desk: DeskFilter; counts: Record<FilterKey, number>; running: boolean; onFilter: (f: FilterKey) => void; onAllDesks: () => void }) {
  if (desk !== "all" && counts[filter] > 0) {
    const copy = T.empty.desk(T.desks[desk]);
    return <State icon={<IInfo size={16} />} title={copy.title} body={copy.body} action={{ label: T.desks.all, onClick: onAllDesks }} />;
  }
  if (filter === "review" && counts.pending > 0) {
    const copy = T.empty.untriaged(counts.pending, running);
    return <State icon={<IInfo size={16} />} title={copy.title} body={copy.body} action={{ label: T.showFilter(T.filters.pending, counts.pending), onClick: () => onFilter("pending") }} />;
  }
  const next = (["review", "all"] as const).find((f) => f !== filter && counts[f] > 0);
  const done = filter === "review" || filter === "pending";
  return (
    <State icon={done ? <ICheck size={16} /> : <IInfo size={16} />} title={T.empty[filter].title} body={T.empty[filter].body}
      action={next ? { label: T.showFilter(T.filters[next], counts[next]), onClick: () => onFilter(next) } : undefined} />
  );
}

function QueueRow({ t, i }: { t: TriageView; i: number }) {
  const issues = issuesOf(t.checked);
  const worst = issues.find((x) => x.severity !== "warn") ?? issues[0];
  const value = valueOf(t.checked);
  const due = dueOf(t);
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: D.d2, ease: EASE, delay: stagger(i) } }} exit={{ opacity: 0, transition: { duration: D.d1 } }}>
      <button type="button" className="hp-row" onClick={() => openEmail(t.id)} data-state={t.state}>
        <span className="hp-row-when ap-num">{timeOf(t.receivedAt)}{due && <span className="hp-row-due">{T.due(dueText(due))}</span>}</span>
        <span className="hp-row-id">{t.id}</span>
        <span className="hp-row-main">
          <span className="hp-row-who"><span className="hp-row-name" dir="auto">{t.checked[0]?.customerName ?? t.fromName}</span>{t.flags.includes("urgent") && <Badge tone="bad">{T.urgent}</Badge>}</span>
          <span className="hp-row-what" dir="auto">{t.summary || t.subject}</span>
        </span>
        <span className="hp-row-kind">{t.kind ? <Badge>{KIND_LABEL[t.kind]}</Badge> : null}</span>
        <span className="hp-row-checks">{worst ? <Badge tone={SEVERITY_TONE[worst.severity]} title={issues.map((x) => x.message).join("\n")}>{T.issues(issues.length)}</Badge> : t.proposals.length ? <span className="hp-muted">{T.noIssues}</span> : null}</span>
        <span className="hp-row-value ap-num">{value ? moneyText(value) : ""}</span>
        <span className="hp-row-state"><Status tone={STATE_TONE[t.state]} live={t.state === "working"}>{STATE_LABEL[t.state]}</Status></span>
      </button>
    </motion.li>
  );
}

export function InboxHome({ onAsk }: { onAsk: (text: string) => void }) {
  const { data, error, openId } = useInbox();
  const [filter, setFilter] = useState<FilterKey>("review");
  const [desk, setDesk] = useState<DeskFilter>("all");
  const [page, setPage] = useState(0);
  const [upload, setUpload] = useState<Upload | null>(null);
  const apply = async () => {
    if (!upload) return;
    setUpload({ ...upload, busy: true });
    try { setUpload({ ...upload, report: await sendUpload(upload.files, true), busy: false }); }
    catch (err) { setUpload({ ...upload, error: err instanceof Error ? err.message : String(err), busy: false }); }
  };
  const items = data?.items ?? [];
  const counts = useMemo(() => Object.fromEntries(Object.entries(FILTERS).map(([k, states]) => [k, states ? items.filter((t) => (states as readonly string[]).includes(t.state)).length : items.length])) as Record<FilterKey, number>, [items]);
  const prioritized = filter === "review";
  const shown = useMemo(() => {
    const picked = items.filter((t) => (FILTERS[filter] ? (FILTERS[filter] as readonly string[]).includes(t.state) : true) && (desk === "all" || t.desk === desk));
    return prioritized ? [...picked].sort(byPriority) : picked;
  }, [items, filter, desk, prioritized]);
  const open = items.find((t) => t.id === openId);
  useEffect(() => setPage(0), [filter, desk]);
  // A decision can empty the last page; step back to the page that still has rows.
  useEffect(() => { if (page > 0 && page * INBOX_PAGE >= shown.length) setPage(Math.max(0, Math.ceil(shown.length / INBOX_PAGE) - 1)); }, [page, shown.length]);

  if (!data && error) return <Notice tone="bad" onRetry={() => void refreshInbox()}>{T.loadFailed}: {error}</Notice>;
  if (!data) return <div className="hp-home"><Skeleton rows={8} height={56} label={T.loadFailed} /></div>;
  if (open) return <InboxReview key={open.id} id={open.id} onBack={() => openEmail(null)} onAsk={onAsk} />;

  const waiting = items.filter((t) => OPEN_STATES.includes(t.state)).length;
  const todo = items.filter((t) => t.state === "queued" || t.state === "failed").length;
  return (
    <div className="hp-home">
      <header className="hp-head">
        <div>
          <h1 className="hp-headline">{T.headline(waiting, todo)}</h1>
          {items[0] && <Text tone="muted">{T.sub(items.length, daysOf(items))}</Text>}
        </div>
        <div className="hp-head-actions">
          {data.canRun && <AddData onUpload={setUpload} />}
          <RunControl todo={todo} />
        </div>
      </header>
      {upload && <UploadReport u={upload} onApply={() => void apply()} onClose={() => setUpload(null)} />}
      {error && <Notice tone="warn" onRetry={() => void refreshInbox()}><IAlert size={14} /> {error}</Notice>}
      <div className="hp-filters">
        <Segmented label={T.filters.all} value={filter} onChange={setFilter} options={(Object.keys(FILTERS) as FilterKey[]).map((k) => ({ value: k, label: `${T.filters[k]} ${counts[k]}` }))} />
        <Segmented label={T.desks.all} value={desk} onChange={setDesk} options={(["all", DESKS.orderDesk, DESKS.creditControl] as const).map((d) => ({ value: d, label: T.desks[d] }))} />
      </div>
      {shown.length ? (
        <div className="hp-queue">
          <p className="hp-queue-caption">{prioritized ? T.sortedByPriority : T.sortedByArrival}</p>
          <ul className="hp-queue-list" aria-label={T.filters[filter]}>
            <AnimatePresence initial={false} mode="popLayout">{shown.slice(page * INBOX_PAGE, (page + 1) * INBOX_PAGE).map((t, i) => <QueueRow key={t.id} t={t} i={i} />)}</AnimatePresence>
          </ul>
          <Pager page={page} total={shown.length} onPage={setPage} />
        </div>
      ) : (
        <div className="hp-queue"><EmptyQueue filter={filter} desk={desk} counts={counts} running={data.run.running} onFilter={setFilter} onAllDesks={() => setDesk("all")} /></div>
      )}
    </div>
  );
}
