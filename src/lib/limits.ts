// Reading a Claude usage-limit message: is it one, and when does it lift. Pure, so the server can rotate logins and the
// browser can show an old saved error in the product's own words.
import { DAY_MS, HOUR_MS } from "../config/locale.ts";
import { epochToLocal, zonedToEpoch } from "./time.ts";

export const isLimit = (msg: string) => /hit your .*limit|usage limit|rate.?limit|too many requests|\b429\b/i.test(msg);

type Clock = { hour: number; minute: number; zone: string };

const DAILY = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i;
// A weekly limit names a date too: "resets Nov 14 at 7pm (America/New_York)".
const WEEKLY = /resets?\s+([A-Za-z]{3,9})\s+(\d{1,2})\s+at\s+/i;

const pad = (n: number) => String(n).padStart(2, "0");

function clockOf(m: RegExpExecArray): Clock {
  const meridiem = (m[3] ?? "").toLowerCase();
  const hour = (Number(m[1]) % 12) + (meridiem === "pm" ? 12 : 0) + (!meridiem && Number(m[1]) === 12 ? 12 : 0);
  return { hour, minute: Number(m[2] ?? 0), zone: m[4] ?? "UTC" };
}

/** The instant a wall-clock time on a local date (YYYY-MM-DD) happens in the clock's zone; an unknown zone reads as UTC. */
function instant(date: string, c: Clock): number {
  const local = `${date}T${pad(c.hour)}:${pad(c.minute)}`;
  try { return zonedToEpoch(local, c.zone); } catch { return zonedToEpoch(local, "UTC"); }
}

function localDate(now: number, zone: string, plusDays = 0): string {
  const at = now + plusDays * DAY_MS;
  try { return epochToLocal(at, zone).slice(0, 10); } catch { return epochToLocal(at, "UTC").slice(0, 10); }
}

/** That clock time today in its zone, or tomorrow once it has passed. */
function nextDaily(c: Clock, now: number): number {
  const today = instant(localDate(now, c.zone), c);
  return today > now ? today : instant(localDate(now, c.zone, 1), c);
}

/** The named date at that clock time in its zone, when it is still ahead; otherwise the next daily reset. */
function nextWeekly(monthName: string, day: number, c: Clock, now: number): number {
  const month = new Date(`${monthName} 1, 2000`).getMonth();
  if (Number.isNaN(month)) return nextDaily(c, now);
  const at = instant(`${localDate(now, c.zone).slice(0, 4)}-${pad(month + 1)}-${pad(day)}`, c);
  return at > now ? at : nextDaily(c, now);
}

/**
 * When the limit lifts, from the message's "resets 5:40pm (America/New_York)": that clock time today in that zone, or
 * tomorrow if it has passed. Without a readable time the login rests for an hour.
 */
export function resetAt(msg: string, now = Date.now()): number {
  const weekly = WEEKLY.exec(msg);
  const daily = DAILY.exec(weekly ? msg.slice(weekly.index + weekly[0].length - 1).replace(/^\s*/, "resets ") : msg);
  if (!daily) return now + HOUR_MS;
  const clock = clockOf(daily);
  return weekly ? nextWeekly(weekly[1], Number(weekly[2]), clock, now) : nextDaily(clock, now);
}
