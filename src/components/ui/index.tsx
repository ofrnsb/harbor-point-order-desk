"use client";
// The primitives everything on screen is composed from: title, text, button, badge, figure, meter, table, list,
// chart, and the layout pieces that place them. The platform's pages and the agent's answers (bata.ts maps each brick
// to one of these) arrange the same parts, so nothing styles itself twice. Composition belongs to whoever arranges
// them; every size belongs to ui.css tokens: one row height, one width per kind of column, long data paged in a table
// or scrolled in a list, never stretching the layout.
import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { IAlert, IArrowDown, IArrowUp, ICheck, IChevronLeft, IChevronRight, IInfo } from "@/components/icons";
import { Amount } from "./amount";
import { barPath, niceTicks, smoothPath } from "./curve";
import { D, EASE } from "../motion";
import { UI } from "@/copy/ui-common";
import { LOCALE, numFmt } from "@/config/locale";

// Form controls are primitives too.
export { Field, Filter, ListState, MultiPick, Notice, NumberInput, Reveal, SaveBar, Segmented, Select, Sheet, Switch, TextArea, TextInput, useApi, useMutation } from "@/components/sp/admin/kit";

export type Tone = "neutral" | "info" | "good" | "warn" | "bad";
/** Sensitivity as a tone, the same on every screen: public good, internal info, confidential warn, restricted bad. */
export const SENS_TONE: Record<"public" | "internal" | "confidential" | "restricted", Tone> = { public: "good", internal: "info", confidential: "warn", restricted: "bad" };
const nf = { format: (v: number) => numFmt().format(v) };
type Gap = "none" | "s" | "m" | "l";
type Align = "start" | "center" | "end" | "between" | "stretch";

// ---------- Text ----------

/** A heading: 1 for a screen, 2 for a section, 3 for a group inside one. */
export function Title({ level = 2, children, id }: { level?: 1 | 2 | 3; children: ReactNode; id?: string }) {
  const T = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
  return <T className="sp-ui-title" data-level={level} id={id} dir="auto">{children}</T>;
}

/** Words. `truncate` keeps them to one line with the whole text in the tooltip. */
export function Text({ size = "m", tone = "default", strong, mono, truncate, children, title }: {
  size?: "s" | "m" | "l"; tone?: "default" | "muted" | "accent" | "good" | "warn" | "bad"; strong?: boolean; mono?: boolean; truncate?: boolean; children: ReactNode; title?: string;
}) {
  return <div className="sp-ui-text" data-size={size} data-tone={tone} data-strong={strong || undefined} data-mono={mono || undefined} data-truncate={truncate || undefined} dir="auto"
    title={title ?? (truncate && typeof children === "string" ? children : undefined)}>{children}</div>;
}

/** A small quiet line: a field's name, a count, a time. */
export const Label = ({ children, truncate }: { children: ReactNode; truncate?: boolean }) => <Text size="s" tone="muted" truncate={truncate}>{children}</Text>;

