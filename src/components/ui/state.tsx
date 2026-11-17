"use client";
// A list's designed state when it has nothing to show: empty, no match, or failed, with its one way forward.
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { D, EASE } from "../motion";
import "./state.css";

export function State({ icon, title, body, action, tone }: { icon: ReactNode; title: ReactNode; body?: ReactNode; action?: { label: ReactNode; onClick: () => void }; tone?: "bad" }) {
  return (
    <motion.div className="sp-ui-state" data-tone={tone} role={tone === "bad" ? "alert" : undefined}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d2, ease: EASE }}>
      <span className="sp-ui-state-icon">{icon}</span>
      <strong>{title}</strong>
      {body && <span>{body}</span>}
      {action && <button type="button" onClick={action.onClick}>{action.label}</button>}
    </motion.div>
  );
}
