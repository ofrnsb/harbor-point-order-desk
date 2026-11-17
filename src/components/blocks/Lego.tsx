"use client";
// Board and calendar, each assembled from one rows result and the columns the agent chose; table and chart remain for
// answers stored before bricks.
// Values arrive raw (already masked); formatting, sorting, filtering and opening a record happen here.
import { dateTimeText } from "@/lib/datetime";
import { Badge as UiBadge, Button, Chart, Empty, Grow, Label, List, Row as UiRow, Section, Stack, Table, Text, Title, type Col } from "@/components/ui";
import { DateTile } from "@/components/ui/datetile";
import { LOCALE, numFmt } from "@/config/locale";
import { CAP, PAGE } from "@/config/ui";
import { PAGER } from "@/copy/ui-blocks";
import { COMMON } from "@/copy/ui-common";
import { LEGO } from "@/copy/ui-lego";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import type { Block, Cell, Column, Row, RowSource } from "@/lib/types";
import { moneyText, statusLabel, toneOf, YEAR } from "@/lib/values";
import { currencyOfColumn } from "@/config/data";
import { D, EASE, stagger } from "../motion";
import { Badge, type BlockCtx } from "./Blocks";
import { Pager, usePaged } from "./Pager";

type Of<T extends Block["type"]> = Extract<Block, { type: T }>;

