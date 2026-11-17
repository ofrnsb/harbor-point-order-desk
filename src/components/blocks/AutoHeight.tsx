"use client";
// Glides its height to whatever its content measures, so content that changes (a page of rows, a tab, a card that
// gains or loses a footer) eases to its new size instead of jumping. Transform-free, so text never stretches.
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { D, EASE } from "../motion";

export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | "auto">("auto");
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div className={`sp-autoh${className ? ` ${className}` : ""}`} initial={false} animate={{ height: h }} transition={reduce ? { duration: 0 } : { duration: D.d3, ease: EASE }}>
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}
