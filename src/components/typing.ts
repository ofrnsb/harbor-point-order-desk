// Pacing for typed-out answers: speed follows what is still waiting to be shown, between a readable floor and a
// ceiling, so typing stays even while text streams in and never bursts at the end.
import { SECOND_MS } from "../config/locale.ts";
import { TYPING } from "../config/ui.ts";

export const TYPE_CPS = TYPING.cps;
export const TYPE_MAX_CPS = TYPING.maxCps;
export const TYPE_DRAIN_S = TYPING.drainS;
export const REVEAL_PAUSE_MS = TYPING.revealPauseMs;

/** Visible characters (fractional) after one frame of dtMs, given how many are visible and how many have arrived. */
export function nextTyped(shown: number, arrived: number, dtMs: number): number {
  if (shown >= arrived) return arrived;
  const cps = Math.min(TYPE_MAX_CPS, Math.max(TYPE_CPS, (arrived - shown) / TYPE_DRAIN_S));
  return Math.min(arrived, shown + (cps * Math.min(TYPING.maxFrameMs, dtMs)) / SECOND_MS);
}

/** The first n characters. A **bold** phrase types out letter by letter already bold (its closing marker is
 *  supplied early), and a marker cut in half is held back so a stray asterisk never shows. */
export function visibleText(text: string, n: number): string {
  let shown = text.slice(0, Math.max(0, Math.floor(n)));
  if (shown.endsWith("*") && !shown.endsWith("**") && text[shown.length] === "*") shown = shown.slice(0, -1);
  const open = (shown.split("**").length - 1) % 2 === 1;
  if (!open) return shown;
  const at = shown.lastIndexOf("**");
  return shown.length > at + 2 ? `${shown}**` : shown.slice(0, at);
}
