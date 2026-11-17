// Shared motion tokens. The shell writes D into the CSS --ap-d1..d4 tokens, so CSS and motion/react share one source.
// Only transform and opacity are animated; layout height changes use motion layout.
import { uiMotionScale } from "./ui-options";

export const EASE = [0.16, 1, 0.3, 1] as const;

/** The product's motion character from `motionScale` in ui.ts: below 1 is brisker, above 1 calmer. */
const pace = uiMotionScale;

export const D = {
  d1: 0.12 * pace, // 120ms: micro press, quick fade/exit
  d2: 0.18 * pace, // 180ms: hover, popover, view switch
  d3: 0.24 * pace, // 240ms: card, panel, drawer
  d4: 0.36 * pace, // 360ms: shell, hero stagger, metric bars
};

/** The same durations as CSS custom properties, set on the shell. */
export const MOTION_VARS = {
  "--ap-d1": `${Math.round(D.d1 * 1000)}ms`,
  "--ap-d2": `${Math.round(D.d2 * 1000)}ms`,
  "--ap-d3": `${Math.round(D.d3 * 1000)}ms`,
  "--ap-d4": `${Math.round(D.d4 * 1000)}ms`,
} as React.CSSProperties;

/** The soft ease for things that open and close (a floating list, a disclosure). */
export const EASE_SOFT = [0.32, 0.72, 0, 1] as const;
export const DISCLOSE = {
  /** A floating list over the content: in with a soft settle, out a little quicker; rows follow once it is in place. */
  pop: 0.3 * pace, popOut: 0.22 * pace, rowsAfter: 0.06 * pace, row: 0.04, rowFade: 0.24 * pace,
} as const;

export const SPRING = {
  type: "spring",
  stiffness: 420,
  damping: 34,
} as const;

export const SPRING_BUBBLE = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.8,
} as const;

/** One stagger rhythm for every list: rows step 30ms, cards 50ms, capped so long lists never wait. */
export const STEP = { row: 0.03, card: 0.05, max: 8 } as const;
export const stagger = (i: number, step: number = STEP.row) => Math.min(i, STEP.max) * step;

/** Height-auto reveal for content that pushes what is below it (errors, expanders, added rows). */
export const REVEAL = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto", transition: { height: { duration: D.d3, ease: EASE }, opacity: { duration: D.d2, ease: EASE, delay: 0.04 } } },
  exit: { opacity: 0, height: 0, transition: { height: { duration: D.d2, ease: EASE }, opacity: { duration: D.d1, ease: EASE } } },
} as const;
/** The same reveal with no movement, for reduced motion: width and height animations are not covered by MotionConfig. */
export const REVEAL_STILL = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: D.d1 } }, exit: { opacity: 0, transition: { duration: D.d1 } } } as const;

/** Fade for anything that leaves without moving the layout (notices, buttons, chips). */
export const FADE = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: D.d2, ease: EASE } },
  exit: { opacity: 0, transition: { duration: D.d1, ease: EASE } },
} as const;
