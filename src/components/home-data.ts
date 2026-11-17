// Pure helpers behind the home sections: which sections exist, what leads, and how records group by status and day.
import type { Item, PanelData, Tone } from "../lib/types.ts";
import { DAY_MS } from "../config/locale.ts";

export const HOME_SECTIONS = ["spotlight", "records", "board", "agenda", "metrics", "suggestions", "suggestion-cards"] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** Parses a `?home=a,b` preview list; unknown names are dropped, duplicates kept once. Null when nothing valid is left. */
export function parseSections(q: string | null | undefined): HomeSection[] | null {
  if (!q) return null;
  const valid = q
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is HomeSection => (HOME_SECTIONS as readonly string[]).includes(s));
  return valid.length ? [...new Set(valid)] : null;
}

const RANK: Record<Tone, number> = { bad: 0, warn: 1, info: 2, neutral: 3, good: 4 };

/** Records that need the user first (bad, then warn, then info), otherwise in the domain's own order. */
export function attentionFirst(items: Item[]): Item[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => RANK[a.it.status?.tone ?? "neutral"] - RANK[b.it.status?.tone ?? "neutral"] || a.i - b.i)
    .map((x) => x.it);
}

export type StatusGroup = { label: string; tone: Tone; items: Item[] };

/** Board columns: one per status label, in the order the domain first lists them. Records without a status are left out. */
export function byStatus(items: Item[]): StatusGroup[] {
  const groups = new Map<string, StatusGroup>();
  for (const it of items) {
    if (!it.status) continue;
    const g = groups.get(it.status.label) ?? { label: it.status.label, tone: it.status.tone, items: [] };
    g.items.push(it);
    groups.set(it.status.label, g);
  }
  return [...groups.values()];
}

export type DayGroup = { key: string; label: string; items: Item[] };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Agenda: dated records from the start of today onward, in time order, grouped by local day with locale-aware labels. */
export function byDay(items: Item[], now = Date.now(), locale?: string): DayGroup[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  const dated = items
    .filter((it) => it.at && Number.isFinite(Date.parse(it.at)) && Date.parse(it.at) >= start.getTime())
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const out: DayGroup[] = [];
  for (const it of dated) {
    const d = new Date(Date.parse(it.at!));
    const key = dayKey(d);
    let g = out.at(-1);
    if (!g || g.key !== key) {
      const day = new Date(d);
      day.setHours(0, 0, 0, 0);
      const diff = Math.round((day.getTime() - start.getTime()) / DAY_MS);
      const label = diff <= 1 ? cap(rtf.format(diff, "day")) : d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" }).replace(/\bSept\b/g, "Sep");
      g = { key, label, items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

/** Whether a data section has anything to show, so an empty one takes no space on the home. */
export function sectionHasData(s: HomeSection, panel: PanelData, now = Date.now()): boolean {
  switch (s) {
    case "spotlight":
    case "records":
      return panel.items.length > 0;
    case "board":
      return panel.items.some((it) => it.status);
    case "agenda":
      return byDay(panel.items, now).length > 0;
    case "metrics":
      return (panel.metrics?.length ?? 0) > 0;
    default:
      return true;
  }
}