/** A boxed remark in a tone: a warning, a caveat, the one thing to know. */
const CALLOUT_ICON: Record<Tone, ReactNode> = { info: <IInfo size={18} />, neutral: <IInfo size={18} />, good: <ICheck size={18} />, warn: <IAlert size={18} />, bad: <IAlert size={18} /> };
export function Callout({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  return (
    <div className="sp-ui-callout" data-tone={tone} role="note">
      <span className="sp-ui-callout-mark" aria-hidden>{CALLOUT_ICON[tone]}</span>
      <div className="sp-ui-callout-words">{title && <strong dir="auto">{title}</strong>}<div dir="auto">{children}</div></div>
    </div>
  );
}

// ---------- Marks ----------

/** `collapse`: on a narrow screen only the icon shows; the label stays the button's accessible name. */
export function Button({ tone = "secondary", icon, collapse, count, children, ref, ...p }: { tone?: "primary" | "secondary" | "ghost" | "danger"; icon?: ReactNode; collapse?: boolean; count?: number; children?: ReactNode; ref?: React.Ref<HTMLButtonElement> } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const label = collapse && typeof children === "string" ? children : undefined;
  return (
    <button ref={ref} type="button" className="sp-ui-btn" data-tone={tone} data-icon-only={!children || undefined} aria-label={p["aria-label"] ?? label} {...p}>
      {icon}{collapse && children ? <span className="sp-ui-btn-label">{children}</span> : children}
      {!!count && <span className="sp-ui-btn-count ap-num">{nf.format(count)}</span>}
    </button>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className="sp-ui-badge" data-tone={tone} title={title}>{children}</span>;
}

/** A number with what it is: label above, the figure, a quieter line under (a change, a unit, a source). */
const FIGURE_MIN_PX = 14, FIGURE_GAP_PX = 10;

/** A fact beside other facts: its name over its value, a step below a Figure. */
export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div className="sp-ui-stat"><span dir="auto">{label}</span><strong className="ap-num">{typeof value === "string" ? <Amount text={value} roll /> : value}</strong></div>;
}
export type Delta = { text: string; tone: Tone; dir: "up" | "down" | "flat" };
export function Figure({ label, value, sub, tone, delta }: { label?: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; delta?: Delta }) {
  const box = useRef<HTMLDivElement>(null), num = useRef<HTMLElement>(null), chip = useRef<HTMLSpanElement>(null);
  // A figure is never cut and never runs into its neighbour: when the number is wider than its place, it reads smaller.
  useLayoutEffect(() => {
    const b = box.current, n = num.current;
    if (!b || !n) return;
    const fit = () => {
      n.style.fontSize = ""; n.style.whiteSpace = "";
      const room = b.clientWidth - (chip.current ? chip.current.offsetWidth + FIGURE_GAP_PX : 0), need = n.scrollWidth;
      if (!(room > 0 && need > room)) return;
      const size = Math.floor(parseFloat(getComputedStyle(n).fontSize) * (room / need));
      n.style.fontSize = `${Math.max(FIGURE_MIN_PX, size)}px`;
      // Words, not a number: at the smallest size they still do not fit, so they wrap instead.
      if (size < FIGURE_MIN_PX) n.style.whiteSpace = "normal";
    };
    fit();
    // The box can change (a narrower column) and so can the number (it counts up from zero): either refits it.
    const seen = new ResizeObserver(fit);
    seen.observe(b);
    seen.observe(n);
    // The web font can arrive after the first fit and set the number wider: fit again once it has loaded.
    let live = true;
    void document.fonts?.ready.then(() => { if (live) fit(); });
    return () => { live = false; seen.disconnect(); };
  }, [value]);
  return (
    <div ref={box} className="sp-ui-figure" data-tone={tone}>
      {label !== undefined && label !== "" && <span>{label}</span>}
      <div className="sp-ui-figure-line" data-delta={delta ? true : undefined}>
        <strong ref={num} className="ap-num">{typeof value === "string" ? <Amount text={value} roll /> : value}</strong>
        {delta && <span ref={chip} className="sp-ui-delta" data-tone={delta.tone} data-dir={delta.dir}>{delta.dir !== "flat" && <IArrowUp size={11} />}<span className="ap-num">{delta.text}</span></span>}
      </div>
      {sub !== undefined && sub !== "" && <small>{sub}</small>}
    </div>
  );
}

/** A measure against its whole, as a capsule woven up to the value. `target` (0 to 100, a place on the capsule) pins
 *  a goal; reaching it, or passing the whole, weaves the capsule green. `missing` is a value not in yet: the capsule
 *  reads soft and empty, never as zero. */
export function Meter({ value, max, tone = "info", label, target, missing }: { value: number; max: number; tone?: Tone; label?: string; target?: number; missing?: boolean }) {
  const share = max > 0 ? (value / max) * 100 : 0, pct = Math.max(0, Math.min(100, share));
  const over = !missing && (share > 100 || (target !== undefined && share >= target));
  return (
    <span className="sp-ui-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={missing ? undefined : Math.round(share)} data-over={over || undefined} data-missing={missing || undefined}>
      <i data-tone={tone} style={{ width: `${missing ? 0 : pct}%` }} />
      {target !== undefined && <u aria-hidden style={{ insetInlineStart: `${Math.max(0, Math.min(100, target))}%` }} />}
    </span>
  );
}

/** One whole and its parts, as one capsule of segments in a single hue from light to deep, each part named with its
 *  value beneath. Past six parts the smallest fold into one. */
const PARTS_MAX = 6;
export function Parts({ parts, value, label }: { parts: { label: string; value: number }[]; value: (n: number) => string; label?: string }) {
  const sorted = parts.filter((p) => p.value > 0);
  const shown = sorted.length > PARTS_MAX ? [...sorted.slice(0, PARTS_MAX - 1), { label: UI.others, value: sorted.slice(PARTS_MAX - 1).reduce((a, p) => a + p.value, 0) }] : sorted;
  if (!shown.length) return <Empty>{UI.empty}</Empty>;
  const ink = (i: number) => `color-mix(in oklab, #9dbcff, #13319f ${shown.length > 1 ? Math.round((i / (shown.length - 1)) * 100) : 100}%)`;
  return (
    <div className="sp-ui-parts">
      <div className="sp-ui-parts-bar" role="img" aria-label={label ?? UI.partsAria(shown.map((p) => `${p.label} ${value(p.value)}`).join(", "))}>
        {shown.map((p, i) => <i key={`${i}-${p.label}`} style={{ flexGrow: p.value, background: ink(i), animationDelay: `${i * 90}ms` }} />)}
      </div>
      <dl className="sp-ui-parts-keys">
        {shown.map((p, i) => <div key={`${i}-${p.label}`}><dt dir="auto"><i style={{ background: ink(i) }} />{p.label}</dt><dd className="ap-num">{value(p.value)}</dd></div>)}
      </dl>
    </div>
  );
}

/** A ranked item: its place in serif beside it. */
export const Ranked = ({ at, children }: { at: number; children: ReactNode }) => <div className="sp-ui-ranked"><span className="sp-ui-rank ap-num" aria-hidden>{at}</span><div>{children}</div></div>;

/** A record's state is a knot in its tone, beside the word: a loose loop is still open (warn), a tied knot is in hand
 *  (info, neutral), a double knot is settled (good), a cut thread is stopped (bad). States still in motion tug. */
const KNOT: Record<Tone, string> = {
  warn: "M2 13C2 5 13 3 13 9C13 13 8 13 8 10",
  info: "M1 11C5 11 6 4 9.5 4.5C13 5 12 11 8 10.5C5.5 10 8 7 16 7",
  neutral: "M1 11C5 11 6 4 9.5 4.5C13 5 12 11 8 10.5C5.5 10 8 7 16 7",
  good: "M1 12C4 12 4 5 7 5.5C9.5 6 9 10 7 10C5 10 7 6 10.5 6C13.5 6 13 10.5 11 10.5C9 10.5 11 7 16 7",
  bad: "M1 9C3 9 5 7 6.5 7M10 9C11.5 9 13 11 16 11M6 12L10 4",
};
export function Status({ tone = "neutral", live, children }: { tone?: Tone; live?: boolean; children: ReactNode }) {
  return <span className="sp-ui-status" data-tone={tone} data-live={live || undefined}><svg viewBox="0 0 17 16" aria-hidden><path pathLength={1} d={KNOT[tone]} /></svg>{children}</span>;
}

/** The thread colour of a source system: the same system always has the same colour, on every answer. */
const SOURCE_INKS = 4;
export function sourceInk(system: string): string {
  let h = 0;
  for (const c of system) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--sp-src-${(h % SOURCE_INKS) + 1})`;
}

/** Where an answer's figures came from: each source ("system · object · rows") keyed by its system's thread colour. */
export function Thread({ label, parts }: { label: string; parts: string[] }) {
  if (!parts.length) return null;
  return (
    <p className="sp-ui-thread" aria-label={`${label}: ${parts.join("; ")}`}>
      {parts.map((p, i) => <span key={`${i}-${p}`} dir="auto"><i aria-hidden style={{ background: sourceInk(p.split(" · ")[0]) }} />{p}</span>)}
    </p>
  );
}

/** A tear line, like the perforation between a slip and its stub. */
export const Divider = () => <hr className="sp-ui-divider" />;

// ---------- Layout ----------

export function Stack({ gap = "m", align, children }: { gap?: Gap; align?: Align; children: ReactNode }) {
  return <div className="sp-ui-stack" data-gap={gap} data-align={align}>{children}</div>;
}

/** Side by side. `wrap` lets the row fold on a narrow screen; children that should take the room get `grow`. */
export function Row({ gap = "m", align = "center", wrap = true, children }: { gap?: Gap; align?: Align; wrap?: boolean; children: ReactNode }) {
  // A row that keeps to one line is a grid: one track per part, the Grow parts sharing the room, so parts line up
  // and never collapse into each other. A row that folds (chips, a run of buttons) wraps as inline items do.
  const parts = Children.toArray(children);
  const grid = !wrap || parts.some((c) => isValidElement(c) && c.type === Grow);
  const cols = grid ? parts.map((c) => (isValidElement(c) && c.type === Grow ? "minmax(0, 1fr)" : "auto")).join(" ") : undefined;
  return <div className="sp-ui-row" data-gap={gap} data-align={align} data-wrap={!grid && wrap ? true : undefined} data-grid={grid || undefined} style={cols ? { ["--sp-ui-row-cols" as string]: cols } : undefined}>{children}</div>;
}
/** A child of a Row that takes the room left, shrinking first. */
export const Grow = ({ children }: { children: ReactNode }) => <div className="sp-ui-grow">{children}</div>;

/** Equal columns; children share each row's height. Folds on narrow screens. */
export function Grid({ cols = 2, gap = "m", children }: { cols?: number; gap?: Gap; children: ReactNode }) {
  return <div className="sp-ui-grid" data-gap={gap} style={{ ["--sp-ui-cols" as string]: String(Math.max(1, Math.min(6, cols))) }}>{children}</div>;
}

/** Two columns in a ratio: the main part and what goes beside it. */
export function Split({ ratio = "1:1", children }: { ratio?: "1:1" | "2:1" | "1:2" | "3:2" | "2:3"; children: ReactNode }) {
  const [a, b] = ratio.split(":");
  return <div className="sp-ui-split" style={{ gridTemplateColumns: `minmax(0, ${a}fr) minmax(0, ${b}fr)` }}>{children}</div>;
}

/** A surface that holds one part of a screen. `flush` lets a table or list run edge to edge. `threads` are the source
 *  colours (sourceInk) of what it shows: they run down its edge, one thread per system it was woven from. */
export function Section({ title, note, actions, flush, focus, threads, children, label }: { title?: ReactNode; note?: ReactNode; actions?: ReactNode; flush?: boolean; focus?: boolean; threads?: string[]; children: ReactNode; label?: string }) {
  return (
    <section className="sp-ui-section" data-flush={flush || undefined} data-focus={focus || undefined} data-threads={threads?.length || undefined} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      {!!threads?.length && <span className="sp-ui-selv" aria-hidden>{threads.map((c, i) => <i key={`${i}-${c}`} style={{ background: c }} />)}</span>}
      {(title || note || actions) && (
        <header className="sp-ui-section-head">
          <div>{title && <Title level={2}>{title}</Title>}{note && <Label>{note}</Label>}</div>
          {actions && <Row gap="s" wrap={false}>{actions}</Row>}
        </header>
      )}
      <div className="sp-ui-section-body">{children}</div>
    </section>
  );
}

export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  // The panel comes in from the side of the tab that was picked, so moving along the tabs reads as moving along pages.
  const [[on, dir], setOn] = useState<[number, number]>([0, 0]);
  const id = useId(), still = useReducedMotion();
  return (
    <div className="sp-ui-tabs">
      <div className="sp-ui-tablist" role="tablist">
        {tabs.map((t, i) => (
          <button key={`${i}-${t.label}`} type="button" role="tab" aria-selected={on === i} onClick={() => setOn(([p]) => [i, Math.sign(i - p)])}>
            {on === i && <motion.span layoutId={`${id}-tab`} className="sp-ui-tab-pill" transition={still ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }} />}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <motion.div key={on} role="tabpanel" initial={still ? false : { opacity: 0, x: dir * 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: D.d3, ease: EASE }}>{tabs[on]?.content}</motion.div>
    </div>
  );
}

/** Nothing to show, said plainly. */
export const Empty = ({ children }: { children: ReactNode }) => <div className="sp-ui-empty">{children}</div>;

// ---------- Collections ----------

/** Items one under another, each one row high; past the fixed height the rest scrolls inside. A row that opens
 * something (`href` or `onPick`) is itself the link, full width, with one hover and focus for the whole row. */
export function List<T>({ items, rowKey, render, size = "md", empty, tall, href, onPick }: { items: T[]; rowKey: (t: T, i: number) => string; render: (t: T, i: number) => ReactNode; size?: "s" | "m" | "l" | "md" | "lg" | "sm"; empty?: ReactNode; tall?: boolean; href?: (t: T) => string; onPick?: (t: T) => void }) {
  const ul = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => columns(ul.current));
  if (!items.length) return <Empty>{empty ?? UI.empty}</Empty>;
  const sz = size === "sm" ? "s" : size === "md" ? "m" : size === "lg" ? "l" : size;
  const row = (t: T, i: number) => href ? <a className="sp-ui-list-link" href={href(t)}>{render(t, i)}</a>
    : onPick ? <button type="button" className="sp-ui-list-link" onClick={() => onPick(t)}>{render(t, i)}</button>
    : render(t, i);
  return <ul ref={ul} className="sp-ui-list" data-size={sz} data-tall={tall || undefined} data-links={href || onPick ? true : undefined}>{items.map((t, i) => <li key={rowKey(t, i)}>{row(t, i)}</li>)}</ul>;
}

/** Rows made of the same parts line up as columns: each part gets one track for the whole list. The flexible parts
 *  (a bar, or the first words when there is no bar) share the room; the rest are as wide as their widest cell. */
function columns(ul: HTMLUListElement | null) {
  if (!ul) return;
  const rows = [...ul.children].map((li) => li.querySelector<HTMLElement>(":scope > .sp-ui-row, :scope > .sp-ui-list-link > .sp-ui-row"));
  const n = rows[0]?.children.length ?? 0;
  if (n < 2 || rows.some((r) => !r || r.children.length !== n)) { ul.removeAttribute("data-cols"); ul.style.removeProperty("--sp-ui-list-cols"); return; }
  const parts = [...rows[0]!.children];
  // A part marked to grow takes the room; failing that a bar does (it reads better long), failing that the first part
  // with words (an icon or a button before it keeps its own size).
  let grows = parts.map((c) => c.classList.contains("sp-ui-grow"));
  if (!grows.some(Boolean)) grows = parts.map((c) => c.matches(".sp-ui-barline, .sp-ui-meter") || !!c.querySelector(":scope > .sp-ui-meter"));
  if (!grows.some(Boolean)) {
    const words = parts.findIndex((c) => !c.matches("button, a, .sp-ui-btn, .sp-ui-avatar") && (c.textContent ?? "").trim().length > 0);
    grows[words >= 0 ? words : 0] = true;
  }
  for (const r of rows) [...r!.children].forEach((c, i) => c.setAttribute("data-col", grows[i] ? "grow" : "fit"));
  // Fitted columns give way (down to nothing, ellipsed) before the flexible one drops below a readable width.
  ul.style.setProperty("--sp-ui-list-cols", grows.map((g) => (g ? "minmax(min(7rem, 40%), 1fr)" : "minmax(0, max-content)")).join(" "));
  ul.setAttribute("data-cols", String(n));
}

/** Up to `max` labels as badges and a count of the rest; the whole list in the tooltip. A helper, not a component. */
export function badges(items: string[], o: { tone?: Tone; max?: number; empty?: ReactNode } = {}): ReactNode {
  if (!items.length) return o.empty ?? null;
  const max = o.max ?? 1;
  return (
    <Row gap="s" wrap={false}>
      {items.slice(0, max).map((t, i) => <Badge key={`${i}:${t}`} tone={o.tone} title={items.join("\n")}>{t}</Badge>)}
      {items.length > max && <Badge title={items.join("\n")}>{UI.more(items.length - max)}</Badge>}
    </Row>
  );
}

// ---------- Chart ----------

export type ChartMark = { type: "bar" | "line" | "area" | "point"; label: string };
/** Series inks in a fixed order (validated for colour-blind separation on the paper surface): ink blue, copper, teal, ochre. */
const SERIES = ["var(--sp-series-1)", "var(--sp-series-2)", "var(--sp-series-3)", "var(--sp-series-4)"];
const CH = { w: 640, minW: 240, h: { s: 200, m: 268, l: 348 }, pad: { t: 10, r: 10, b: 30, l: 4 }, bubble: 58, axisLabelMax: 12, axisCharW: 6.8, axisGap: 16, barMax: 24, barGap: 2, radius: 8, points: 60 } as const;
const compact = { format: (v: number) => numFmt({ notation: "compact", maximumFractionDigits: 1 }).format(v) };

/**
 * Bars, lines, areas or points over one axis, read like an instrument: the lead series is lit (a gradient line with a
 * woven wash beneath it, or capsule bars in sunk tracks), its latest point is a raised knob with its readout in a
 * raised bubble, and `note` writes what the chart shows beside the point it is about. Bars start at zero; lines are
 * scaled to their data. Hovering (or arrow keys) reads every series at that point. `points` carry each x label and one
 * value per mark; `value` formats the axis and the readout, `full` the exact figure.
 */
export function Chart({ points, marks, stacked, height = "m", label, empty, note, value = (n) => compact.format(n), full = (n) => n.toLocaleString(LOCALE) }: { points: { x: string; values: number[] }[]; marks: ChartMark[]; stacked?: boolean; height?: "s" | "m" | "l"; label: string; empty?: ReactNode; note?: { at: string; text: string }; value?: (n: number) => string; full?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(CH.w);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useLayoutEffect(() => {
    const el = plot.current;
    if (!el) return;
    const seen = new ResizeObserver(([e]) => setWidth(Math.max(CH.minW, Math.round(e.contentRect.width))));
    seen.observe(el);
    return () => seen.disconnect();
  }, [points.length > 0]);
  const rows = points.slice(0, CH.points);
  if (!rows.length) return <Empty>{empty ?? UI.empty}</Empty>;

  const n = rows.length, W = width, H = CH.h[height];
  const bars = marks.map((m, k) => ({ m, k })).filter((x) => x.m.type === "bar");
  const lines = marks.map((m, k) => ({ m, k })).filter((x) => x.m.type !== "bar");
  const v = (r: (typeof rows)[number], k: number) => r.values[k] || 0;
  // The scale: every bar total and line value, bracketed by round ticks. Bars stand on zero, so zero is in it when
  // there are bars; lines alone are scaled to their own range, where their movement reads.
  const all = rows.flatMap((r) => [
    ...(stacked ? [bars.reduce((a, { k }) => a + Math.max(0, v(r, k)), 0), bars.reduce((a, { k }) => a + Math.min(0, v(r, k)), 0)] : bars.map(({ k }) => v(r, k))),
    ...lines.map(({ k }) => v(r, k)), ...(bars.length ? [0] : []),
  ]);
  const ticks = niceTicks(Math.min(...all), Math.max(...all), height === "s" ? 3 : 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1], span = hi - lo || 1;
  const L = CH.pad.l + Math.max(...ticks.map((t) => value(t).length)) * CH.axisCharW + 10;
  // The top leaves room for the latest value's bubble above its knob.
  const R = CH.pad.r + 12, T = CH.pad.t + CH.bubble, B = CH.pad.b;
  const iw = W - L - R, ih = H - T - B, band = iw / n;
  const y = (val: number) => T + ((hi - val) / span) * ih;
  const cx = (i: number) => L + band * i + band / 2;
  const zero = y(0), base = bars.length ? zero : T + ih;

  // Bars: at most 24px thick, a 2px gap between neighbours and between stacked parts, capsule-rounded at the data end.
  const colW = stacked ? Math.min(CH.barMax, band * 0.62) : Math.min(CH.barMax, Math.max(2, (band * 0.72 - CH.barGap * (bars.length - 1)) / Math.max(1, bars.length)));
  const groupW = stacked ? colW : bars.length * colW + (bars.length - 1) * CH.barGap;
  const rad = Math.min(colW / 2, CH.radius);
  const barShapes = rows.flatMap((r, i) => {
    const x0 = cx(i) - groupW / 2;
    if (!stacked) return bars.map(({ k }, bi) => {
      const val = v(r, k), top = y(Math.max(0, val)), h = Math.abs(y(val) - zero);
      const bx = x0 + bi * (colW + CH.barGap);
      return { i, k, val, x: bx, d: barPath(bx, top, colW, h, rad, val < 0), down: val < 0 };
    });
    const pos = bars.filter(({ k }) => v(r, k) > 0), neg = bars.filter(({ k }) => v(r, k) < 0);
    const stack = (list: typeof bars, down: boolean) => {
      let base = 0;
      return list.map(({ k }, si) => {
        const val = v(r, k), from = base, to = base + val;
        base = to;
        const outer = si === list.length - 1, gap = si > 0 ? CH.barGap : 0;
        const ya = y(Math.max(from, to)), yb = y(Math.min(from, to));
        const h = Math.max(0, yb - ya - gap);
        const top = down ? ya + gap : ya;
        return { i, k, val, x: x0, d: outer ? barPath(x0, top, colW, h, rad, down) : `M${x0},${top}h${colW}v${h}h${-colW}Z`, down };
      });
    };
    return [...stack(pos, false), ...stack(neg, true)];
  });

  // Lines and areas: monotone curves.
  const curves = lines.map(({ m, k }) => {
    const xy = rows.map((r, i) => [cx(i), y(v(r, k))] as const);
    return { m, k, xy, d: smoothPath(xy) };
  });
  // The lead series (the first mark) is the lit one: its latest point is the knob and the bubble reads it first.
  const leadK = marks.findIndex((m) => m.type !== "point");
  const leadCurve = curves.find((c) => c.k === leadK);
  const leadBar = bars.some((b) => b.k === leadK) ? barShapes.filter((b) => b.k === leadK && b.i === n - 1).at(-1) : undefined;
  const knob = leadK < 0 ? null : leadCurve ? { x: leadCurve.xy[n - 1][0], y: leadCurve.xy[n - 1][1] } : leadBar ? { x: leadBar.x + colW / 2, y: y(stacked ? rows[n - 1].values.reduce((a, b, k) => a + (bars.some((x) => x.k === k) ? Math.max(0, b) : 0), 0) : Math.max(0, v(rows[n - 1], leadK))) } : null;
  const noteAt = note ? rows.findIndex((r) => r.x === note.at) : -1;
  const noteXY = noteAt >= 0 ? (leadCurve ? leadCurve.xy[noteAt] : [cx(noteAt), y(Math.max(0, v(rows[noteAt], leadK)))] as const) : null;
  const ink = (k: number, lit: "h" | "v") => (k === leadK ? `url(#${uid}-${lit})` : SERIES[k % SERIES.length]);
  const labelW = Math.min(CH.axisLabelMax, Math.max(...rows.map((r) => r.x.length))) * CH.axisCharW + CH.axisGap;
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / labelW)));
  const tip = hover === null ? null : rows[hover];
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    setHover((h) => Math.max(0, Math.min(n - 1, (h ?? (e.key === "ArrowRight" ? -1 : n)) + (e.key === "ArrowRight" ? 1 : -1))));
  };
  const keyOf = (m: ChartMark, k: number) => <i className="sp-ui-chart-key" data-kind={m.type === "bar" || m.type === "area" ? "fill" : "line"} style={{ ["--sp-key" as string]: SERIES[k % SERIES.length] }} />;

  return (
    <figure className="sp-ui-chart" data-height={height} data-hover={hover !== null || undefined} tabIndex={0} aria-label={label} onKeyDown={move} onBlur={() => setHover(null)} onMouseLeave={() => setHover(null)}>
      {marks.length > 1 && <figcaption className="sp-ui-legend">{marks.map((m, k) => <span key={`${k}-${m.label}`}>{keyOf(m, k)}{m.label}</span>)}</figcaption>}
      <div ref={plot} className="sp-ui-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
          <defs>
            {/* The lit ink of the lead series: light where it starts, deep where it ends (and from the top of a bar down). */}
            <linearGradient id={`${uid}-h`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#8fb2ff" /><stop offset="0.6" stopColor="#2563ff" /><stop offset="1" stopColor="#13319f" /></linearGradient>
            <linearGradient id={`${uid}-v`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4a78ff" /><stop offset="1" stopColor="#13319f" /></linearGradient>
            <linearGradient id={`${uid}-wash`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2563ff" stopOpacity="0.18" /><stop offset="1" stopColor="#2563ff" stopOpacity="0" /></linearGradient>
            {curves.filter((c) => c.m.type === "area" && c.k !== leadK).map((c) => (
              <linearGradient key={c.k} id={`${uid}-a${c.k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SERIES[c.k % SERIES.length]} stopOpacity="0.2" /><stop offset="1" stopColor={SERIES[c.k % SERIES.length]} stopOpacity="0" />
              </linearGradient>
            ))}
            {/* The warp: the threads beneath the lead line, fading toward the baseline. */}
            <pattern id={`${uid}-warp`} width="6" height="10" patternUnits="userSpaceOnUse"><rect width="1.2" height="10" fill="#2563ff" opacity="0.22" /></pattern>
            <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <mask id={`${uid}-m`}><rect width={W} height={H} fill={`url(#${uid}-fade)`} /></mask>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="sp-ui-chart-grid" data-zero={t === 0 || undefined} />
              <text x={L - 10} y={y(t) + 4} textAnchor="end" className="sp-ui-chart-axis" data-scale>{value(t)}</text>
            </g>
          ))}
          {rows.map((r, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every) && (
            <text key={`x${i}`} x={cx(i)} y={H - 9} textAnchor="middle" className="sp-ui-chart-axis" data-now={i === n - 1 || undefined}>{r.x.slice(0, CH.axisLabelMax)}</text>
          ))}
          {hover !== null && lines.length > 0 && <line className="sp-ui-chart-cross" x1={cx(hover)} x2={cx(hover)} y1={T - 6} y2={T + ih} />}
          {/* Single bars stand in sunk tracks, the full height of the plot, so each reads against its whole. */}
          {bars.length === 1 && !stacked && rows.map((r, i) => v(r, bars[0].k) >= 0 && (
            <rect key={`t${i}`} className="sp-ui-chart-track" x={cx(i) - colW / 2} y={T} width={colW} height={Math.max(0, zero - T)} rx={rad} />
          ))}
          {barShapes.map((b) => b.d && (
            <path key={`${b.i}-${b.k}-${b.down}`} className="sp-ui-chart-bar" d={b.d} fill={ink(b.k, "v")} data-lead={b.k === leadK || undefined} data-down={b.down || undefined} data-dim={hover !== null && hover !== b.i || undefined}
              style={{ animationDelay: `${Math.min(b.i, 24) * 40}ms`, ["--sp-ink" as string]: SERIES[b.k % SERIES.length] }} />
          ))}
          {curves.map((c) => (
            <g key={`${c.k}-${c.m.label}`} className="sp-ui-chart-series" data-lead={c.k === leadK || undefined} style={{ ["--sp-ink" as string]: SERIES[c.k % SERIES.length] }}>
              {c.k === leadK && c.m.type !== "point" && <>
                <path className="sp-ui-chart-area" d={`${c.d}L${c.xy[n - 1][0]},${base}L${c.xy[0][0]},${base}Z`} fill={`url(#${uid}-wash)`} />
                <path className="sp-ui-chart-area" d={`${c.d}L${c.xy[n - 1][0]},${base}L${c.xy[0][0]},${base}Z`} fill={`url(#${uid}-warp)`} mask={`url(#${uid}-m)`} />
              </>}
              {c.k !== leadK && c.m.type === "area" && <path className="sp-ui-chart-area" d={`${c.d}L${c.xy[n - 1][0]},${base}L${c.xy[0][0]},${base}Z`} fill={`url(#${uid}-a${c.k})`} />}
              {c.m.type !== "point" && <path className="sp-ui-chart-line" d={c.d} pathLength={1} stroke={ink(c.k, "h")} />}
              {c.m.type === "point" && c.xy.map(([px, py], i) => <circle key={i} className="sp-ui-chart-dot" cx={px} cy={py} r={4} style={{ animationDelay: `${Math.min(i, 40) * 12}ms` }} />)}
              {c.m.type !== "point" && c.k !== leadK && <circle className="sp-ui-chart-end" cx={c.xy[n - 1][0]} cy={c.xy[n - 1][1]} r={4} />}
              {hover !== null && <circle className="sp-ui-chart-mark" cx={c.xy[hover][0]} cy={c.xy[hover][1]} r={5} />}
            </g>
          ))}
          {noteXY && <circle className="sp-ui-chart-notedot" cx={noteXY[0]} cy={noteXY[1]} r={4.5} />}
          {knob && <line className="sp-ui-chart-drop" x1={knob.x} x2={knob.x} y1={knob.y + 14} y2={base} />}
          {rows.map((_, i) => <rect key={`h${i}`} className="sp-ui-chart-hit" x={L + band * i} y={0} width={band} height={H} onMouseEnter={() => setHover(i)} />)}
        </svg>
        {knob && <span className="sp-ui-chart-knob" aria-hidden style={{ left: `${(knob.x / W) * 100}%`, top: `${(knob.y / H) * 100}%` }} />}
        {knob && hover === null && (
          <div className="sp-ui-chart-bubble" aria-hidden data-edge={knob.x > W * 0.78 || undefined} style={{ left: `${(knob.x / W) * 100}%`, top: `${(knob.y / H) * 100}%` }}>
            <b className="ap-num">{value(v(rows[n - 1], leadK))}</b>
            <span dir="auto">{[rows[n - 1].x, ...marks.map((m, k) => (k === leadK ? "" : `${m.label} ${value(v(rows[n - 1], k))}`)).filter(Boolean).slice(0, 2)].join(" · ")}</span>
          </div>
        )}
        {noteXY && note && <p className="sp-ui-chart-note" data-at="point" dir="auto" data-edge={noteXY[0] > W * 0.6 || undefined} style={{ left: `${(noteXY[0] / W) * 100}%`, top: `${(noteXY[1] / H) * 100}%` }}>{note.text}</p>}
        {tip && (
          <div className="sp-ui-chart-tip" role="status" style={{ left: `${(cx(hover!) / W) * 100}%` }} data-side={cx(hover!) > W * 0.6 ? "left" : "right"}>
            <span className="sp-ui-chart-tip-x" dir="auto">{tip.x}</span>
            {marks.map((m, k) => <span key={`${k}-${m.label}`} className="sp-ui-chart-tip-row">{keyOf(m, k)}<b className="ap-num">{full(v(tip, k))}</b><span dir="auto">{m.label}</span></span>)}
          </div>
        )}
      </div>
      {/* On a narrow chart the same note reads as a caption under the plot (CSS shows one of the two). */}
      {noteXY && note && <p className="sp-ui-chart-note" data-at="caption" dir="auto">{note.text}</p>}
      {points.length > rows.length && <Label>{UI.firstPoints(rows.length, points.length)}</Label>}
    </figure>
  );
}

// ---------- The table ----------

/**
 * A column. Its kind sets its alignment and its width (title wide, codes and numbers narrow, actions at the end), so
 * the same kind of data lines up the same way on every screen. `text` gives the full value for the cell's tooltip.
 */
export type Col<T> = {
  key: string; header: ReactNode;
  kind?: "title" | "text" | "wide" | "code" | "num" | "money" | "date" | "badge" | "status" | "actions" | "icon";
  cell: (row: T) => ReactNode;
  text?: (row: T) => string;
  /** The value the column sorts by; a column with one gets a sort button in its header. */
  sort?: (row: T) => string | number | null;
  /** The column's figure in a totals row under the table. */
  total?: ReactNode;
};
// title and wide have no fixed width: they fill what the fixed kinds leave, never below their minimum (the table's min width).
const WIDTH: Record<NonNullable<Col<unknown>["kind"]>, string | undefined> = {
  title: undefined, wide: undefined, text: "var(--sp-ui-w-text)", code: "var(--sp-ui-w-code)", num: "var(--sp-ui-w-num)", money: "var(--sp-ui-w-money)",
  date: "var(--sp-ui-w-date)", badge: "var(--sp-ui-w-badge)", status: "var(--sp-ui-w-status)", actions: "var(--sp-ui-w-actions)", icon: "var(--sp-ui-w-icon)",
};

export function Table<T>({ rows, cols, rowKey, label, pageSize = PAGE_SIZE, onRow, expand, selected, empty, tight, hasMore, onMore, view }: {
  rows: T[]; cols: Col<T>[]; rowKey: (row: T) => string; label: string;
  pageSize?: number; onRow?: (row: T) => void;
  /** A detail under the row, opened by clicking it: fixed height, scrolls inside. */
  expand?: (row: T) => ReactNode;
  selected?: string | null; empty?: ReactNode; tight?: boolean;
  /** The filter the rows answer to; when it changes the table returns to its first page. */
  view?: string;
  /** Rows beyond those loaded (a server cursor): the next page asks for them. */
  hasMore?: boolean; onMore?: () => void;
}) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [order, setOrder] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // Another filter or period (view), or rows that no longer start with the same record, start at the first page;
  // rows appended behind the same first record keep the page.
  const head = `${view ?? ""}\u0000${rows.length ? rowKey(rows[0]) : ""}`;
  const [seenHead, setSeenHead] = useState(head);
  if (seenHead !== head) { setSeenHead(head); setPage(0); }
  rows = useMemo(() => {
    const c = order && cols.find((x) => x.key === order.key);
    if (!c?.sort) return rows;
    const by = c.sort;
    return [...rows].sort((a, b) => {
      const x = by(a), y = by(b);
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), LOCALE)) * order!.dir;
    });
  }, [rows, cols, order]);
  const sortBy = (key: string) => { setPage(0); setOrder((o) => (o?.key !== key ? { key, dir: 1 } : o.dir === 1 ? { key, dir: -1 } : null)); };
  const loaded = Math.max(1, Math.ceil(rows.length / pageSize));
  const pages = loaded + (hasMore ? 1 : 0);
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [page, pages]);
  // Reaching the last loaded page asks for more, so the next page is ready when it is opened.
  useEffect(() => { if (hasMore && onMore && page >= loaded - 1) onMore(); }, [page, loaded, hasMore, onMore]);
  const shown = rows.slice(page * pageSize, page * pageSize + pageSize);
  const pad = pages > 1 ? Math.max(0, pageSize - shown.length) : 0;
  const clickable = !!onRow || !!expand;
  const toggle = (row: T) => { if (expand) setOpen((o) => (o === rowKey(row) ? null : rowKey(row))); onRow?.(row); };
  const minWidth = useMemo(() => cols.map((c) => `var(--sp-ui-w-${c.kind ?? "text"})`).join(" + "), [cols]);
  if (!rows.length) return <div className="sp-ui-empty">{empty ?? UI.empty}</div>;
  return (
    <div className="sp-ui-table" data-tight={tight || undefined}>
      {/* Reconciliation pass: one line sweeps the page of rows as it lands, the way a checker runs down a ledger. */}
      <i key={page} className="sp-ui-table-scan" aria-hidden />
      <div className="sp-ui-table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table style={{ minWidth: `calc(${minWidth})` }}>
          <colgroup>{cols.map((c) => <col key={c.key} style={{ width: WIDTH[c.kind ?? "text"] }} />)}</colgroup>
          <thead><tr>{cols.map((c) => (
            <th key={c.key} scope="col" data-kind={c.kind ?? "text"} data-sorted={order?.key === c.key || undefined} title={typeof c.header === "string" ? c.header : undefined} aria-sort={order?.key === c.key ? (order.dir === 1 ? "ascending" : "descending") : c.sort ? "none" : undefined}>
              {c.sort ? <button type="button" className="sp-ui-sort" onClick={() => sortBy(c.key)}><span dir="auto">{c.header}</span>{order?.key === c.key && (order.dir === 1 ? <IArrowUp size={12} /> : <IArrowDown size={12} />)}</button> : <span dir="auto">{c.header}</span>}
            </th>
          ))}</tr></thead>
          <tbody>
            {shown.map((row, i) => {
              const k = rowKey(row);
              return (
                // Two rows of an answer may be identical; their place on the page keeps their keys apart.
                <Fragment key={`${k}#${i}`}>
                  <tr data-click={clickable || undefined} data-on={selected === k || open === k || undefined} aria-expanded={expand ? open === k : undefined}
                    onClick={clickable ? (e) => { if (!(e.target as HTMLElement).closest("button, a, input, [role=switch]")) toggle(row); } : undefined}
                    onKeyDown={clickable ? (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); toggle(row); } } : undefined}
                    tabIndex={clickable ? 0 : undefined}>
                    {cols.map((c) => (
                      <td key={c.key} data-kind={c.kind ?? "text"} data-sorted={order?.key === c.key || undefined} title={c.text?.(row)}>
                        <div className="sp-ui-cell">{c.cell(row)}</div>
                      </td>
                    ))}
                  </tr>
                  {expand && open === k && (
                    <tr className="sp-ui-detail"><td colSpan={cols.length}><div className="sp-ui-detail-body">{expand(row)}</div></td></tr>
                  )}
                </Fragment>
              );
            })}
            {Array.from({ length: pad }, (_, i) => <tr key={`pad-${i}`} className="sp-ui-pad" aria-hidden><td colSpan={cols.length} /></tr>)}
          </tbody>
          {cols.some((c) => c.total !== undefined) && (
            <tfoot><tr>{cols.map((c) => <td key={c.key} data-kind={c.kind ?? "text"}><div className="sp-ui-cell">{c.total}</div></td>)}</tr></tfoot>
          )}
        </table>
      </div>
      {pages > 1 && (
        <nav className="sp-ui-pager" aria-label={UI.pages}>
          <span className="ap-num">{UI.range(nf.format(page * pageSize + 1), nf.format(page * pageSize + shown.length), `${nf.format(rows.length)}${hasMore ? "+" : ""}`)}</span>
          <Button tone="ghost" icon={<IChevronLeft size={16} />} aria-label={UI.prev} disabled={page === 0} onClick={() => setPage((p) => p - 1)} />
          <span className="ap-num">{hasMore ? UI.pageOpen(page + 1) : UI.page(page + 1, pages)}</span>
          <Button tone="ghost" icon={<IChevronRight size={16} />} aria-label={UI.next} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} />
        </nav>
      )}
    </div>
  );
}
export const PAGE_SIZE = 10;
