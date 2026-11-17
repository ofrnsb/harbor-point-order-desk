"use client";
// Reusable home sections. Each one draws from the same panel data, handles its own loading and error state, and
// renders nothing when it has no data. Compose them in Stage.tsx (or list them in `ui.home`) to suit the product.
import { CAP } from "@/config/ui";
import { HOME } from "@/copy/ui-home";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Signature } from "@/domain/Signature";
import { ui } from "@/domain/ui";
import type { Item, PanelData } from "@/lib/types";
import { Badge, Bars, type Selection } from "./blocks/Blocks";
import { money } from "./format";
import { attentionFirst, byDay, byStatus } from "./home-data";
import {
  IAlert,
  IArrowRight,
  IBox,
  ICalendar,
  IChart,
  IChevronLeft,
  IChevronRight,
  IColumns,
  IDoc,
  IPin,
  IReturn,
  ISearch,
  IShield,
  IStar,
  IUsers,
  IWallet,
} from "./icons";
import { D, EASE } from "./motion";
import { uiHomeVisual } from "./ui-options";

/** Icon names a domain can use for its capability starters in src/domain/ui.ts. */
export const ICONS = {
  track: IBox,
  return: IReturn,
  compare: IColumns,
  metrics: IChart,
  calendar: ICalendar,
  users: IUsers,
  search: ISearch,
  star: IStar,
  shield: IShield,
  doc: IDoc,
  pin: IPin,
  wallet: IWallet,
} as const;

export type SectionProps = {
  panel: PanelData | null;
  error: string | null;
  onRefresh: () => void;
  onOpenPanel: () => void;
  onAsk: (t: string) => void;
  onSelect: (s: Selection) => void;
};

/** How many records the compact sections show before View all. */
const ROWS = CAP.homeRows;
const BOARD_COLUMNS = CAP.boardColumns;
const BOARD_CARDS = CAP.boardCards;
const AGENDA_ROWS = CAP.agendaRows;

const slide = {
  enter: (d: number) => ({ opacity: 0, x: 10 * d }),
  center: { opacity: 1, x: 0, transition: { duration: D.d2, ease: EASE } },
  exit: (d: number) => ({ opacity: 0, x: -10 * d, transition: { duration: D.d1, ease: EASE } }),
};

const titleOf = (panel: PanelData | null) => panel?.title || ui.panelTitle || HOME.upNext;
const select = (p: SectionProps, it: Item) => p.onSelect({ type: "item", item: it });

function Head({ title, count, onAll, children }: { title: string; count?: number; onAll?: () => void; children?: React.ReactNode }) {
  return (
    <div className="ap-sec-head">
      <span dir="auto">{title}</span>
      {children}
      {onAll && count !== undefined && (
        <button type="button" className="ap-stage-all" onClick={onAll}>
          {HOME.viewAll(count)}
        </button>
      )}
    </div>
  );
}

