import { LOCALE } from "../config/locale.ts";

/**
 * A date with or without its time, the same text on the server and in every browser. Engines join a combined date and
 * time differently ("20 Oct at 16.00" in Node, "20 Oct, 16.00" in Safari) and abbreviate September differently ("Sept" in
 * Node, "Sep" in Safari), which breaks hydration; the joined parts and the three-letter month never differ.
 */
export function dateTimeText(d: Date, o: { year?: boolean; time?: boolean; day?: boolean; weekday?: boolean; timeZone?: string } = {}): string {
  const date = d.toLocaleDateString(LOCALE, { ...(o.day === false ? {} : { day: "numeric" }), month: "short", ...(o.weekday ? { weekday: "long" } : {}), ...(o.year ? { year: "numeric" } : {}), ...(o.timeZone ? { timeZone: o.timeZone } : {}) }).replace(/\bSept\b/g, "Sep");
  if (!o.time) return date;
  return `${date}, ${d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(o.timeZone ? { timeZone: o.timeZone } : {}) })}`;
}
