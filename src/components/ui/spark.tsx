"use client";
// Small trend marks that sit beside a figure: a line that draws itself, or bars that rise one after another.
import { useId } from "react";
import { smoothPath } from "./curve";
import "./spark.css";

/** A trend in a glance: the line draws itself over a soft wash, and its latest point is marked. */
export function Spark({ values }: { values: number[] }) {
  const id = `sp-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (values.length < 2) return <span className="sp-ui-spark-none" aria-hidden>–</span>;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const xy = values.map((y, i) => [(i / (values.length - 1)) * 100, 34 - ((y - lo) / span) * 30] as const);
  const line = smoothPath(xy);
  const [ex, ey] = xy[xy.length - 1];
  return (
    <span className="sp-ui-spark" aria-hidden>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none">
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.18" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <path className="sp-ui-spark-wash" d={`${line}L100,36L0,36Z`} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <i className="sp-ui-spark-dot" style={{ left: `${ex}%`, top: `${(ey / 36) * 100}%` }} />
    </span>
  );
}

export function SparkBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <span className="sp-ui-sparkbars" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="sp-ui-sparkbars-track">
          <span className="sp-ui-sparkbars-fill" data-latest={i === values.length - 1 || undefined} style={{ ["--sp-ui-bar" as string]: String(Math.max(0.08, v / max)), animationDelay: `${i * 40}ms` }} />
        </span>
      ))}
    </span>
  );
}
