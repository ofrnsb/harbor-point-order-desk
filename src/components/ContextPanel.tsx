"use client";
import { PANEL } from "@/copy/ui-chat";
import { AnimatePresence, motion } from "motion/react";
import { memo, useMemo } from "react";
import { Signature } from "@/domain/Signature";
import { ui } from "@/domain/ui";
import type { Item, PanelData } from "@/lib/types";
import { Timeline, type Selection } from "./blocks/Blocks";
import { Badge, Button, Grow, Label, List, Row, Section, Stack, Text, Title } from "@/components/ui";
import { Facts } from "@/components/ui/facts";
import { State } from "@/components/ui/state";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "./format";
import { IAlert, IArrowLeft, IArrowRight, IBox, IChevronRight, IClose, IRefresh } from "./icons";
import { D, EASE } from "./motion";

export type { PanelData } from "@/lib/types";

function spotlightIdOf(items: Item[]): string | null {
  if (!items.length) return null;
  const hit =
    items.find((it) => it.status?.tone === "warn" || it.status?.tone === "bad") ??
    items.find((it) => it.status?.tone === "info") ??
    items[0];
  return hit.id;
}

function Home({
  data,
  error,
  onSelect,
  onRetry,
}: {
  data: PanelData | null;
  error: string | null;
  onSelect: (s: Selection) => void;
  onRetry: () => void;
}) {
  const label = (ui.panelTitle || "detail").toLowerCase();
  const featuredId = useMemo(() => spotlightIdOf(data?.items ?? []), [data?.items]);

  if (error && !data) {
    return (
      <State tone="bad" icon={<IAlert size={18} />} title={PANEL.couldNotLoad(label)} body={error} action={{ label: PANEL.retry, onClick: onRetry }} />
    );
  }
  if (!data) return <Skeleton rows={4} height={56} label={PANEL.loading(label)} />;
  if (!data.items.length) {
    return <State icon={<IBox size={18} />} title={PANEL.emptyTitle} body={PANEL.emptyBody} />;
  }

  // The item that needs attention first leads with its signature; every item, that one too, is a row below.
  const featured = data.items.find((it) => it.id === featuredId && it.visual);
  const open = (it: Item) => onSelect({ type: "item", item: it });
  return (
    <Stack gap="m">
      {data.hint && <Text size="s" tone="muted">{data.hint}</Text>}
      {featured?.visual && (
        <Section focus title={featured.title} note={featured.subtitle} actions={featured.status && <Badge tone={featured.status.tone}>{featured.status.label}</Badge>}>
          <Signature visual={featured.visual} />
        </Section>
      )}
      <div data-guard="visible" data-guard-label={PANEL.rowsGuard}>
        <List items={data.items} rowKey={(it) => it.id} size="l" onPick={open} render={(it) => (
          <Row gap="s" wrap={false}>
            <Grow><Stack gap="none"><Text strong truncate>{it.title}</Text><Label truncate>{[it.subtitle, it.price ? money(it.price) : null].filter(Boolean).join(" · ")}</Label></Stack></Grow>
            {it.status && <Badge tone={it.status.tone}>{it.status.label}</Badge>}
            <IChevronRight size={14} />
          </Row>
        )} />
      </div>
    </Stack>
  );
}

function Detail({ sel, onAsk }: { sel: Selection; onAsk: (t: string) => void }) {
  const it = sel.type === "item" ? sel.item : sel.subject;
  return (
    <Stack gap="m">
      {it.image && <img className="ap-detail-img" src={it.image} alt="" width={280} height={180} />}
      <Stack gap="s">
        <Title level={2}>{sel.type === "timeline" ? sel.title : it.title}</Title>
        {it.subtitle && <Text tone="muted">{it.subtitle}</Text>}
        {(it.status || it.price) && (
          <Row gap="s">
            {it.status && <Badge tone={it.status.tone}>{it.status.label}</Badge>}
            {it.price && <Text strong>{money(it.price)}</Text>}
          </Row>
        )}
      </Stack>
      {it.visual && <Signature visual={it.visual} />}
      {it.fields.length > 0 && (
        <Facts rows={it.fields.map((f) => ({ label: f.label, value: f.value }))} />
      )}
      {sel.type === "timeline" && <Timeline steps={sel.steps} />}
      {it.meta && <Text size="s" tone="muted">{it.meta}</Text>}
      {it.action && <Button tone="primary" icon={<IArrowRight size={14} />} onClick={() => onAsk(it.action!.message)}>{it.action.label}</Button>}
    </Stack>
  );
}

