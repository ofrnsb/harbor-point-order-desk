"use client";
// Entrances play where they are seen: a panel below the fold holds its animations until it scrolls into view, then
// plays them once. Without this script nothing is held, so every panel simply appears.
import { useEffect } from "react";

export const REVEAL_SELECTOR = ".sp-ui-section, .ap-brick-surface";

export function Reveal() {
  useEffect(() => {
    const root = document.documentElement;
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { (e.target as HTMLElement).dataset.seen = ""; seen.unobserve(e.target); }
    }, { threshold: 0.12 });
    const watch = (scope: ParentNode) => scope.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((el) => { if (!("seen" in el.dataset)) seen.observe(el); });
    watch(document);
    const added = new MutationObserver((list) => {
      for (const m of list) m.addedNodes.forEach((n) => { if (n instanceof HTMLElement) { if (n.matches(REVEAL_SELECTOR) && !("seen" in n.dataset)) seen.observe(n); watch(n); } });
    });
    added.observe(document.body, { childList: true, subtree: true });
    root.dataset.reveal = "";
    return () => { seen.disconnect(); added.disconnect(); delete root.dataset.reveal; };
  }, []);
  return null;
}
