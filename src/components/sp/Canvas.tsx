"use client";
// Kanvas: the right-hand workspace the agent fills. Large answer blocks (tables, boards, calendars, charts, lists) live here,
// newest first in the tab row; the chat keeps the prose and a chip for each block that brings it back into view.
import { LOCALE } from "@/config/locale";
import { CAP, DELAY_MS } from "@/config/ui";
import { CANVAS } from "@/copy/ui-canvas";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import type { Block } from "@/lib/types";
import { BlockView, type BlockCtx } from "../blocks/Blocks";
import { IActivity, IBox, ICalendar, IChart, IClose, IColumns, IDownload, IPin, IPrint, IUsers } from "../icons";
import { D, EASE, FADE, REVEAL } from "../motion"
import { useFill } from "../fill";
import { fileName, sheetsOf, toCsv } from "./export";
import { Badge, Button, Grow, Label, Row, Stack, Text, Title } from "@/components/ui";

/** Blocks the user reads at length go to the canvas; ones that ask the user something, or hand them a file, stay in the conversation. */
export const onCanvas = (b: Block) => (b.type === "lego" || b.type === "bata" ? b.where === "canvas" : b.type !== "confirm" && b.type !== "form" && b.type !== "choices");

/** `ask` is the question the view answered, kept so the view can be pinned and asked again. */
export type CanvasEntry = { key: string; block: Block; latest: boolean; ask: string };

const KIND: Record<string, { label: string; Icon: (p: { size?: number }) => React.ReactNode }> = {
  table: { label: CANVAS.kinds.table, Icon: IColumns },
  board: { label: CANVAS.kinds.board, Icon: IColumns },
  calendar: { label: CANVAS.kinds.calendar, Icon: ICalendar },
  chart: { label: CANVAS.kinds.chart, Icon: IChart },
  list: { label: CANVAS.kinds.list, Icon: IBox },
  compare: { label: CANVAS.kinds.compare, Icon: IUsers },
  timeline: { label: CANVAS.kinds.timeline, Icon: IActivity },
  metrics: { label: CANVAS.kinds.metrics, Icon: IChart },
};
const kindOf = (b: Block) => (b.type === "lego" ? { label: b.label, Icon: IBox } : b.type === "bata" ? { label: CANVAS.built, Icon: IBox } : b.type === "layout" ? { label: CANVAS.layout, Icon: IColumns } : KIND[b.type] ?? { label: CANVAS.block, Icon: IBox });
export const viewLabel = (b: Block) => kindOf(b).label;
export const titleOf = (b: Block) => ("title" in b && b.title) || ("subject" in b ? b.subject.title : "") || kindOf(b).label;

/** The chip a turn shows in the chat for a block that lives on the canvas. */
/** The archive number of a kept work surface (WB-…, SH-…), the slip's leading token. */
const refOf = (b: Block): string | null => (b.type === "lego" && typeof (b.data as { ref?: unknown })?.ref === "string" ? (b.data as { ref: string }).ref : null);
/** How much the view holds, when it is rows. */
const countOf = (b: Block): string | null => ("rows" in b && Array.isArray(b.rows) ? CANVAS.rows(b.rows.length.toLocaleString(LOCALE)) : null);

export function CanvasChip({ b, focused, onFocus }: { b: Block; focused: boolean; onFocus: () => void }) {
  const { label } = kindOf(b);
  return (
    <button type="button" className="sp-canvas-chip" data-focused={focused} aria-pressed={focused} onClick={onFocus}>
      {refOf(b) && <span className="sp-canvas-chip-ref" translate="no">{refOf(b)}</span>}
      <Stack gap="none">
        <Text strong truncate>{titleOf(b)}</Text>
        <Label truncate>{[label, countOf(b), focused ? CANVAS.openHere : CANVAS.openThere].filter(Boolean).join(" · ")}</Label>
      </Stack>
    </button>
  );
}

function download(b: Block) {
  const url = URL.createObjectURL(new Blob([toCsv(sheetsOf(b))], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName(titleOf(b)) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), DELAY_MS.revokeDownload);
}

