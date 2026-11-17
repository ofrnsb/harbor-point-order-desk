"use client";
// Renders an answer the agent built from bricks. Every brick reads its values through the shared evaluator, so a
// number on screen is always a column of a tool result. Motion follows the brick: rows arrive one by one, a figure
// counts up, a bar fills, a line draws, a page slides from the side it came from.
import { LOCALE } from "@/config/locale";
import { PAGE } from "@/config/ui";
import { COMMON, UI } from "@/copy/ui-common";
import { BATA } from "@/copy/ui-lego";
import { Fragment, useMemo, type ReactNode } from "react";
import type { Block, Row as DataRow } from "@/lib/types";
import { moneyCompact, toneOf, statusLabel } from "@/lib/values";
import { evalVal, fmt, fmtShort, inCurrency, numberOf, pickRows, scopeFor, text, colOf, type DataMap, type Scope } from "@/lib/bata/eval";
import type { ResolvedNode } from "@/lib/bata/resolve";
import type { Text as Words, Val } from "@/lib/bata/schema";
import { Decide, type BlockCtx } from "../blocks/Blocks";
import { Badge, Button, Callout, Chart as UiChart, Divider, Empty, Figure as UiFigure, Grid, Label, List, Meter, Parts, Ranked, Row, Section, Split, Stack, Stat as UiStat, Status, sourceInk, Table as UiTable, Tabs, Text, Thread, Title, type Col } from "@/components/ui";
import { IArrowRight } from "@/components/icons";
import { openText } from "../blocks/Lego";
import { Pager, usePaged } from "../blocks/Pager";
import { Stamp, stampOf } from "@/components/ui/stamp";
import { Avatar } from "@/components/ui/avatar";
import { Ring as UiRing } from "@/components/ui/ring";
import { Spark as UiSpark } from "@/components/ui/spark";

type Props = { n: ResolvedNode; s: Scope; ctx: BlockCtx };

const isVal = (x: unknown): x is Val => !!x && typeof x === "object";
const say = (t: Words | Val | undefined, s: Scope) => (t === undefined ? "" : isVal(t) ? fmt(evalVal(t, s)) : text(t, s));
const TONE = { default: "neutral", muted: "neutral", accent: "info", good: "good", warn: "warn", bad: "bad" } as const;

export function BataView({ b, ctx }: { b: Extract<Block, { type: "bata" }>; ctx: BlockCtx }) {
  const s: Scope = { data: b.data as DataMap, ds: null, rows: [], row: null };
  return <Section title={b.title} threads={systemsOf(s.data).map(sourceInk)}><Brick n={b.root} s={s} ctx={ctx} /><Colophon data={s.data} /></Section>;
}

/** The systems an answer read from (or a result's title when it has no system), once each, in order. */
const used = (data: DataMap) => Object.values(data).filter((d) => d.rows.length);
const systemsOf = (data: DataMap) => [...new Set(used(data).map((d) => d.open?.system ?? d.title))];

/** The answer's sources, each as the system and object it was read from (or its title) and how many rows. */
function Colophon({ data }: { data: DataMap }) {
  const parts = used(data).map((d) => BATA.sourceOf(d.open ? `${d.open.system} · ${d.open.object}` : d.title, d.rows.length.toLocaleString(LOCALE)));
  return <Thread label={BATA.sources} parts={[...new Set(parts)]} />;
}

/** One brick on its own, for the brick gallery: no section around it, the data map as its scope. */
export function BrickView({ b, ctx }: { b: Extract<Block, { type: "bata" }>; ctx: BlockCtx }) {
  return <><Brick n={b.root} s={{ data: b.data as DataMap, ds: null, rows: [], row: null }} ctx={ctx} /><Colophon data={b.data as DataMap} /></>;
}

function withRows(s: Scope, rows?: Parameters<typeof scopeFor>[1]): Scope {
  return rows ? scopeFor(s.data, rows) : s;
}