/** Loading skeleton or inline error for a data section; null once the panel has loaded. */
function Pending({ p, title, rows = CAP.homeRows }: { p: SectionProps; title: string; rows?: number }) {
  if (p.error && !p.panel) {
    return (
      <div className="ap-sec-surface ap-sec-state" role="alert">
        <IAlert size={16} />
        <span>{HOME.couldNotLoad(title)}</span>
        <button type="button" onClick={p.onRefresh}>
          {HOME.retry}
        </button>
      </div>
    );
  }
  if (!p.panel) {
    return (
      <div className="ap-sec-surface" aria-busy="true" aria-label={HOME.loading(title)}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="ap-next-skel" style={{ opacity: 1 - i * 0.2 }}>
            <span className="ap-skel" style={{ width: `${62 - i * 8}%`, height: 13 }} />
            <span className="ap-skel" style={{ width: "34%", height: 11 }} />
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function Greeting() {
  return (
    <h2 className="ap-home-greet" dir="auto">
      {ui.greeting}
    </h2>
  );
}

function Row({ it, p, active, onPreview }: { it: Item; p: SectionProps; active?: boolean; onPreview?: () => void }) {
  return (
    <button
      type="button"
      className="ap-next-row"
      data-tone={it.status?.tone ?? "neutral"}
      data-active={active}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      onClick={() => select(p, it)}
    >
      <span className="ap-next-main">
        <strong dir="auto">{it.title}</strong>
        {it.subtitle && <small dir="auto">{it.subtitle}</small>}
      </span>
      <span className="ap-next-side">
        {it.price && <span className="ap-num">{money(it.price)}</span>}
        {it.status && <Badge tone={it.status.tone}>{it.status.label}</Badge>}
      </span>
      <IChevronRight size={15} className="ap-next-arrow" />
    </button>
  );
}

/** One record at a time, large: its signature on the left, status, facts and actions on the right, paged with arrows. */
export function Spotlight(p: SectionProps) {
  const title = titleOf(p.panel);
  const ordered = useMemo(() => attentionFirst(p.panel?.items ?? []), [p.panel]);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const pending = Pending({ p, title, rows: 2 });
  if (pending) return <section className="ap-sec">{pending}</section>;
  if (!ordered.length) return null;
  const n = ordered.length;
  const i = index % n;
  const it = ordered[i];
  const step = (d: number) => {
    setDir(d);
    setIndex((i + d + n) % n);
  };
  return (
    <section
      className="ap-sec ap-spot"
      data-tone={it.status?.tone}
      aria-roledescription={HOME.carousel}
      aria-label={title}
      onKeyDown={(e) => {
        if (n < 2) return;
        if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <Head title={title} count={n} onAll={n > 1 ? p.onOpenPanel : undefined}>
        {n > 1 && (
          <span className="ap-spot-nav">
            <span className="ap-spot-pos ap-num" aria-live="polite">
              {HOME.position(i + 1, n)}
            </span>
            <button type="button" className="ap-icon-btn ap-icon-btn-sm" aria-label={HOME.previous} onClick={() => step(-1)}>
              <IChevronLeft size={15} />
            </button>
            <button type="button" className="ap-icon-btn ap-icon-btn-sm" aria-label={HOME.next} onClick={() => step(1)}>
              <IChevronRight size={15} />
            </button>
          </span>
        )}
      </Head>
      <div className="ap-sec-surface ap-spot-card">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={it.id}
            className="ap-spot-body"
            data-has-visual={Boolean(it.visual)}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {it.visual && (
              <div className="ap-spot-visual">
                <Signature visual={it.visual} />
              </div>
            )}
            <div className="ap-spot-main">
              <div className="ap-spot-top">
                {it.status && <Badge tone={it.status.tone}>{it.status.label}</Badge>}
                {it.meta && <span className="ap-spot-meta">{it.meta}</span>}
                {it.price && <span className="ap-price ap-num ap-spot-price">{money(it.price)}</span>}
              </div>
              <h3 dir="auto">{it.title}</h3>
              {it.subtitle && <p dir="auto">{it.subtitle}</p>}
              {it.fields.length > 0 && (
                <dl className="ap-facts ap-spot-facts ap-num">
                  {it.fields.slice(0, CAP.homeFields).map((f, fi) => (
                    <div key={`${fi}-${f.label}`}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="ap-spot-actions">
                {it.action && (
                  <button type="button" className="ap-btn ap-btn-solid" onClick={() => p.onAsk(it.action!.message)}>
                    <span>{it.action.label}</span>
                    <IArrowRight size={14} />
                  </button>
                )}
                <button type="button" className="ap-btn ap-btn-soft" onClick={() => select(p, it)}>
                  {HOME.details}
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

/** The highlighted record's signature beside (compact objects) or above (long objects) up to three compact rows. */
export function Records(p: SectionProps) {
  const title = titleOf(p.panel);
  const items = p.panel?.items ?? [];
  const shown = items.slice(0, ROWS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const withVisual = shown.filter((it) => it.visual);
  const featured = withVisual.find((it) => it.id === activeId) ?? withVisual[0] ?? null;
  const visual = uiHomeVisual;
  const pending = Pending({ p, title });
  if (pending) {
    return (
      <section className="ap-sec">
        <Head title={title} />
        {pending}
      </section>
    );
  }
  if (!items.length) return null;
  const head = <Head title={title} count={items.length} onAll={items.length > ROWS ? p.onOpenPanel : undefined} />;
  return (
    <section className="ap-sec">
      <div className="ap-next-body" data-has-visual={Boolean(featured)} data-visual={visual}>
        {featured?.visual && (
          <div className="ap-next-visual">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={featured.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: D.d1, ease: EASE } }}
                transition={{ duration: D.d2, ease: EASE }}
              >
                <Signature visual={featured.visual} />
              </motion.div>
            </AnimatePresence>
          </div>
        )}
        <div className="ap-next-col">
          {head}
          <div className="ap-sec-surface">
            {shown.map((it) => (
              <Row
                key={it.id}
                it={it}
                p={p}
                active={featured?.id === it.id}
                onPreview={() => it.visual && setActiveId(it.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Columns by status, for queues and pipelines: up to four columns of three cards, the rest behind View all. */
export function Board(p: SectionProps) {
  const title = titleOf(p.panel);
  const columns = useMemo(() => byStatus(p.panel?.items ?? []).slice(0, BOARD_COLUMNS), [p.panel]);
  const pending = Pending({ p, title });
  if (pending) {
    return (
      <section className="ap-sec">
        <Head title={title} />
        {pending}
      </section>
    );
  }
  if (!columns.length) return null;
  const total = p.panel?.items.length ?? 0;
  return (
    <section className="ap-sec">
      <Head title={title} count={total} onAll={p.onOpenPanel} />
      <div className="ap-board" style={{ "--ap-board-cols": columns.length } as React.CSSProperties}>
        {columns.map((col) => (
          <div key={col.label} className="ap-board-col" data-tone={col.tone}>
            <div className="ap-board-col-head">
              <Badge tone={col.tone}>{col.label}</Badge>
              <span className="ap-num">{col.items.length}</span>
            </div>
            {col.items.slice(0, BOARD_CARDS).map((it) => (
              <button key={it.id} type="button" className="ap-board-card" onClick={() => select(p, it)}>
                <strong dir="auto">{it.title}</strong>
                {it.subtitle && <small dir="auto">{it.subtitle}</small>}
                {it.price && <span className="ap-num">{money(it.price)}</span>}
              </button>
            ))}
            {col.items.length > BOARD_CARDS && (
              <button type="button" className="ap-board-more" onClick={p.onOpenPanel}>
                {HOME.more(col.items.length - BOARD_CARDS)}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Time-ordered records from today on, grouped by day: appointments, departures, deliveries, deadlines. */
export function Agenda(p: SectionProps) {
  const title = titleOf(p.panel);
  const days = useMemo(() => byDay(p.panel?.items ?? []), [p.panel]);
  const pending = Pending({ p, title });
  if (pending) {
    return (
      <section className="ap-sec">
        <Head title={title} />
        {pending}
      </section>
    );
  }
  if (!days.length) return null;
  let left = AGENDA_ROWS;
  const total = days.reduce((n, d) => n + d.items.length, 0);
  return (
    <section className="ap-sec">
      <Head title={title} count={total} onAll={total > AGENDA_ROWS ? p.onOpenPanel : undefined} />
      <div className="ap-sec-surface ap-agenda">
        {days.map((d) => {
          if (left <= 0) return null;
          const rows = d.items.slice(0, left);
          left -= rows.length;
          return (
            <div key={d.key} className="ap-agenda-day">
              <div className="ap-agenda-label" suppressHydrationWarning>
                {d.label}
              </div>
              {rows.map((it) => (
                <button key={it.id} type="button" className="ap-agenda-row" data-tone={it.status?.tone ?? "neutral"} onClick={() => select(p, it)}>
                  <time className="ap-agenda-time ap-num" dateTime={it.at} suppressHydrationWarning>
                    {new Date(it.at!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </time>
                  <span className="ap-next-main">
                    <strong dir="auto">{it.title}</strong>
                    {it.subtitle && <small dir="auto">{it.subtitle}</small>}
                  </span>
                  {it.status && <Badge tone={it.status.tone}>{it.status.label}</Badge>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Up to four key figures from `panel().metrics`: balances, SLAs, spend, open cases. */
export function KeyFigures(p: SectionProps) {
  const metrics = p.panel?.metrics ?? [];
  if (!p.panel) {
    return (
      <section className="ap-sec ap-kpis" aria-busy="true" aria-label={HOME.loadingFigures}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="ap-kpi">
            <span className="ap-skel" style={{ width: "50%", height: 11 }} />
            <span className="ap-skel" style={{ width: "70%", height: 22 }} />
          </div>
        ))}
      </section>
    );
  }
  if (!metrics.length) return null;
  const shown = metrics.slice(0, CAP.homeMetrics);
  return (
    <section className="ap-sec ap-kpis" style={{ "--ap-kpi-cols": shown.length } as React.CSSProperties}>
      {shown.map((m, mi) => (
        <div key={`${mi}-${m.label}`} className="ap-kpi">
          <span className="ap-kpi-label">{m.label}</span>
          <strong className="ap-num" data-tone={m.tone ?? "neutral"}>
            {m.value}
          </strong>
          {m.delta && <em className="ap-metric-delta">{m.delta}</em>}
          {m.series && m.series.length > 1 && <Bars series={m.series} />}
        </div>
      ))}
    </section>
  );
}

/** The capability starters: equal-width pills spanning the composer's width, or a two-column grid of cards with a line each. */
export function Suggestions({ onAsk, variant = "pills" }: { onAsk: (t: string) => void; variant?: "pills" | "cards" }) {
  if (!ui.capabilities.length) return null;
  return (
    <div
      className={variant === "cards" ? "ap-sugg-cards" : "ap-intents"}
      aria-label={HOME.suggestions}
      style={{ "--ap-intents": Math.min(ui.capabilities.length, 4) } as React.CSSProperties}
    >
      {ui.capabilities.map((c, i) => {
        const Icon = ICONS[c.icon];
        return (
          <motion.button
            key={`${i}-${c.title}`}
            type="button"
            className={variant === "cards" ? "ap-sugg-card" : "ap-intent"}
            title={c.line}
            onClick={() => onAsk(c.send)}
            whileHover={{ y: -1.5, transition: { duration: D.d2, ease: EASE } }}
            whileTap={{ scale: 0.98, transition: { duration: D.d1, ease: EASE } }}
            {...(i === 0 ? { "data-guard": "clickable", "data-guard-label": HOME.capabilityGuard } : {})}
          >
            <Icon size={variant === "cards" ? 17 : 15} className="ap-intent-ico" />
            {variant === "cards" ? (
              <span className="ap-sugg-text">
                <strong>{c.title}</strong>
                <span>{c.line}</span>
              </span>
            ) : (
              <span className="ap-intent-label">{c.title}</span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
