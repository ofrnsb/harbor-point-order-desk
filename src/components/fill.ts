"use client";
// Smart fill: when a surface ends in a scrolling list with nothing beneath it, the list takes the height that is left
// instead of stopping at its fixed cap and leaving blank space under it. The chain is found by walking last children
// down from the surface; it only passes through vertical containers, so a list beside something (in a row, grid or
// split) keeps its own height. Re-measured whenever the surface's content changes.
import { useLayoutEffect, type RefObject } from "react";

const TARGET = ".sp-ui-list";

function mark(root: HTMLElement) {
  root.querySelectorAll("[data-fill-chain], [data-fill]").forEach((el) => { el.removeAttribute("data-fill-chain"); el.removeAttribute("data-fill"); });
  const chain: HTMLElement[] = [];
  let el = root.lastElementChild as HTMLElement | null;
  while (el) {
    if (el.matches(TARGET)) {
      root.setAttribute("data-fill-chain", "");
      chain.forEach((c) => c.setAttribute("data-fill-chain", ""));
      el.setAttribute("data-fill", "");
      return;
    }
    const s = getComputedStyle(el);
    // Block flow, a flex column, or a one-column grid stack children top to bottom; anything else sets them side by side.
    const vertical = s.display === "block" || s.display === "flow-root" || ((s.display === "flex" || s.display === "inline-flex") && s.flexDirection === "column")
      || (s.display === "grid" && s.gridTemplateColumns.trim().split(/\s+/).length <= 1);
    if (!vertical) break;
    chain.push(el);
    el = el.lastElementChild as HTMLElement | null;
  }
  root.removeAttribute("data-fill-chain");
}

export function useFill(ref: RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    mark(root);
    const seen = new MutationObserver(() => mark(root));
    seen.observe(root, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, [ref, key]);
}