function Brick({ n, s, ctx }: Props): ReactNode {
  const kids = (cs: ResolvedNode[], sc: Scope) => cs.map((c, i) => <Brick key={i} n={c} s={sc} ctx={ctx} />);
  switch (n.brick) {
    case "stack": return <Stack gap={n.gap ?? "m"} align={n.align}>{kids(n.children, withRows(s, n.rows))}</Stack>;
    // A few parts keep to one aligned line (a grid); a run of many folds onto the next line.
    case "row": return <Row gap={n.gap ?? "m"} align={n.align} wrap={n.children.length > ROW_INLINE_MAX}>{kids(n.children, withRows(s, n.rows))}</Row>;
    case "grid": return <Grid cols={n.columns ?? Math.min(4, n.children.length)} gap={n.gap ?? "m"}>{kids(n.children, withRows(s, n.rows))}</Grid>;
    case "split": return <Split ratio={n.ratio}>{kids(n.children, withRows(s, n.rows))}</Split>;
    case "section": {
      const inner = withRows(s, n.rows);
      return <Section title={n.title !== undefined ? say(n.title, inner) : undefined} note={n.note !== undefined ? say(n.note, inner) : undefined} focus={n.focus}>{kids(n.children, inner)}</Section>;
    }
    case "tabs": return <Tabs tabs={n.tabs.map((t) => ({ label: t.label, content: <Stack>{kids(t.children, s)}</Stack> }))} />;
    case "divider": return <Divider />;
    case "heading": return <Title level={n.level === 1 ? 1 : n.level === 2 ? 2 : 3}>{say(n.text, s)}</Title>;
    case "text": return <Text tone={n.tone} size={n.size}>{say(n.text, s)}</Text>;
    case "callout": return <Callout tone={TONE[n.tone ?? "accent"]} title={n.title !== undefined ? say(n.title, s) : undefined}>{say(n.text, s)}</Callout>;
    case "figure": return <Figure n={n} s={s} />;
    case "stat": return <UiStat label={say(n.label, s)} value={say(n.value, s)} />;
    case "bar": return <Bar n={n} s={s} />;
    case "status": return <StatusMark label={say(n.value, s)} />;
    case "stamp": {
      const v = say(n.value, s);
      return <Stamp state={stampOf(v) ?? "done"} label={v} meta={n.meta !== undefined ? say(n.meta, s) : undefined} size={n.size} />;
    }
    case "avatar": return <Avatar name={say(n.name, s)} />;
    case "parts": return <PartsView n={n} s={s} />;
    case "ring": return <Ring n={n} s={s} />;
    case "badge": return <Badge tone={TONE[n.tone ?? "default"]}>{say(n.text, s)}</Badge>;
    case "spark": return <Spark n={n} s={s} />;
    case "each": return <Each n={n} s={s} ctx={ctx} />;
    case "table": return <Table n={n} s={s} ctx={ctx} />;
    case "chart": return <Chart n={n} s={s} />;
    case "action": {
      const row = s.row ?? s.rows[0];
      const go = () => (n.open && s.ds?.open && row ? ctx.onAsk(openText(s.ds.open, row)) : n.send !== undefined ? ctx.onAsk(say(n.send, s)) : undefined);
      return <Button tone={n.kind === "primary" ? "primary" : "secondary"} onClick={go}>{say(n.label, s)}<IArrowRight size={15} className="sp-ui-btn-trail" /></Button>;
    }
    case "decide": {
      const row = s.row ?? s.rows[0];
      const id = row ? row[n.work] : null;
      if (id === null || id === undefined) return null;
      return <Decide d={{ workId: String(id), ref: String(n.ref && row ? row[n.ref] ?? id : id) }} onDone={() => ctx.onActionDone?.()} />;
    }
  }
}

/** A row of up to this many parts is one aligned line; more fold like chips. */
const ROW_INLINE_MAX = 4;

function StatusMark({ label }: { label: string }) {
  const st = stampOf(label);
  // States still in motion (open, submitted, overdue: the warn and info tones) breathe; settled ones hold still.
  const tone = toneOf(label);
  return st ? <Stamp state={st} label={label} /> : <Status tone={tone} live={tone === "warn" || tone === "info"}>{statusLabel(label)}</Status>;
}

/** A figure is the library's Stat: one size on every answer, whatever the agent asked for. */
function Figure({ n, s }: { n: Extract<ResolvedNode, { brick: "figure" }>; s: Scope }) {
  const g = evalVal(n.value, s);
  const v = fmtShort(g), full = fmt(g);
  const d = n.delta ? evalVal(n.delta, s) : null;
  const dn = d ? numberOf(d) : null;
  const good = n.good ?? "up";
  // The change is its own chip, coloured by whether it is good news; the figure itself stays in ink.
  const delta = d && dn !== null ? { text: `${dn > 0 ? "+" : ""}${fmtShort(d)}`, tone: dn === 0 ? "neutral" as const : (dn > 0) === (good === "up") ? "good" as const : "bad" as const, dir: dn > 0 ? "up" as const : dn < 0 ? "down" as const : "flat" as const } : undefined;
  return <span title={full !== v ? full : undefined}><UiFigure label={n.label !== undefined ? say(n.label, s) : ""} value={v} delta={delta} sub={n.note !== undefined ? say(n.note, s) : undefined} /></span>;
}

