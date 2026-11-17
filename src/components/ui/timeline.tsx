"use client";
// Steps of a process one under another, each with its state on the line that joins them: done, the current one,
// still to come, or failed.
import type { ReactNode } from "react";
import { ICheck, IAlert } from "@/components/icons";
import "./timeline.css";

export type TimelineState = "done" | "current" | "pending" | "failed";

export function Timeline({ steps }: { steps: { key: string; state: TimelineState; title: ReactNode; meta?: ReactNode }[] }) {
  return (
    <ol className="sp-ui-timeline">
      {steps.map((s) => (
        <li key={s.key} data-state={s.state}>
          <span className="sp-ui-timeline-dot" aria-hidden>{s.state === "done" ? <ICheck size={11} /> : s.state === "failed" ? <IAlert size={11} /> : null}</span>
          <span className="sp-ui-timeline-body">
            <strong dir="auto">{s.title}</strong>
            {s.meta && <span className="sp-ui-timeline-meta" dir="auto">{s.meta}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
