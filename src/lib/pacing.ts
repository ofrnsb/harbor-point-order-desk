// Pure pacing logic: real events drive WHEN a step exists, this decides WHAT the user sees and for how long.
export const T = { stagger: 100, minRun: 500, hold: 600 } as const;

export type Rec = { enterAt: number; doneAt?: number; failed?: boolean };
export type Phase = "pending" | "running" | "done" | "failed" | "gone";

/** Where a step is in its visible life at time `now` (ms). */
export function phaseAt(r: Rec, now: number): Phase {
  if (now < r.enterAt) return "pending";
  if (r.doneAt === undefined) return "running";
  const finishAt = Math.max(r.doneAt, r.enterAt + T.minRun); // an instant tool still shows its run
  if (now < finishAt) return "running";
  // A failed step is usually the agent's own slip that it then corrects; it reads a little longer, then leaves like the rest.
  // The full record stays in the Activity trace, and a turn that fails as a whole shows its own error.
  if (r.failed) return now < finishAt + T.hold * 2 ? "failed" : "gone";
  return now < finishAt + T.hold ? "done" : "gone";
}

/** Next moment any record changes phase, so a timer can wake the UI exactly then. */
export function nextBoundary(recs: Rec[], now: number): number | null {
  let next = Infinity;
  for (const r of recs) {
    const marks = [r.enterAt];
    if (r.doneAt !== undefined) {
      const finishAt = Math.max(r.doneAt, r.enterAt + T.minRun);
      marks.push(finishAt, finishAt + (r.failed ? T.hold * 2 : T.hold));
    }
    for (const m of marks) if (m > now && m < next) next = m;
  }
  return Number.isFinite(next) ? next : null;
}