const nf = { format: (v: number) => numFmt({ maximumFractionDigits: 2 }).format(v) };
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const asDate = (v: Cell): Date | null => {
  if (typeof v !== "string" || !(STAMP.test(v) || DAY_ONLY.test(v))) return null;
  const d = new Date(DAY_ONLY.test(v) ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** A stamp at local midnight is a date (a due date stored as 05:00 UTC is 00:00 EST), not a time worth showing. */
export const hasTime = (v: Cell) => {
  if (typeof v !== "string" || !STAMP.test(v)) return false;
  const d = new Date(v);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
};

export function fmtCell(c: Column, v: Cell): string {
  if (v === null || v === "") return COMMON.dash;
  if (typeof v === "boolean") return v ? COMMON.yes : COMMON.no;
  if (typeof v === "number" && YEAR.test(c.name) && Number.isInteger(v)) return String(v);
  if (typeof v === "number") return c.money ? moneyText(v, c.currency ?? currencyOfColumn(c.name)) : nf.format(v);
  const d = asDate(v);
  // A period bucket names its period, not its first instant: "Jun 2026", "week of Nov 2, 2026".
  if (d && /_month$/.test(c.name)) return dateTimeText(d, { day: false, year: true });
  if (d && /_week$/.test(c.name)) return COMMON.week(dateTimeText(d, { year: true }));
  if (d && (c.type === "date" || c.role === "start" || c.role === "end" || c.role === "date" || c.role === "stamp")) {
    return dateTimeText(d, { year: true, time: hasTime(v) });
  }
  if (c.role === "status") return statusLabel(v);
  return v;
}

/** A fact on a card: numbers carry their column's name ("Anggaran jam: 400"); dates and words read on their own. */
export const fact = (c: Column, v: Cell) => (typeof v === "number" ? `${c.label}: ${fmtCell(c, v)}` : fmtCell(c, v));

export function CellView({ c, v }: { c: Column; v: Cell }) {
  if (c.role === "status" && typeof v === "string" && v) return <Badge tone={toneOf(v)}>{statusLabel(v)}</Badge>;
  return <>{fmtCell(c, v)}</>;
}

export const openText = (o: RowSource, r: Row) => COMMON.openRow(o.object, String(r[o.key]), o.system);
export const canOpen = (o: RowSource | undefined, r: Row): o is RowSource => !!o && r[o.key] !== null && r[o.key] !== undefined;




// ---------- Table ----------
/**
 * A tool result's columns as library columns: the kind of data picks the width and alignment, the same everywhere
 * (money and counts right-aligned, dates and statuses at their fixed widths, the row's name filling what is left).
 */
export function dataCols(columns: Column[], open?: RowSource): Col<Row>[] {
  const titled = columns.find((c) => c.role === "title") ?? columns.find((c) => c.name === open?.key) ?? columns.find((c) => c.type === "text");
  return columns.map((c): Col<Row> => {
    const kind: Col<Row>["kind"] = c === titled ? "title"
      : c.type === "number" ? (c.money ? "money" : "num")
      : c.role === "status" ? "badge"
      : c.type === "date" || ["start", "end", "date", "stamp"].includes(c.role ?? "") ? "date"
      : c.type === "json" || c.role === "text" || c.role === "address" ? "wide" : "text";
    return { key: c.name, header: c.label, kind, cell: (r) => <CellView c={c} v={r[c.name]} />, text: (r) => fmtCell(c, r[c.name]), sort: (r) => { const v = r[c.name]; return typeof v === "number" || typeof v === "string" ? v : null; } };
  });
}

/** A table answer stored before answers were composed from bricks: the same Table every screen uses. */
export function TableBlock({ b, ctx }: { b: Of<"table">; ctx: BlockCtx }) {
  const cols = useMemo(() => dataCols(b.columns, b.open), [b.columns, b.open]);
  return (
    <Section title={b.title} note={b.note} flush>
      <Table rows={b.rows} cols={cols} rowKey={(r) => JSON.stringify(r)} label={b.title} pageSize={b.pageSize ?? PAGE.table} empty={COMMON.noData}
        onRow={b.open ? (r) => { if (canOpen(b.open, r)) ctx.onAsk(openText(b.open!, r)); } : undefined} />
    </Section>
  );
}

const TONE_ORDER = { warn: 0, info: 1, neutral: 2, bad: 3, good: 4 } as const;
const LANE_CAP = CAP.lane;
/**
 * One board column: the first page of cards, then "Show N more" a page at a time, so every card stays reachable.
 * A card can be dragged to another lane, or moved with its Move button. Moving changes the record in its system, so it
 * goes to the agent as a request and through the governed write (rehearsal, confirmation, approval); the card stays
 * where the data says it is and shows the request until the write is done and the board is read again.
 */
function Lane({ lane, lanes, rows, b, ctx, moves, onMove }: { lane: string; lanes: string[]; rows: Row[]; b: Of<"board">; ctx: BlockCtx; moves: Record<string, string>; onMove: (r: Row, from: string, to: string) => void }) {
  const step = b.pageSize ?? LANE_CAP;
  const [shown, setShown] = useState(step);
  const [over, setOver] = useState(false);
  const more = rows.length - shown;
  const name = (l: string) => (b.lane.role === "status" ? statusLabel(l) : l);
  const keyOf = (r: Row) => (canOpen(b.open, r) ? String(r[b.open.key]) : null);
  return (
    <div className="sp-board-lane" data-tone={toneOf(lane)} data-drop={over || undefined}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        const { key, from } = JSON.parse(raw) as { key: string; from: string };
        const r = b.rows.find((x) => keyOf(x) === key);
        if (r && from !== lane) onMove(r, from, lane);
      }}>
      <UiRow align="between" wrap={false}>
        <Text size="s" strong tone={LANE_TONE[toneOf(lane)]} truncate>{name(lane)}</Text>
        <Label>{rows.length.toLocaleString(LOCALE)}</Label>
      </UiRow>
      <ul>
        {rows.slice(0, shown).map((r, i) => {
          const key = keyOf(r);
          const label = fmtCell(b.label, r[b.label.name]);
          const asked = key ? moves[key] : undefined;
          const body = (
            <Stack gap="none">
              <Text strong>{label}</Text>
              {b.facts.map((f) => (r[f.name] === null ? null : <Label key={f.name}>{fact(f, r[f.name])}</Label>))}
            </Stack>
          );
          return (
            <motion.li key={`${lane}-${key ?? i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d2, ease: EASE, delay: stagger(i % step) }}>
              <div className="sp-board-item" draggable={!!key && !asked} data-asked={!!asked || undefined}
                onDragStart={(e) => { if (!key) return; e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ key, from: lane })); e.dataTransfer.effectAllowed = "move"; }}>
              {key ? (
                <button type="button" className="sp-board-card" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" title={LEGO.moveKeys} onClick={() => ctx.onAsk(openText(b.open!, r))}
                  onKeyDown={(e) => { const to = e.altKey && !asked ? lanes[lanes.indexOf(lane) + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0)] : undefined; if (to && to !== lane) { e.preventDefault(); onMove(r, lane, to); } }}>{body}</button>
              ) : (
                <div className="sp-board-card">{body}</div>
              )}
              {asked && <UiBadge tone="info">{LEGO.moveRequested(name(asked))}</UiBadge>}
              </div>
            </motion.li>
          );
        })}
      </ul>
      {more > 0 && (
        <Button tone="ghost" onClick={() => setShown((n) => n + step)}>
          {PAGER.show} {Math.min(step, more).toLocaleString(LOCALE)} {PAGER.more} {PAGER.of} {more.toLocaleString(LOCALE)}
        </Button>
      )}
    </div>
  );
}

const LANE_TONE = { warn: "warn", good: "good", bad: "bad", info: "default", neutral: "default" } as const;
const DRAG_TYPE = "application/x-order-desk-card";

export function BoardBlock({ b, ctx }: { b: Of<"board">; ctx: BlockCtx }) {
  const [moves, setMoves] = useState<Record<string, string>>({});
  const lanes = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of b.rows) {
      const k = r[b.lane.name] === null ? "-" : String(r[b.lane.name]);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    // The agent's process order when it gave one; otherwise work in progress first, finished last.
    const at = (v: string) => { const i = b.laneOrder?.indexOf(v) ?? -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    const known = [...new Set([...m.keys(), ...(b.laneOrder ?? [])])];
    for (const k of known) if (!m.has(k)) m.set(k, []);
    return [...m.entries()].sort(([a], [c]) => at(a) - at(c) || TONE_ORDER[toneOf(a)] - TONE_ORDER[toneOf(c)] || a.localeCompare(c, LOCALE));
  }, [b.rows, b.lane.name, b.laneOrder]);
  const names = lanes.map(([l]) => l);
  const move = (r: Row, from: string, to: string) => {
    const key = String(r[b.open!.key]);
    setMoves((m) => ({ ...m, [key]: to }));
    const lab = (l: string) => (b.lane.role === "status" ? statusLabel(l) : l);
    ctx.onAsk(LEGO.moveAsk(fmtCell(b.label, r[b.label.name]), key, b.lane.label, lab(from), lab(to)));
  };
  return (
    <Section title={b.title} note={b.note} actions={<UiBadge>{b.rows.length.toLocaleString(LOCALE)}</UiBadge>}>
      {lanes.length === 0 ? (
        <Empty>{COMMON.noData}</Empty>
      ) : (
        <div className="sp-board" tabIndex={0} role="region" aria-label={LEGO.laneAria(b.title, b.lane.label)}>
          {lanes.map(([lane, rows]) => <Lane key={lane} lane={lane} lanes={names} rows={rows} b={b} ctx={ctx} moves={moves} onMove={move} />)}
        </div>
      )}
    </Section>
  );
}

// ---------- Calendar ----------
export function CalendarBlock({ b, ctx }: { b: Of<"calendar">; ctx: BlockCtx }) {
  const [past, setPast] = useState(false);
  const status = b.facts.find((f) => f.role === "status");
  const facts = b.facts.filter((f) => f !== status);
  const { upcoming, earlier } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dated = b.rows
      .map((r) => ({ r, d: asDate(r[b.start.name]), e: b.end ? asDate(r[b.end.name]) : null }))
      .filter((x): x is { r: Row; d: Date; e: Date | null } => !!x.d)
      .sort((x, y) => x.d.getTime() - y.d.getTime());
    return { upcoming: dated.filter((x) => (x.e ?? x.d) >= today), earlier: dated.filter((x) => (x.e ?? x.d) < today) };
  }, [b.rows, b.start.name, b.end]);
  const list = past ? [...earlier, ...upcoming] : upcoming.length ? upcoming : earlier;
  const p = usePaged(list, b.pageSize ?? PAGE.calendar, past);
  const months = new Map<string, typeof list>();
  for (const x of p.rows) {
    const k = x.d.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
    months.set(k, [...(months.get(k) ?? []), x]);
  }
  const todayKey = new Date().toDateString();
  const open = b.open;
  return (
    <Section title={b.title} note={b.note} actions={<>
      <UiBadge>{b.rows.length.toLocaleString(LOCALE)}</UiBadge>
      {upcoming.length > 0 && earlier.length > 0 && <Button tone="ghost" aria-pressed={past} onClick={() => setPast((p) => !p)}>{past ? LEGO.hidePast : LEGO.showPast(earlier.length)}</Button>}
    </>}>
      {list.length === 0 ? (
        <Empty>{LEGO.noDates}</Empty>
      ) : (
        <Stack key={`p${p.page}`} gap="l">
          {[...months.entries()].map(([month, xs]) => (
            <Stack key={month} gap="s">
              <Title level={3}>{month}</Title>
              <List items={xs} size="l" rowKey={(x, i) => `${x.d.getTime()}-${i}`} onPick={open ? (x) => { if (canOpen(open, x.r)) ctx.onAsk(openText(open, x.r)); } : undefined}
                render={({ r, d, e }, i) => {
                  // Several items on one day share one date tile.
                  const sameDay = i > 0 && xs[i - 1].d.toDateString() === d.toDateString();
                  return (
                    <UiRow gap="m" wrap={false}>
                      <DateTile day={d.getDate()} weekday={d.toLocaleDateString(LOCALE, { weekday: "short" })} today={d.toDateString() === todayKey} empty={sameDay} />
                      <Grow>
                        <Stack gap="none">
                          <Text strong truncate>{fmtCell(b.label, r[b.label.name])}</Text>
                          <Label truncate>
                            {[
                              hasTime(r[b.start.name]) ? d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }) : null,
                              e && e.toDateString() !== d.toDateString() ? COMMON.until(dateTimeText(e)) : null,
                              ...facts.map((f) => (r[f.name] === null ? null : fact(f, r[f.name]))),
                            ].filter(Boolean).join(" · ")}
                          </Label>
                        </Stack>
                      </Grow>
                      {status && typeof r[status.name] === "string" && <UiBadge tone={toneOf(String(r[status.name]))}>{statusLabel(String(r[status.name]))}</UiBadge>}
                    </UiRow>
                  );
                }} />
            </Stack>
          ))}
        </Stack>
      )}
      <Pager p={p} label={b.title} unit={LEGO.events} />
    </Section>
  );
}

/** A chart answer stored before answers were composed from bricks: the same Chart every screen uses. */
export function ChartBlock({ b }: { b: Of<"chart"> }) {
  const points = b.rows.map((r) => ({ x: fmtCell(b.x, r[b.x.name]), values: b.y.map((c) => Number(r[c.name] ?? 0)) }));
  return (
    <Section title={b.title} note={b.note}>
      <Chart points={points} marks={b.y.map((c) => ({ type: b.chart, label: c.label }))} label={LEGO.chartAria(b.title, b.y.map((c) => c.label).join(", "), b.x.label)} empty={COMMON.noData} />
    </Section>
  );
}