export const Canvas = memo(function Canvas({ entries, focused, onFocus, onClose, ctx, pinned, onPin }: {
  entries: CanvasEntry[]; focused: string | null; onFocus: (key: string) => void; onClose: () => void;
  ctx: Omit<BlockCtx, "latest">;
  pinned: Set<string>; onPin: (e: CanvasEntry) => Promise<string | null>;
}) {
  const current = entries.find((e) => e.key === focused) ?? entries[entries.length - 1] ?? null;
  const [pinState, setPinState] = useState<{ key: string; busy: boolean; error: string | null } | null>(null);
  useEffect(() => setPinState(null), [current?.key]);
  // A different view starts at its top, and its tab slides into sight if the strip has scrolled past it.
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useFill(bodyRef, current?.key);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    tabsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [current?.key, reduce]);
  const isPinned = !!current?.ask && pinned.has(current.ask);
  const pin = async () => {
    if (!current || isPinned) return;
    setPinState({ key: current.key, busy: true, error: null });
    const error = await onPin(current);
    setPinState({ key: current.key, busy: false, error });
  };
  const tabs = [...entries].reverse().slice(0, CAP.canvasTabs);
  return (
    <motion.aside
      className="sp-canvas"
      aria-label={CANVAS.title}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, transition: { duration: D.d2, ease: EASE } }}
      transition={{ duration: D.d3, ease: EASE }}
    >
      <header className="sp-canvas-head">
        <Row gap="s" wrap={false}>
          <Title level={2}>{CANVAS.title}</Title>
          {entries.length > 0 && <Badge>{entries.length}</Badge>}
          <Grow><AnimatePresence initial={false}>
            {pinState?.error && pinState.key === current?.key && <motion.div key="err" role="alert" {...FADE}><Text size="s" tone="bad" truncate>{pinState.error}</Text></motion.div>}
          </AnimatePresence></Grow>
          {current?.ask && (
            <Button tone="ghost" icon={<IPin size={14} />} aria-pressed={isPinned} disabled={pinState?.busy} onClick={pin} title={isPinned ? CANVAS.pinnedTitle : CANVAS.pinTitle}>
              {isPinned ? CANVAS.pinned : CANVAS.pin}
            </Button>
          )}
          <AnimatePresence initial={false}>
            {current && sheetsOf(current.block).length > 0 && (
              <motion.span key="download" {...FADE}><Button tone="ghost" icon={<IDownload size={14} />} onClick={() => download(current.block)} title={CANVAS.downloadTitle}>{CANVAS.download}</Button></motion.span>
            )}
          </AnimatePresence>
          {current && <Button tone="ghost" icon={<IPrint size={14} />} onClick={() => window.print()} title={CANVAS.printTitle}>{CANVAS.print}</Button>}
          <Button tone="ghost" icon={<IClose size={14} />} onClick={onClose}>{CANVAS.hide}</Button>
        </Row>
      </header>
      <AnimatePresence initial={false}>
      {tabs.length > 1 && (
        <motion.nav key="tabs" ref={tabsRef} className="sp-canvas-tabs" aria-label={CANVAS.tabsAria} {...REVEAL}>
          {tabs.map((e) => {
            const { Icon } = kindOf(e.block);
            const on = e.key === current?.key;
            return (
              <button key={e.key} type="button" className="sp-canvas-tab" aria-pressed={on} onClick={() => onFocus(e.key)} title={titleOf(e.block)}>
                <Icon size={13} />
                <span dir="auto">{titleOf(e.block)}</span>
              </button>
            );
          })}
        </motion.nav>
      )}
      </AnimatePresence>
      <div className="sp-canvas-body" ref={bodyRef}>
        {!current ? (
          <Stack gap="s" align="center"><IColumns size={20} /><Title level={3}>{CANVAS.emptyTitle}</Title><Text tone="muted">{CANVAS.emptyBody}</Text></Stack>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {/* The view the person picked shows at once; the one it replaces fades out of the layout instead of
                holding it (with "wait", a paused exit, as in a hidden tab, kept the old view on screen). */}
            <motion.div key={current.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }} transition={{ duration: D.d2, ease: EASE }}>
              <BlockView b={current.block} ctx={{ ...ctx, latest: current.latest }} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </motion.aside>
  );
});
