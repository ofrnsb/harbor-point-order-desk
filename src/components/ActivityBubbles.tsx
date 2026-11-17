"use client";
import { BUBBLES } from "@/copy/ui-chat";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { nextBoundary, phaseAt, T, type Phase, type Rec } from "@/lib/pacing";
import { D, EASE, SPRING_BUBBLE } from "./motion";

export type Step = {
  id: string;
  kind: "tool";
  label: string;
  doneLabel: string;
  status: "running" | "done" | "failed";
  detail?: string;
};

function usePaced(steps: Step[]) {
  const recs = useRef(new Map<string, Rec>());
  const lastEnter = useRef(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const t = performance.now();
    const live = new Set(steps.map((s) => s.id));
    for (const id of recs.current.keys()) if (!live.has(id)) recs.current.delete(id);
    for (const s of steps) {
      let r = recs.current.get(s.id);
      if (!r) {
        const enterAt = Math.max(t, lastEnter.current + T.stagger);
        lastEnter.current = enterAt;
        r = { enterAt };
        recs.current.set(s.id, r);
      }
      if (s.status === "running" && r.doneAt !== undefined) {
        r.enterAt = t;
        r.doneAt = undefined;
        r.failed = false;
      } else if (s.status !== "running" && r.doneAt === undefined) {
        r.doneAt = t;
        r.failed = s.status === "failed";
      }
    }
    setNow(t);
  }, [steps]);

  useEffect(() => {
    const next = nextBoundary([...recs.current.values()], now);
    if (next === null) return;
    const id = setTimeout(() => setNow(performance.now()), Math.max(0, next - performance.now()) + 2);
    return () => clearTimeout(id);
  }, [now]);

  return useMemo(
    () =>
      steps
        .map((s) => ({
          ...s,
          phase: (recs.current.has(s.id) ? phaseAt(recs.current.get(s.id)!, now) : "pending") as Phase,
        }))
        .filter((s) => s.phase !== "pending" && s.phase !== "gone"),
    [steps, now],
  );
}

function StatusIcon({ phase }: { phase: Phase }) {
  if (phase === "running") return <span className="ap-spinner" aria-hidden />;
  if (phase === "failed") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M7 4v3.4M7 9.9h.01M12 7A5 5 0 1 1 2 7a5 5 0 0 1 10 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <motion.path
        d="M3 7.5l2.6 2.6L11 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: D.d2, ease: EASE }}
      />
    </svg>
  );
}

export const ActivityBubbles = memo(function ActivityBubbles({ steps }: { steps: Step[] }) {
  const reduce = useReducedMotion();
  const shown = usePaced(steps);
  const open = shown.length > 0;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="bubbles-wrap"
          data-motion="bubbles"
          className="ap-bubbles-wrap"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0, transition: { duration: D.d1 } } : { opacity: 0, y: -4, transition: { duration: D.d2, ease: EASE } }}
          transition={{ duration: D.d2, ease: EASE }}
        >
          <div className="ap-bubbles" role="status" aria-live="polite">
            <AnimatePresence mode="popLayout" initial={false}>
              {shown.map((s) => (
                <motion.div
                  key={s.id}
                  layout="position"
                  data-phase={s.phase}
                  className={`ap-bubble ap-bubble-${s.kind}`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={
                    reduce
                      ? { opacity: 0, transition: { duration: D.d1 } }
                      : { opacity: 0, scale: 0.96, y: -4, transition: { duration: D.d3, ease: EASE } }
                  }
                  transition={SPRING_BUBBLE}
                >
                  <StatusIcon phase={s.phase} />
                  <span className="ap-bubble-label">
                    {s.phase === "running" ? s.label : s.phase === "failed" ? BUBBLES.failed(s.doneLabel) : s.doneLabel}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
