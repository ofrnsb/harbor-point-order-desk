import { dateTimeText } from "../lib/datetime.ts";
import type { Money } from "@/lib/types";
import { CURRENCY, CURRENCY_PREFIX, LOCALE } from "../config/locale.ts";
import { AGO } from "../config/ui.ts";
import { COMMON } from "../copy/ui-common.ts";

const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function money(p: Money | null | undefined): string {
  if (!p || !Number.isFinite(p.amount)) return "";
  const code = (p.currency ?? "").trim().toUpperCase();
  if (!code) return p.amount.toLocaleString();
  if (code === CURRENCY) return `${CURRENCY_PREFIX} ${Math.round(p.amount).toLocaleString(LOCALE)}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      ...(ZERO_DECIMAL.has(code) ? { maximumFractionDigits: 0 } : {}),
    }).format(p.amount);
  } catch {
    return `${p.amount.toLocaleString()} ${code}`;
  }
}

export function ago(iso: string, now = Date.now()): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < AGO.nowS) return COMMON.agoNow;
  if (s < AGO.hourS) return COMMON.agoMin(Math.floor(s / AGO.minuteS));
  if (s < AGO.dayS) return COMMON.agoHour(Math.floor(s / AGO.hourS));
  if (s < AGO.dayS * AGO.weekDays) return COMMON.agoDay(Math.floor(s / AGO.dayS));
  return dateTimeText(new Date(ts));
}

export function when(iso: string | null): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return dateTimeText(new Date(ts), { time: true });
}
