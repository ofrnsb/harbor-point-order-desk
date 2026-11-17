// How record values read on screen and in answers: one place, shared by the agent's tools and the room views.
import { dateTimeText } from "./datetime.ts";
import type { Tone } from "./types.ts";
import { STATUS_LABEL } from "../copy/vocab.ts";
import { currencyOfColumn, DATE_COLUMN as DATE, MONEY_COLUMN as MONEY, VALUE_CHARS, YEAR_COLUMN as YEAR } from "../config/data.ts";
import { CURRENCY, FOREIGN_MONEY_LOCALE, LOCALE } from "../config/locale.ts";

export { DATE, MONEY, STATUS_LABEL, YEAR };

/** Workspace amounts use the workspace locale and narrow symbol ($39.50); any other currency reads the international
 *  way (€1,250.00) so it is never mistaken for the workspace's own. An unknown code falls back to the bare number. */
function moneyFormat(currency: string, extra: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const own = currency === CURRENCY;
  return new Intl.NumberFormat(own ? LOCALE : FOREIGN_MONEY_LOCALE, { style: "currency", currency, currencyDisplay: own ? "narrowSymbol" : "symbol", ...extra });
}

/** Whole amounts read without minor units ($20,000); any other amount keeps them ($39.50). */
const WHOLE: Intl.NumberFormatOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

/** An amount as it reads in its currency. */
export function moneyText(n: number, currency = CURRENCY): string {
  try { return moneyFormat(currency, Number.isInteger(n) ? WHOLE : {}).format(n); } catch { return n.toLocaleString(LOCALE); }
}

/** An amount shortened for an axis or a chip: $1.2M, $340K. */
export function moneyCompact(n: number, currency = CURRENCY): string {
  try { return moneyFormat(currency, { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n); } catch { return moneyText(n, currency); }
}
/** The currency a record states for its amounts (a `currency` field holding an ISO code), if any. */
export const rowCurrency = (row: Record<string, unknown> | null | undefined): string | undefined => { const c = row?.currency ?? row?.currency_code ?? row?.ccy; return typeof c === "string" && /^[A-Z]{3}$/.test(c) ? c : undefined; };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A value as people read it. Long text is cut with an ellipsis, unless `full` (what a person confirms is shown whole). */
export function formatValue(col: string, v: unknown, o: { full?: boolean; currency?: string } = {}): string {
  if (v === null || v === undefined || v === "") return "-";
  const cur = o.currency ?? currencyOfColumn(col);
  if (typeof v === "number" && MONEY.test(col)) return moneyText(v, cur);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && MONEY.test(col)) return moneyText(Number(v), cur);
  if (typeof v === "number" && YEAR.test(col) && Number.isInteger(v)) return String(v);
  if (typeof v === "string" && /(^|_)(status|state|stage|phase)$/i.test(col)) return statusLabel(v);
  if (typeof v === "number") return v.toLocaleString(LOCALE);
  if (typeof v === "string" && DATE.test(col) && !Number.isNaN(Date.parse(v))) return dateTimeText(new Date(v), { year: true });
  if (typeof v === "object") return o.full ? JSON.stringify(v) : cut(JSON.stringify(v), VALUE_CHARS.json);
  return o.full ? String(v) : cut(String(v), VALUE_CHARS.text);
}

/** First match wins: a partial state is checked before the finished state its name contains ("partially_shipped"). */
const TONE_RULES: [RegExp, Tone][] = [
  [/(cancel|reject|fail|written_off|overdue|blocked|lost|short|missed|conflict|hold|discontinued|inactive)/i, "bad"],
  [/(open|pending|partial|picking|submitted|draft|new|waiting|progress|confirmed)/i, "warn"],
  [/(paid|delivered|done|closed|approved|resolved|executed|completed|shipped|active)/i, "good"],
];

export function toneOf(status: string): Tone {
  return TONE_RULES.find(([re]) => re.test(status))?.[1] ?? "neutral";
}

/** A known status in plain words; an unknown one at least reads as words ("partially_shipped" -> "Partially shipped"). */
export const statusLabel = (v: string) => {
  const known = STATUS_LABEL[v.trim().toLowerCase()];
  if (known) return known;
  if (!/^[a-z0-9]+(_[a-z0-9]+)+$|^[a-z]+$/.test(v.trim())) return v;
  const words = v.trim().replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
};

