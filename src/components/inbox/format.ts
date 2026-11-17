"use client";
// How the queue writes times, states and checks: in the company's zone and locale, with one tone per meaning.
import { LOCALE, TIME_ZONE } from "@/config/locale";
import type { Severity, TriageState } from "@/config/orders";
import type { Tone } from "../ui";
import type { Checked } from "@/domain/orders/types";
export { byPriority, dueOf } from "@/domain/orders/priority";

export const timeOf = (iso: string) => new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).format(new Date(iso));
export const dayOf = (iso: string) => new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric", timeZone: TIME_ZONE }).format(new Date(iso));
export const stampOf = (iso: string) => new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }).format(new Date(iso));

export const STATE_TONE = {
  queued: "neutral", working: "info", needs_review: "warn", released: "good", approved: "good",
  rejected: "bad", closed: "neutral", merged: "neutral", failed: "bad",
} as const satisfies Record<TriageState, Tone>;

export const SEVERITY_TONE = { block: "bad", credit: "bad", warn: "warn" } as const satisfies Record<Severity, Tone>;

/** A requested date (YYYY-MM-DD) in full: "Wednesday, November 4". */
export const longDay = (day: string) => new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** A requested date (YYYY-MM-DD) as the customer would say it: "Nov 4". */
export const dueText = (day: string) => new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export const issuesOf = (checked: Checked[]) => checked.flatMap((c) => c.issues);
export const valueOf = (checked: Checked[]) => checked.reduce((s, c) => s + c.total, 0);

/** The queue's filters: what each one shows. */
export const FILTERS = {
  review: ["needs_review"],
  agent: ["released", "closed", "merged"],
  decided: ["approved", "rejected"],
  pending: ["queued", "working", "failed"],
  all: null,
} as const satisfies Record<string, readonly TriageState[] | null>;
export type FilterKey = keyof typeof FILTERS;