/** A share as a ring that draws itself: value over max, or a percent when no max is given. */
function Ring({ n, s }: { n: Extract<ResolvedNode, { brick: "ring" }>; s: Scope }) {
  const v = numberOf(evalVal(n.value, s)) ?? 0;
  const max = n.max ? numberOf(evalVal(n.max, s)) ?? 0 : 100;
  // The arc stops at full; the figure says the real share, so 152% of a limit never reads as 100%.
  const share = max > 0 ? (v / max) * 100 : 0;
  const pct = Math.max(0, Math.min(100, share));
  return (
    <UiRing pct={pct} over={share - 100} value={`${Math.round(share)}%`} tone={n.tone ? TONE[n.tone] : undefined} size={n.size ?? "l"}
      label={n.label !== undefined ? say(n.label, s) : undefined}
      count={n.max ? BATA.share(fmt(evalVal(n.value, s)), fmt(evalVal(n.max, s))) : undefined}
      note={n.note !== undefined ? say(n.note, s) : undefined} />
  );
}

/** Room past a target on a bar measured against one, so a beaten target shows by how much. */
const TARGET_ROOM = 1.25;

function Bar({ n, s }: { n: Extract<ResolvedNode, { brick: "bar" }>; s: Scope }) {
  const g = evalVal(n.value, s);
  const raw = numberOf(g), v = raw ?? 0;
  const target = n.target ? numberOf(evalVal(n.target, s)) : null;
  // Against a target the capsule runs past it; without one, a bar inside a repeat is measured against the largest
  // value of its siblings.
  const max = target ? Math.max(target * TARGET_ROOM, v) : n.max ? numberOf(evalVal(n.max, s)) ?? 0 : "bind" in n.value ? Math.max(0, ...s.rows.map((r) => Number(r[(n.value as { bind: string }).bind]) || 0)) : g.col?.role === "pct" ? 100 : v;
  const share = target ? (v / target) * 100 : max > 0 ? (v / max) * 100 : 0;
  const show = n.show ?? (target ? "pct" : "value");
  const label = n.label !== undefined ? say(n.label, s) : "";
  const missing = raw === null;
  return (
    <div className="sp-ui-barline" data-label={label ? true : undefined} data-figure={show !== "none" || undefined}>
      {label && <Text truncate>{label}</Text>}
      <Meter value={v} max={max} tone={n.tone ? TONE[n.tone] : "info"} label={label || undefined} target={target ? (target / max) * 100 : undefined} missing={missing} />
      {show !== "none" && <span className="sp-ui-barline-figure ap-num" data-missing={missing || undefined}>{missing ? UI.notIn : show === "pct" ? `${Math.round(share)}%` : fmt(g)}</span>}
    </div>
  );
}

/** One whole and its parts: each row is a part, named by one column and sized by another. */
function PartsView({ n, s }: { n: Extract<ResolvedNode, { brick: "parts" }>; s: Scope }) {
  const { ds, rows } = pickRows(n.rows, s.data);
  const vcol = inCurrency(colOf(ds, n.value), rows), lcol = colOf(ds, n.label);
  const parts = rows.map((r) => ({ label: fmt({ v: r[n.label], col: lcol }), value: Number(r[n.value]) || 0 }));
  return <Parts parts={parts} value={(v) => (vcol?.money ? moneyCompact(v, vcol.currency) : fmtShort({ v, col: vcol }))} />;
}

function Spark({ n, s }: { n: Extract<ResolvedNode, { brick: "spark" }>; s: Scope }) {
  const { rows } = pickRows(n.rows, s.data);
  return <UiSpark values={rows.map((r) => Number(r[n.y])).filter((x) => Number.isFinite(x))} />;
}

/** Rows scroll inside a fixed height; cards and tiles page; chips wrap; groups are lists under their own heading. */
function Each({ n, s, ctx }: { n: Extract<ResolvedNode, { brick: "each" }>; s: Scope; ctx: BlockCtx }) {
  const { ds, rows } = useMemo(() => pickRows(n.rows, s.data), [n.rows, s.data]);
  const groups = useMemo(() => {
    if (!n.group_by) return null;
    const m = new Map<string, DataRow[]>();
    for (const r of rows) { const k = fmt({ v: r[n.group_by!], col: colOf(ds, n.group_by!) }); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()];
  }, [rows, n.group_by, ds]);
  const tiles = n.as === "cards" || n.as === "grid";
  const p = usePaged(rows, n.page_size ?? PAGE.bataCards);
  if (!rows.length) return <Empty>{n.empty ?? COMMON.noData}</Empty>;
  const item = (r: DataRow) => <Brick n={n.item} s={{ data: s.data, ds, rows, row: r }} ctx={ctx} />;
  const list = (rs: DataRow[]) => <List items={rs} rowKey={(_, i) => String(i)} size="m" render={n.rank ? (r, i) => <Ranked at={i + 1}>{item(r)}</Ranked> : item} />;
  if (groups) {
    return (
      <Stack gap="l">
        {groups.map(([g, rs]) => (
          <Stack key={g} gap="s">
            <Row gap="s" wrap={false}><Title level={3}>{g}</Title><Label>{rs.length.toLocaleString(LOCALE)}</Label></Row>
            {list(rs)}
          </Stack>
        ))}
      </Stack>
    );
  }
  if (n.as === "chips") return <Row gap="s">{rows.slice(0, PAGE.bataChips).map((r, i) => <Fragment key={i}>{item(r)}</Fragment>)}</Row>;
  if (!tiles) return list(rows);
  return (
    <Stack gap="s">
      <Grid cols={n.columns ?? 3}>{p.rows.map((r, i) => <Section key={`${p.page}-${i}`}>{item(r)}</Section>)}</Grid>
      <Pager p={p} label={ds?.title ?? BATA.list} />
    </Stack>
  );
}

