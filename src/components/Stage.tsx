"use client";
// The home: the greeting, then the sections this product lists in `ui.home` (or `?home=a,b` to preview another
// arrangement). Sections live in HomeSections.tsx; reorder them here, drop them, or add a bespoke one the object needs.
import { motion } from "motion/react";
import { memo, useEffect, useState } from "react";
import { ui } from "@/domain/ui";
import type { PanelData } from "@/lib/types";
import type { Selection } from "./blocks/Blocks";
import { Agenda, Board, Greeting, KeyFigures, Records, Spotlight, Suggestions, type SectionProps } from "./HomeSections";
import { parseSections, sectionHasData, type HomeSection } from "./home-data";
import { D, EASE, STEP, stagger } from "./motion";
import { uiHome } from "./ui-options";

/** The shipped arrangement. A product sets its own `home` in ui.ts from what its sector and user need first. */
const DEFAULT_HOME: HomeSection[] = ["records", "suggestions"];

const rise = (i: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: D.d4, ease: EASE, delay: stagger(i, STEP.card) },
});

type StageProps = {
  hasHome: boolean;
  showUpNext: boolean;
  panelData: PanelData | null;
  panelError: string | null;
  onRefresh: () => void;
  onOpenPanel: () => void;
  onAsk: (t: string) => void;
  onSelect: (s: Selection) => void;
  ref?: React.Ref<HTMLDivElement>;
};

export function renderSection(s: HomeSection, p: SectionProps) {
  switch (s) {
    case "spotlight":
      return <Spotlight {...p} />;
    case "records":
      return <Records {...p} />;
    case "board":
      return <Board {...p} />;
    case "agenda":
      return <Agenda {...p} />;
    case "metrics":
      return <KeyFigures {...p} />;
    case "suggestions":
      return <Suggestions onAsk={p.onAsk} />;
    case "suggestion-cards":
      return <Suggestions onAsk={p.onAsk} variant="cards" />;
  }
}

export const HomeStage = memo(function HomeStage({
  hasHome,
  showUpNext,
  panelData,
  panelError,
  onRefresh,
  onOpenPanel,
  onAsk,
  onSelect,
  ref,
}: StageProps) {
  const [preview, setPreview] = useState<HomeSection[] | null>(null);
  useEffect(() => setPreview(parseSections(new URLSearchParams(window.location.search).get("home"))), []);

  const sections = preview ?? uiHome ?? DEFAULT_HOME;
  const p: SectionProps = { panel: panelData, error: panelError, onRefresh, onOpenPanel, onAsk, onSelect };
  const visible = sections.filter((s) => {
    if (s === "suggestions" || s === "suggestion-cards") return ui.capabilities.length > 0;
    // Data sections stay off while the Inspector shows the same list, and take no space once loaded empty.
    if (!hasHome || !showUpNext) return false;
    return !panelData || sectionHasData(s, panelData);
  });

  return (
    <motion.div ref={ref} className="ap-home" exit={{ opacity: 0, transition: { duration: D.d2, ease: EASE } }}>
      <motion.div {...rise(0)}>
        <Greeting />
      </motion.div>
      {visible.map((s, i) => (
        <motion.div key={s} {...rise(i + 1)}>
          {renderSection(s, p)}
        </motion.div>
      ))}
    </motion.div>
  );
});
