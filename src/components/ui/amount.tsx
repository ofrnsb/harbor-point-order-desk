"use client";
// An amount set the way a ledger sets it: the digits lead, the currency sits small and raised before them, and a scale
// or unit (B, M, jt, %) follows quietly, so the eye reads the size of the number first. Any text that is not an amount
// shows as it is.
import "./amount.css";

const PARTS = /^([−-]?)([^\d\s−-]*)\s?(\d[\d.,]*)\s?(\S{0,4})$/u;

const DRUM = "01234567890123456789".split("");

/** Digits that clear like a counting machine: each rolls a full turn into place, the rightmost first. */
function Roll({ num }: { num: string }) {
  const chars = [...num];
  const digits = chars.filter((c) => c >= "0" && c <= "9").length;
  let seen = 0;
  return (
    <>
      {chars.map((c, i) => {
        // Keyed from the right, so a value that grows keeps its columns and only rolls what changed.
        const key = chars.length - i;
        if (c < "0" || c > "9") return <span key={key} className="sp-ui-roll-sep">{c}</span>;
        seen++;
        return (
          <span key={key} className="sp-ui-roll" style={{ ["--i" as string]: String(digits - seen) }}>
            <span className="sp-ui-roll-drum" style={{ ["--d" as string]: c }}>{DRUM.map((d, k) => <span key={k}>{d}</span>)}</span>
          </span>
        );
      })}
    </>
  );
}

export function Amount({ text, roll }: { text: string; roll?: boolean }) {
  const m = PARTS.exec(text.trim());
  if (!m) return <>{text}</>;
  const [, sign, cur, num, unit] = m;
  return (
    <span className="sp-ui-amount" aria-label={text}>
      {sign && <span className="sp-ui-amount-sign" aria-hidden>−</span>}
      {cur && <span className="sp-ui-amount-cur" aria-hidden>{cur}</span>}
      <span className="sp-ui-amount-num" aria-hidden>{roll ? <Roll num={num} /> : num}</span>
      {unit && <span className="sp-ui-amount-unit" aria-hidden>{unit}</span>}
    </span>
  );
}