function Table({ n, s, ctx }: { n: Extract<ResolvedNode, { brick: "table" }>; s: Scope; ctx: BlockCtx }) {
  const { ds, rows } = useMemo(() => pickRows(n.rows, s.data), [n.rows, s.data]);
  const cols = useMemo((): Col<DataRow>[] => {
    const sc = (r: DataRow): Scope => ({ data: s.data, ds, rows, row: r });
    return n.columns.map((c, i) => {
      const numeric = c.align === "end" || (isVal(c.value) && ("agg" in c.value || "calc" in c.value || ("bind" in c.value && colOf(ds, c.value.bind)?.type === "number")));
      const sortKey = (r: DataRow) => { const g = isVal(c.value) ? evalVal(c.value, sc(r)) : null; return g ? numberOf(g) ?? String(g.v ?? "") : text(c.value as string, sc(r)); };
      const total = n.total ? (i === 0 ? COMMON.total : isVal(c.value) && "bind" in c.value && colOf(ds, c.value.bind)?.type === "number" ? fmt(evalVal({ agg: "sum", of: c.value.bind }, { data: s.data, ds, rows, row: null })) : "") : undefined;
      const money = isVal(c.value) && "bind" in c.value && !!colOf(ds, c.value.bind)?.money;
      // A column drawn as bars measures each cell against the largest value in the whole column.
      const num = (r: DataRow) => (isVal(c.value) ? numberOf(evalVal(c.value, sc(r))) : null);
      const most = c.bar ? Math.max(0, ...rows.map((r) => num(r) ?? 0)) : 0;
      const cell = c.bar ? (r: DataRow) => <span className="sp-ui-cellbar"><span>{say(c.value, sc(r))}</span><Meter value={num(r) ?? 0} max={most} missing={num(r) === null} /></span> : (r: DataRow) => say(c.value, sc(r));
      return { key: `${i}-${c.header}`, header: c.header, kind: i === 0 ? "title" : c.bar ? "text" : money ? "money" : numeric ? "num" : "text", cell, text: (r) => say(c.value, sc(r)), sort: sortKey, ...(total !== undefined ? { total } : {}) };
    });
  }, [n.columns, n.total, s.data, ds, rows]);
  return (
    <UiTable rows={rows} cols={cols} rowKey={(r) => JSON.stringify(r)} label={ds?.title ?? BATA.table} pageSize={n.page_size ?? PAGE.bataTable} empty={n.empty ?? COMMON.noData}
      onRow={ds?.open ? (r) => ctx.onAsk(openText(ds.open!, r)) : undefined} />
  );
}

function Chart({ n, s }: { n: Extract<ResolvedNode, { brick: "chart" }>; s: Scope }) {
  const { ds, rows } = pickRows(n.rows, s.data);
  const xCol = colOf(ds, n.x);
  const marks = n.marks.map((m) => ({ type: m.type, label: m.label ?? colOf(ds, m.y)?.label ?? m.y }));
  const points = rows.map((r) => ({ x: fmt({ v: r[n.x], col: xCol }), values: n.marks.map((m) => Number(r[m.y]) || 0) }));
  const ycol = inCurrency(colOf(ds, n.marks[0].y), rows), money = ycol?.money;
  // The note is placed at the point whose x value the agent named, as the rows hold it or as it reads on the axis.
  const at = n.note ? rows.findIndex((r, i) => String(r[n.x]) === n.note!.at || points[i].x === n.note!.at) : -1;
  return <UiChart points={points} marks={marks} stacked={n.stacked} height={n.height} note={at >= 0 ? { at: points[at].x, text: n.note!.text } : undefined} value={money ? (v) => moneyCompact(v, ycol?.currency) : undefined} full={(v) => fmt({ v, col: ycol })} label={BATA.chartAria(marks.map((m) => m.label).join(", "), xCol?.label ?? n.x)} empty={BATA.noChartData} />;
}
