"use client";
// A share read off an instrument: a dial of three quarters with its scale ticked round the outside, a track sunk into
// the surface, the share drawn in a lit arc that ends in a raised knob, and the figure in its centre.
import { useId, type ReactNode } from "react";
import type { Tone } from "./index";
import { Amount } from "./amount";
import "./ring.css";

const START = 135, SPAN = 270, TRACK = 36, TICKS = 40;
// Rounded to hundredths: the server and the browser compute trigonometry to different last digits, which would
// otherwise make the server's markup differ from the client's.
const round = (n: number) => Math.round(n * 100) / 100;
const at = (r: number, deg: number): [number, number] => [round(50 + r * Math.cos((deg * Math.PI) / 180)), round(50 + r * Math.sin((deg * Math.PI) / 180))];
const arc = (r: number, from: number, to: number) => {
  const [x0, y0] = at(r, from), [x1, y1] = at(r, to);
  return `M${x0} ${y0}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
const TRACK_D = arc(TRACK, START, START + SPAN);
/** The lit inks of the arc by tone: light at its start, deep at its end. */
const LIGHT: Record<Tone, [string, string]> = {
  neutral: ["#5a8fff", "#13319f"], info: ["#5a8fff", "#13319f"], good: ["#30d395", "#0b6b45"], warn: ["#ffc35a", "#a86200"], bad: ["#f2626b", "#8f1b25"],
};

/** `over` is the share past the whole (152% gives 52): the dial fills and a second, thinner lap runs inside it. */
export function Ring({ pct, over = 0, value, label, count, note, tone, size = "l" }: { pct: number; over?: number; value: ReactNode; label?: ReactNode; count?: ReactNode; note?: ReactNode; tone?: Tone; size?: "m" | "l" }) {
  const p = Math.max(0, Math.min(100, pct)), o = Math.max(0, Math.min(100, over));
  const ink = `sp-dial-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const end = START + (SPAN * p) / 100, [kx, ky] = at(TRACK, end);
  const [from, to] = LIGHT[tone ?? "info"];
  return (
    <div className="sp-ui-ring" data-tone={tone} data-size={size}>
      <span className="sp-ui-ring-dial">
        <svg viewBox="0 0 100 100" aria-hidden>
          <defs><linearGradient id={ink} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
          {Array.from({ length: TICKS + 1 }, (_, i) => {
            const deg = START + (SPAN * i) / TICKS, major = i % 10 === 0, [x0, y0] = at(43, deg), [x1, y1] = at(major ? 49 : 47, deg);
            return <line key={i} className="sp-ui-ring-tick" data-major={major || undefined} data-lit={(p > 0 && (i / TICKS) * 100 <= p) || undefined} x1={x0} y1={y0} x2={x1} y2={y1} />;
          })}
          <path className="sp-ui-ring-track" d={TRACK_D} />
          {p > 0 && <path className="sp-ui-ring-arc" d={arc(TRACK, START, Math.max(end, START + 0.5))} pathLength={1} stroke={`url(#${ink})`} />}
          {o > 0 && <path className="sp-ui-ring-arc" data-over d={arc(27, START, START + (SPAN * o) / 100)} pathLength={1} stroke={`url(#${ink})`} />}
          {p > 0 && <g className="sp-ui-ring-knob"><circle cx={kx} cy={ky} r="5.4" /><circle cx={kx} cy={ky} r="2.2" fill={to} /></g>}
        </svg>
        <strong className="sp-ui-ring-value ap-num">{typeof value === "string" ? <Amount text={value} roll /> : value}</strong>
      </span>
      {(label !== undefined || count !== undefined || note !== undefined) && (
        <span className="sp-ui-ring-words">
          {label !== undefined && <span className="sp-ui-ring-label" dir="auto">{label}</span>}
          {count !== undefined && <span className="sp-ui-ring-count ap-num">{count}</span>}
          {note !== undefined && <span className="sp-ui-ring-note" dir="auto">{note}</span>}
        </span>
      )}
    </div>
  );
}
