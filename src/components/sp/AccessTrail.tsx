"use client";
// Access trail: the signature. One row per system the answer touched, with rows read, the scope the policy applied,
// what was masked, and the model route. Bars compare touches within this answer (the largest read is full). Rows draw in as each touch lands.
import { TRAIL_BAR } from "@/config/ui";
import { TRAIL } from "@/copy/ui-canvas";
import { AnimatePresence, motion } from "motion/react";
import { memo } from "react";
import type { AccessTouch, AccessTrail as Trail, ModelUse } from "@/platform/contract";
import { D, EASE, stagger } from "../motion";
import { KIND_SHORT, num } from "./client";

const OP_LABEL: Record<AccessTouch["op"], string> = TRAIL.ops;

function barWidth(rows: number, max: number): number {
  if (rows <= 0) return TRAIL_BAR.emptyPct;
  return Math.max(TRAIL_BAR.minPct, Math.round((rows / max) * 100));
}

function Row({ t, max, i }: { t: AccessTouch; max: number; i: number }) {
  const denied = t.op === "denied";
  const notes = [
    ...t.scope.map((s) => ({ k: "scope", v: `filter ${s}` })),
    ...t.masked.map((s) => ({ k: "mask", v: `masking ${s}` })),
    ...t.hashed.map((s) => ({ k: "mask", v: `hash ${s}` })),
    ...t.aggregated.map((s) => ({ k: "mask", v: `agregat ${s}` })),
  ];
  return (
    <motion.li
      className="sp-trail-row"
      data-op={t.op}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }}
      transition={{ duration: D.d2, ease: EASE, delay: stagger(i) }}
    >
      <span className="sp-trail-sys" translate="no">
        <strong>{t.code}</strong>
        <span>{KIND_SHORT[t.kind] ?? t.kind}</span>
      </span>
      <span className="sp-trail-main">
        <span className="sp-trail-line">
          <span className="sp-trail-obj" title={t.object} translate="no">{t.objectLabel || t.object}</span>
          <span className="sp-trail-track" aria-hidden>
            <motion.span
              className="sp-trail-bar"
              style={{ width: "100%", transformOrigin: "0 50%" }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: (denied ? 100 : barWidth(t.rows, max)) / 100 }}
              transition={{ duration: D.d4, ease: EASE, delay: stagger(i) + D.d1 / 2 }}
            />
          </span>
          <span className="sp-trail-count ap-num">
            {denied ? TRAIL.outOfScope : `${num(t.rows)} ${OP_LABEL[t.op]}`}
          </span>
        </span>
        {(notes.length > 0 || t.note) && (
          <span className="sp-trail-notes">
            {notes.map((n, j) => (
              <span key={`${n.v}-${j}`} className="sp-trail-note" data-k={n.k} translate="no">{n.v}</span>
            ))}
            {t.note && <span className="sp-trail-note" data-k="note">{t.note}</span>}
          </span>
        )}
      </span>
    </motion.li>
  );
}

function ModelLine({ m }: { m: ModelUse }) {
  return (
    <motion.p className="sp-trail-model" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: D.d2, ease: EASE }}>
      <span>{TRAIL.model}</span>
      <strong translate="no">{m.label}</strong>
      <span className="sp-trail-where" data-external={m.external}>{m.external ? TRAIL.external : TRAIL.local}</span>
      {m.rerouted && <span className="sp-trail-reroute">{m.reason ?? TRAIL.rerouted}</span>}
    </motion.p>
  );
}

export const AccessTrail = memo(function AccessTrail({ trail, live = false }: { trail: Trail; live?: boolean }) {
  if (!trail.touches.length && !trail.model) return null;
  const max = Math.max(1, ...trail.touches.map((t) => t.rows));
  const systems = new Set(trail.touches.filter((t) => t.op !== "denied").map((t) => t.code)).size;
  return (
    <section className="sp-trail" aria-label={TRAIL.title} data-live={live}>
      <p className="sp-trail-head">
        <span>{TRAIL.title}</span>
        {trail.touches.length > 0 && (
          <span className="ap-num">
            {TRAIL.systems(systems)} · {TRAIL.accesses(trail.touches.length)}
          </span>
        )}
      </p>
      <ul className="sp-trail-list">
        <AnimatePresence initial={false}>
          {trail.touches.map((t, i) => (
            <Row key={t.id} t={t} max={max} i={i} />
          ))}
        </AnimatePresence>
      </ul>
      {trail.model && <ModelLine m={trail.model} />}
    </section>
  );
});
