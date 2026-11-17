"use client";
// The product's signature: every decision carries one mark, a small seal with its glyph, the decision in words and
// its reference beneath. Waiting is an open ring; approved and done are a filled seal whose tick draws once; rejected
// and failed are red.
import { useId } from "react";
import "./stamp.css";

export type StampState = "waiting" | "approved" | "done" | "rejected" | "failed" | "cancelled";

const GLYPH: Record<StampState, string> = {
  waiting: "",
  approved: "M5 9.2l2.6 2.6L13 6.4",
  done: "M5 9.2l2.6 2.6L13 6.4",
  rejected: "M6 6l6 6M12 6l-6 6",
  failed: "M9 5v5M9 12.6v.4",
  cancelled: "M5.5 9h7",
};

/** `size` l is the seal of the one decision an answer is about: a raised disc with its glyph drawn large. */
export function Stamp({ state, label, meta, size = "s" }: { state: StampState; label: string; meta?: string; size?: "s" | "l" }) {
  const foil = `sp-foil-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const sealed = state === "approved" || state === "done";
  return (
    <span className="sp-ui-stamp" data-state={state} data-size={size} role="status">
      <svg className="sp-ui-stamp-seal" viewBox="0 0 18 18" aria-hidden>
        {state !== "waiting" && <circle className="sp-ui-stamp-bleed" cx="9" cy="9" r="8" />}
        <circle cx="9" cy="9" r="8" />
        {sealed && (
          <>
            <linearGradient id={foil} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#b9a8ff" stopOpacity="0" /><stop offset="0.42" stopColor="#8fd8ff" stopOpacity="0.85" />
              <stop offset="0.58" stopColor="#ffe08a" stopOpacity="0.85" /><stop offset="1" stopColor="#ffadc6" stopOpacity="0" />
            </linearGradient>
            <circle className="sp-ui-stamp-foil" cx="9" cy="9" r="8" fill={`url(#${foil})`} />
          </>
        )}
        {GLYPH[state] && <path d={GLYPH[state]} pathLength={1} />}
      </svg>
      <span className="sp-ui-stamp-word">{label}</span>
      {meta && <span className="sp-ui-stamp-meta" translate="no">{meta}</span>}
    </span>
  );
}

/** A status label the platform already uses for approvals and actions, as a stamp state; null when it is not a decision. */
export function stampOf(label: string): StampState | null {
  const l = label.toLowerCase();
  if (/^menunggu|^awaiting|^waiting|^pending/.test(l)) return "waiting";
  if (/^disetujui|^approved/.test(l)) return "approved";
  if (/^(dijalankan|selesai|dieksekusi|executed|done|completed)/.test(l)) return "done";
  if (/^ditolak|^rejected/.test(l)) return "rejected";
  if (/^(gagal|failed)/.test(l)) return "failed";
  if (/^(dibatalkan|cancelled|canceled)/.test(l)) return "cancelled";
  return null;
}
