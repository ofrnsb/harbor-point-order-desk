"use client";
// The start screen the agent builds for this person: it reads their queue and data, decides what needs them first,
// and composes it from bricks. Its working steps show as bubbles while it builds; a failed build falls back.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { API } from "@/config/routes";
import { LOCALE } from "@/config/locale";
import { HOME } from "@/copy/ui-workspace";
import type { Message, StreamEvent } from "@/lib/types";
import type { Step } from "../ActivityBubbles";
import { BlockView, type BlockCtx } from "../blocks/Blocks";
import { D, EASE } from "../motion";
import { Button, Row, Stack, Text } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";

type Agent = Extract<Message, { role: "agent" }>;
/** While rebuilding, the last screen stays up (dimmed) instead of collapsing to a skeleton. */
type State = { phase: "building"; steps: Step[]; last: Agent | null } | { phase: "ready"; message: Agent } | { phase: "failed"; error: string };

export function HomeBrief({ unitId, onAsk, onActionDone, fallback }: { unitId: string; onAsk: (text: string) => void; onActionDone: () => void; fallback: ReactNode }) {
  const [state, setState] = useState<State>({ phase: "building", steps: [], last: null });
  const started = useRef(false);
  const reduce = useReducedMotion();

  const build = useCallback(async (refresh: boolean) => {
    setState((st) => ({ phase: "building", steps: [], last: st.phase === "ready" ? st.message : st.phase === "building" ? st.last : null }));
    try {
      const res = await fetch(API.home, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unitId, refresh }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? HOME.failed);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const apply = (e: StreamEvent) => {
        if (e.t === "step") {
          const s: Step = { id: e.id, kind: e.kind, label: e.label, doneLabel: e.doneLabel, status: e.status, detail: e.detail };
          setState((st) => st.phase !== "building" ? st : { ...st, steps: st.steps.some((x) => x.id === s.id) ? st.steps.map((x) => (x.id === s.id ? s : x)) : [...st.steps, s] });
        } else if (e.t === "done" && e.message.role === "agent") {
          setState(e.message.error ? { phase: "failed", error: e.message.error } : { phase: "ready", message: e.message });
        } else if (e.t === "error") setState({ phase: "failed", error: e.message });
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) apply(JSON.parse(l) as StreamEvent);
      }
    } catch (err) {
      setState({ phase: "failed", error: err instanceof Error ? err.message : HOME.failed });
    }
  }, [unitId]);

  // Once per mount; the ref survives React's dev double-mount, so the turn is paid for once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void build(false);
  }, [build]);

  const ctx: BlockCtx = {
    onSelect: () => {},
    onAsk,
    onActionDone: () => { onActionDone(); void build(true); },
    selected: "",
    latest: true,
  };

  const shown = state.phase === "ready" ? state.message : state.phase === "building" ? state.last : null;
  const view = state.phase === "failed" ? "failed" : shown ? "ready" : "building";
  const fade = { initial: { opacity: 0, y: reduce ? 0 : 6 }, animate: { opacity: 1, y: 0, transition: { duration: D.d3, ease: EASE } }, exit: { opacity: 0, transition: { duration: D.d1, ease: EASE } } };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === "failed" && state.phase === "failed" && (
        <motion.div key="failed" {...fade}>
          <Stack gap="m">
            {fallback}
            <Row gap="s"><Text size="s" tone="muted">{HOME.fellBack}</Text><Button tone="ghost" onClick={() => void build(true)}>{HOME.retry}</Button></Row>
          </Stack>
        </motion.div>
      )}
      {view === "building" && (
        <motion.div key="building" {...fade}>
          <Skeleton rows={3} height={120} label={HOME.building} />
        </motion.div>
      )}
      {view === "ready" && shown && (
        <motion.div key="ready" className="sp-brief" data-phase={state.phase} aria-busy={state.phase === "building"} {...fade}>
          <Stack gap="m">
            <div className="sp-brief-body"><Stack gap="m">{shown.blocks.map((b, i) => <BlockView key={`${shown.id}-${i}-${b.type}`} b={b} ctx={ctx} />)}</Stack></div>
            {state.phase === "building"
              ? <Skeleton rows={1} height={20} />
              : <Text size="s" tone="muted">{HOME.builtAt(new Date(shown.at).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }))}</Text>}
          </Stack>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
