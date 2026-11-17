"use client";
// Client helpers shared by the workspace and the admin console: JSON fetch with session handling, formatting, storage.
import { dateTimeText } from "@/lib/datetime";
import { numFmt } from "@/config/locale";
import { AGO } from "@/config/ui";
import { API, PAGES } from "@/config/routes";
import { CLIENT, LABELS } from "@/copy/ui-labels";

export class ApiFail extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Fetch JSON from the platform API. A 401 sends the browser to the sign-in page. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (err) {
    // A network failure surfaces as the browser's own words ("Load failed", "Failed to fetch"); say it in the product's.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiFail(CLIENT.unreachable, 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string; problems?: string[] }) | null;
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith(PAGES.signIn)) {
    window.location.assign(`${PAGES.signIn}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  if (!res.ok) {
    const problems = body && Array.isArray(body.problems) ? ` ${body.problems.join(" ")}` : "";
    throw new ApiFail(`${body?.error ?? CLIENT.requestFailed(res.status)}${problems}`, res.status);
  }
  return body as T;
}

/** Sends the browser to first-run setup when the installation has no company yet. Returns true when it redirected. */
export async function redirectIfSetupNeeded(): Promise<boolean> {
  try {
    const r = await fetch(API.setup, { cache: "no-store" });
    if (!r.ok) return false;
    const j = (await r.json()) as { needed?: boolean };
    if (j.needed) { window.location.assign(PAGES.setup); return true; }
  } catch { /* setup check is best effort; the session check below still runs */ }
  return false;
}

const nf = { format: (v: number) => numFmt().format(v) };
export const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : nf.format(n));


export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return dateTimeText(new Date(t), { time: true });
}

export function agoId(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < AGO.nowS) return CLIENT.agoNow;
  if (s < AGO.hourS) return CLIENT.agoMin(Math.floor(s / AGO.minuteS));
  if (s < AGO.dayS) return CLIENT.agoHour(Math.floor(s / AGO.hourS));
  if (s < AGO.dayS * AGO.weekDays) return CLIENT.agoDay(Math.floor(s / AGO.dayS));
  return dateTimeText(new Date(t));
}

export const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* private mode */ }
  },
};

export const ROLE_LABEL = LABELS.role;
export const PLATFORM_ROLE_LABEL = LABELS.platformRole;
export const SENS_LABEL = LABELS.sensitivity;
export const MODE_LABEL = LABELS.mode;
export const KIND_SHORT = LABELS.kindShort;
export const STATE_LABEL = LABELS.state;
export const STATE_TONE: Record<string, "neutral" | "good" | "warn" | "bad" | "info"> = {
  awaiting_confirm: "info", awaiting_approval: "warn", executing: "info", executed: "good", rejected: "bad", cancelled: "neutral", failed: "bad",
};
