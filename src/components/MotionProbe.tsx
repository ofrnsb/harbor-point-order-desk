"use client";
import { FRAME, GUARD } from "@/config/ui";
import { API } from "@/config/routes";
import { useEffect } from "react";

/** Dev only. While any [data-motion] element is in the DOM, records frame times and reports jank to /api/ui-guard. */
export function MotionProbe() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let raf = 0, last = 0, active = false;
    let frames: number[] = [];
    const flush = () => {
      if (frames.length >= GUARD.minFrames) {
        const sorted = [...frames].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * GUARD.p95)];
        const over33 = frames.filter((f) => f > FRAME.slowMs).length;
        const motion = { at: new Date().toISOString(), frames: frames.length, p95: Math.round(p95), over33, ok: p95 <= GUARD.p95BudgetMs && over33 === 0 };
        if (!motion.ok) console.warn("[motion-probe]", motion);
        fetch(API.uiGuard, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: location.pathname, motion }),
        }).catch(() => {});
      }
      frames = [];
    };
    const tick = (t: number) => {
      const animating = !document.hidden && document.querySelector("[data-motion]") !== null;
      if (animating && last) frames.push(t - last);
      if (active && !animating) flush();
      active = animating;
      last = animating ? t : 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      flush();
    };
  }, []);
  return null;
}
