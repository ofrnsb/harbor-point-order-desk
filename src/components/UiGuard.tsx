"use client";
import { REVEAL_SELECTOR } from "./Reveal";
import { CAP, DELAY_MS, GUARD, MEDIA } from "@/config/ui";
import { API } from "@/config/routes";
import { DEV } from "@/copy/ui-dev";
import { useEffect } from "react";

type Issue = { label: string; problem: string };
const opacityOf = (el: Element | null) => { let o = 1; for (; el; el = el.parentElement) o *= Number(getComputedStyle(el).opacity); return o; };

function check(): Issue[] {
  const issues: Issue[] = [];
  document.querySelectorAll<HTMLElement>("[data-guard]").forEach((el) => {
    const label = el.dataset.guardLabel ?? `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (el.closest(".ap-rail-slot[data-open='false']") && window.matchMedia(MEDIA.mobile).matches) return; // drawer closed on purpose
    if (el.closest("[inert]")) return; // folded away on purpose (the docked rail when the person hides it)
    const modal = document.querySelector("[aria-modal='true']");
    if (modal && !modal.contains(el)) return; // behind an open dialog on purpose
    if ("reveal" in document.documentElement.dataset && el.closest(`:is(${REVEAL_SELECTOR}):not([data-seen])`)) return; // entrance held until it scrolls into view
    if (cs.visibility !== "visible" || cs.display === "none" || opacityOf(el) === 0)
      issues.push({ label, problem: DEV.guard.hidden(cs.visibility, cs.display, opacityOf(el)) });
    else if (r.width === 0 || r.height === 0) issues.push({ label, problem: DEV.guard.zero });
    else if (el.dataset.guard === "clickable" && r.bottom > 0 && r.top < innerHeight) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      // A full-screen board covers the app on purpose; what it covers is not a bug.
      if (top && !el.contains(top) && !top.contains(el) && !top.closest(".sp-wb[data-full]")) issues.push({ label, problem: DEV.guard.covered(top.tagName.toLowerCase(), String(top.className).split(" ")[0]) });
    }
  });
  return [...issues, ...layout()].slice(0, CAP.guardIssues);
}

const nameOf = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
const where = (el: Element) => (el.closest(".sp-ui-section")?.querySelector(".sp-ui-section-head")?.textContent ?? "").trim().slice(0, 40);

/** Answer blocks placed right: nothing runs past the box that holds it, and a list's trailing values line up. */
function layout(): Issue[] {
  const out: Issue[] = [];
  const skip = (el: Element) => !!el.closest("svg");
  let seen = 0;
  for (const el of document.querySelectorAll<HTMLElement>(".sp-ui-section *, .sp-file *")) {
    if (++seen > GUARD.layoutNodes || out.length >= CAP.guardIssues) break;
    const p = el.parentElement;
    if (!p || skip(el)) continue;
    const cs = getComputedStyle(el), ps = getComputedStyle(p);
    if (cs.display === "none" || /absolute|fixed/.test(cs.position) || /hidden|auto|scroll|clip/.test(ps.overflowX)) continue;
    // Words wider than their own box spill out of it unseen by a box-to-box check.
    if (cs.overflowX === "visible" && el.childElementCount <= 1 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + GUARD.layoutSlackPx && el.textContent?.trim()) {
      out.push({ label: `${nameOf(el)} (${where(el)})`, problem: DEV.guard.spill(el.scrollWidth - el.clientWidth) });
      continue;
    }
    const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
    if (r.width && pr.width && r.right > pr.right + GUARD.layoutSlackPx) out.push({ label: `${nameOf(el)} (${where(el)})`, problem: DEV.guard.overflow(Math.round(r.right - pr.right), nameOf(p)) });
  }
  // Parts side by side never paint over each other (a row whose parts are grid cells has no box of its own to overflow).
  for (const row of document.querySelectorAll<HTMLElement>(".sp-ui-section .sp-ui-row, .sp-file .sp-ui-row")) {
    if (skip(row) || out.length >= CAP.guardIssues) continue;
    const parts = [...row.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width && r.height);
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1], b = parts[i];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > GUARD.layoutSlackPx && h > GUARD.layoutSlackPx) { out.push({ label: `${nameOf(row)} (${where(row)})`, problem: DEV.guard.overlap(i, Math.round(w)) }); break; }
    }
  }
  for (const ul of document.querySelectorAll<HTMLElement>(".sp-ui-section .sp-ui-list")) {
    if (skip(ul)) continue;
    const rows = [...ul.children].map((li) => li.querySelector(".sp-ui-row")).filter((r): r is Element => !!r && r.children.length > 1);
    const ends = new Set(rows.map((r) => Math.round(r.lastElementChild!.getBoundingClientRect().right)));
    if (rows.length > 1 && new Set(rows.map((r) => r.children.length)).size === 1 && ends.size > 1) out.push({ label: `ul.sp-ui-list (${where(ul)})`, problem: DEV.guard.misaligned(ends.size) });
  }
  return out;
}

// Installed when the module loads, before React renders anything: warnings from the first render (duplicate keys,
// bad props) are logged before any effect runs, and an effect-installed hook would miss them.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && !(window as { __uiGuard?: boolean }).__uiGuard) {
  (window as { __uiGuard?: boolean }).__uiGuard = true;
  const send = (message: string) => fetch(API.uiGuard, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: location.pathname, error: { at: new Date().toISOString(), message: `[${location.pathname}] ${message}`.slice(0, GUARD.messageMax) } }) }).catch(() => {});
  window.addEventListener("error", (e) => send(`${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => send(DEV.guard.rejection(String(e.reason))));
  const original = console.error;
  // React passes the message as a format string with %s holes; fill them so the report reads like the console.
  console.error = (...args: unknown[]) => {
    original(...args);
    const [first, ...rest] = args.map(String);
    if (first.startsWith("[ui-guard]")) return;
    let i = 0;
    send(first.replace(/%[sdo]/g, () => rest[i++] ?? "") + (rest.length > i ? ` ${rest.slice(i).join(" ")}` : ""));
  };
}

/** Dev only: reports hidden or covered key elements and browser runtime errors to /api/ui-guard. */
export function UiGuard() {

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let t: ReturnType<typeof setTimeout>;
    const run = () => {
      // A background tab does not run animations, so every entrance still sits at opacity 0: check once it is seen.
      if (document.visibilityState !== "visible") return;
      const issues = check();
      if (issues.length) console.warn("[ui-guard]", issues);
      fetch(API.uiGuard, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: location.pathname, at: new Date().toISOString(), issues }) }).catch(() => {});
    };
    const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(run, DELAY_MS.guardFirst); });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    t = setTimeout(run, DELAY_MS.guardSecond);
    const seen = () => { clearTimeout(t); t = setTimeout(run, DELAY_MS.guardSecond); };
    document.addEventListener("visibilitychange", seen);
    return () => { obs.disconnect(); clearTimeout(t); document.removeEventListener("visibilitychange", seen); };
  }, []);
  return null;
}
