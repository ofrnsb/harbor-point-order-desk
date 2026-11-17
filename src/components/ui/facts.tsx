"use client";
// What something is, field by field: the field's name beside its full value. Values wrap instead of being cut,
// because a person confirms or reads exactly what is written here.
import type { ReactNode } from "react";
import "./facts.css";

export function Facts({ rows, label }: { rows: { label: ReactNode; value: ReactNode }[]; label?: string }) {
  return (
    <dl className="sp-ui-facts ap-num" aria-label={label}>
      {rows.map((r, i) => (
        <div key={i}>
          <dt dir="auto">{r.label}</dt>
          <dd dir="auto">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
