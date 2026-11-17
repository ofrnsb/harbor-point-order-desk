// Time units and the locale every screen, tool and seed formats in. Shared by server and browser.

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_DAYS = 7;

// The workspace's locale, currency and time zone. They are the defaults until the company's own settings are applied
// (applyWorkspace): on the server from the tenant, in the browser from /api/me. Imports read them live, so every formatter
// follows the company, whichever country it is in.
export let LOCALE = "en-US";
export let CURRENCY = "USD";
export let CURRENCY_PREFIX = "$";
export let TIME_ZONE = "America/New_York";
export const DEFAULT_WORKSPACE = { locale: LOCALE, currency: CURRENCY, timezone: TIME_ZONE } as const;

/** The symbol an amount in this currency is written with: the locale's narrow symbol ($, €, £). */
export function currencySymbol(currency: string, locale = LOCALE): string {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency; }
  catch { return currency; }
}

/** Applies the company's settings to every formatter in this process (server) or page (browser). */
export function applyWorkspace(w: { locale?: string; currency?: string; timezone?: string }): void {
  if (w.locale && Intl.NumberFormat.supportedLocalesOf([w.locale]).length) LOCALE = w.locale;
  if (w.currency && /^[A-Z]{3}$/.test(w.currency)) { CURRENCY = w.currency; CURRENCY_PREFIX = currencySymbol(w.currency); }
  if (w.timezone) { try { new Intl.DateTimeFormat("en", { timeZone: w.timezone }); TIME_ZONE = w.timezone; } catch { /* keep the default */ } }
  numCache.clear();
}

const numCache = new Map<string, Intl.NumberFormat>();
/** A number formatter in the workspace locale, made once per locale and options. */
export function numFmt(o: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const k = `${LOCALE}|${JSON.stringify(o)}`;
  let f = numCache.get(k);
  if (!f) { f = new Intl.NumberFormat(LOCALE, o); numCache.set(k, f); }
  return f;
}
/** Amounts in another currency are grouped the international way ($48,081), so they are never misread as decimals. */
export const FOREIGN_MONEY_LOCALE = "en-US";
