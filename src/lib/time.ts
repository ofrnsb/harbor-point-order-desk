import { ERR } from "../copy/server.ts";
import { MINUTE_MS } from "../config/locale.ts";
// Wall-clock conversions between IANA zones without a date library.

/** Offset of `tz` from UTC in minutes at the instant `epochMs`. */
export function offsetMin(tz: string, epochMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(epochMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(epochMs / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

/** "2026-11-01T07:30" in `tz` to epoch ms. */
export function zonedToEpoch(local: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error(ERR.badLocalTime(local));
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = guess - offsetMin(tz, guess) * MINUTE_MS;
  return guess - offsetMin(tz, first) * MINUTE_MS;
}

/** Epoch ms to "YYYY-MM-DDTHH:MM" wall time in `tz`. */
export function epochToLocal(epochMs: number, tz: string): string {
  const d = new Date(epochMs + offsetMin(tz, epochMs) * MINUTE_MS);
  return d.toISOString().slice(0, 16);
}

export function zoneLabel(tz: string, epochMs = Date.now()): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date(epochMs)).find((p) => p.type === "timeZoneName")?.value;
  return name ?? tz;
}

/** "Mon, Nov 2, 07:00 EST" */
export function localLabel(local: string, tz: string): string {
  const d = new Date(`${local.slice(0, 16)}:00Z`);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${day}, ${local.slice(11, 16)} ${zoneLabel(tz, zonedToEpoch(local, tz))}`;
}

export function nowLocal(tz: string): string {
  return epochToLocal(Date.now(), tz);
}