const VIEW_SWAP = {
  enter: (dir: number) => ({ opacity: 0, x: 8 * dir }),
  shown: { opacity: 1, x: 0, transition: { duration: D.d2, ease: EASE } },
  leave: (dir: number) => ({ opacity: 0, x: -8 * dir, transition: { duration: D.d1, ease: EASE } }),
};

export const ContextPanel = memo(function ContextPanel({
  data,
  error,
  refreshing,
  hasHome,
  selection,
  mobile = false,
  onSelect,
  onClear,
  onClose,
  onRefresh,
  onAsk,
  home,
}: {
  /** Replaces the item list home with the product's own panel home. */
  home?: React.ReactNode;
  data: PanelData | null;
  error: string | null;
  refreshing: boolean;
  hasHome: boolean;
  selection: Selection | null;
  mobile?: boolean;
  onSelect: (s: Selection) => void;
  onClear: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onAsk: (t: string) => void;
}) {
  const key = selection ? (selection.type === "item" ? selection.item.id : `t${selection.subject.id}`) : "home";
  const count = data?.items.length ?? null;
  const heading = data?.title || ui.panelTitle || PANEL.detail;

  const enterOffset = mobile ? { opacity: 0, y: 40 } : { opacity: 0, x: 18 };
  const exitOffset = mobile
    ? { opacity: 0, y: 40, transition: { duration: D.d2, ease: EASE } }
    : { opacity: 0, x: 18, transition: { duration: D.d2, ease: EASE } };

  return (
    <motion.aside
      className="ap-panel"
      aria-label={PANEL.aria}
      initial={enterOffset}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={exitOffset}
      transition={{ duration: D.d3, ease: EASE }}
    >
      <div className="ap-sheet-bar" aria-hidden />
      <div className="ap-panel-head">
        <Row align="between" wrap={false}>
          {selection && hasHome ? (
            <Row gap="s" wrap={false}>
              <Button tone="ghost" icon={<IArrowLeft size={14} />} onClick={onClear}>{heading}</Button>
              <Label>{PANEL.detail}</Label>
            </Row>
          ) : (
            <Row gap="s" wrap={false}>
              <Title level={2}>{selection ? PANEL.detail : heading}</Title>
              {!selection && count !== null && count > 0 && <Badge>{count}</Badge>}
            </Row>
          )}
          <Row gap="none" wrap={false}>
            {!selection && <Button tone="ghost" icon={<IRefresh size={14} />} data-spinning={refreshing} aria-label={PANEL.reload(heading)} onClick={onRefresh} />}
            <Button tone="ghost" icon={<IClose size={15} />} aria-label={PANEL.close} onClick={onClose} />
          </Row>
        </Row>
      </div>
      <div className="ap-panel-body">
        {/* custom carries the direction to the leaving view too, so going into a detail and back mirror each other. */}
        <AnimatePresence mode="wait" initial={false} custom={selection ? 1 : -1}>
          <motion.div
            key={key}
            custom={selection ? 1 : -1}
            variants={VIEW_SWAP}
            initial="enter"
            animate="shown"
            exit="leave"
          >
            {selection ? (
              <Detail sel={selection} onAsk={onAsk} />
            ) : (
              home ?? <Home data={data} error={error} onSelect={onSelect} onRetry={onRefresh} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
});
