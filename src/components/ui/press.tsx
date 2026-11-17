"use client";
// A pressable area that fills its slot (a list row, a tile) with one hover and focus, for rows that hold more than one
// control: the row opens with Press, the extra control sits beside it.
import type { ReactNode } from "react";
import "./press.css";

export function Press({ onPress, title, label, children }: { onPress: () => void; title?: string; label?: string; children: ReactNode }) {
  return <button type="button" className="sp-ui-press" onClick={onPress} title={title} aria-label={label}>{children}</button>;
}
