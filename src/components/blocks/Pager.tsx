"use client";
// One way every block pages its rows: the agent sets the page size for the question (5 for "the three largest", 25 for a
// work list), the reader moves page by page, and every row stays reachable. A page change slides in from the side it
// came from; a new filter or sort starts again at page 1.
import { LOCALE } from "@/config/locale";
import { PAGER } from "@/copy/ui-blocks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IChevronLeft, IChevronRight } from "../icons";
import { FADE } from "../motion";

export type Paged<T> = { rows: T[]; page: number; pages: number; start: number; end: number; total: number; dir: 1 | -1; go: (p: number) => void };

/** `focus` opens on the page holding that row (a timeline opens where "next" is). */
export function usePaged<T>(items: T[], size: number, resetKey: unknown = null, focus = 0): Paged<T> {
  const per = Math.max(1, Math.round(size));
  const pages = Math.max(1, Math.ceil(items.length / per));
  const [state, setState] = useState({ page: Math.floor(Math.max(0, focus) / per) + 1, dir: 1 as 1 | -1 });
  const key = useRef(resetKey);
  useEffect(() => {
    if (key.current !== resetKey) { key.current = resetKey; setState({ page: 1, dir: 1 }); }
  }, [resetKey]);
  const page = Math.min(state.page, pages);
  const start = (page - 1) * per;
  const rows = useMemo(() => items.slice(start, start + per), [items, start, per]);
  return {
    rows, page, pages, start, end: start + rows.length, total: items.length, dir: state.dir,
    go: (p: number) => setState((s) => ({ page: Math.max(1, Math.min(pages, p)), dir: p < s.page ? -1 : 1 })),
  };
}

/** Page numbers to show: first, last, the current one and its neighbours, with gaps as null. */
function numbers(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | null)[] = [];
  [...keep].sort((a, b) => a - b).forEach((n, i, all) => { if (i && n - all[i - 1] > 1) out.push(null); out.push(n); });
  return out;
}

export function Pager<T>({ p, label, unit = PAGER.rows }: { p: Paged<T>; label: string; unit?: string }) {
  return <AnimatePresence initial={false}>{p.pages > 1 && <PagerNav key="pager" p={p} label={label} unit={unit} />}</AnimatePresence>;
}

function PagerNav<T>({ p, label, unit }: { p: Paged<T>; label: string; unit: string }) {
  const fmt = (n: number) => n.toLocaleString(LOCALE);
  return (
    <motion.nav className="sp-pager" aria-label={PAGER.aria(label)} {...FADE}>
      <span className="sp-pager-range" aria-live="polite">{fmt(p.start + 1)}–{fmt(p.end)} {PAGER.of} {fmt(p.total)} {unit}</span>
      <span className="sp-pager-nav">
        <button type="button" className="sp-pager-btn" onClick={() => p.go(p.page - 1)} disabled={p.page === 1} aria-label={PAGER.prevAria}><IChevronLeft size={14} /> {PAGER.prev}</button>
        {numbers(p.page, p.pages).map((n, i) => n === null
          ? <span key={`gap${i}`} className="sp-pager-gap" aria-hidden>…</span>
          : <button key={n} type="button" className="sp-pager-num" aria-current={n === p.page ? "page" : undefined} onClick={() => p.go(n)} aria-label={PAGER.page(n)}>{fmt(n)}</button>)}
        <button type="button" className="sp-pager-btn" onClick={() => p.go(p.page + 1)} disabled={p.page === p.pages} aria-label={PAGER.nextAria}>{PAGER.next} <IChevronRight size={14} /></button>
      </span>
    </motion.nav>
  );
}
