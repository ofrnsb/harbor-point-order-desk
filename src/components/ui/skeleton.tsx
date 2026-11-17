"use client";
// Placeholders while something loads: rows of a given height, or one block of a given size.
import "./skeleton.css";

export function Skeleton({ rows = 1, height = 40, width, label }: { rows?: number; height?: number; width?: number | string; label?: string }) {
  return (
    <div className="sp-ui-skel" role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ height, width, opacity: rows > 1 ? 1 - i * 0.14 : 1 }} />)}
    </div>
  );
}
