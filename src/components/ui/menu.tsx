"use client";
// A button that opens a small panel of choices (a team list, an account menu). The panel closes on a click outside,
// on Escape, and after a choice; it opens from the trigger's end edge unless `align="start"`.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { D, EASE } from "../motion";
import { ICheck } from "../icons";
import "./menu.css";

const pop = {
  initial: { opacity: 0, y: -6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: D.d1, ease: EASE } },
  transition: { duration: D.d2, ease: EASE },
};

export function Menu({ trigger, children, label, role = "menu", align = "end", grow }: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  label?: string; role?: "menu" | "listbox"; align?: "start" | "end"; grow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  // The panel never runs past the area that clips it (a rail, a panel) or the screen: it slides back inside.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.removeProperty("--sp-ui-menu-shift"); el.style.removeProperty("max-width");
    let box = { left: 0, right: window.innerWidth };
    // Every clipping ancestor counts: the panel has to fit inside all of them.
    for (let a = el.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (/hidden|auto|scroll|clip/.test(o.overflowX)) { const r = a.getBoundingClientRect(); box = { left: Math.max(box.left, r.left), right: Math.min(box.right, r.right) }; }
    }
    const edge = 8;
    // Narrower than its area when the area is narrow (a rail), then moved inside it.
    el.style.maxWidth = `${Math.round(box.right - box.left - edge * 2)}px`;
    // Measured from the trigger, not the panel: the panel is still scaling in and its box is not its resting box.
    const w = root.current!.getBoundingClientRect(), width = el.offsetWidth;
    const left = align === "start" ? w.left : w.right - width, right = left + width;
    const shift = left < box.left + edge ? box.left + edge - left : right > box.right - edge ? box.right - edge - right : 0;
    if (shift) el.style.setProperty("--sp-ui-menu-shift", `${Math.round(shift)}px`);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [open, align]);
  return (
    <div className="sp-ui-menu-wrap" ref={root} data-grow={grow || undefined}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      <AnimatePresence>
        {open && (
          <motion.div ref={panel} className="sp-ui-menu" data-align={align} role={role} aria-label={label} {...pop}>
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The quiet line naming what the menu chooses. */
export const MenuTitle = ({ children }: { children: ReactNode }) => <div className="sp-ui-menu-title">{children}</div>;

/** One choice: a title with an optional line under it, an icon before and a badge after; `selected` marks the current one. */
export function MenuItem({ title, sub, icon, after, selected, href, onClick, disabled, role = "menuitem" }: {
  title: ReactNode; sub?: ReactNode; icon?: ReactNode; after?: ReactNode; selected?: boolean; href?: string; onClick?: () => void; disabled?: boolean; role?: "menuitem" | "option";
}) {
  const body = (
    <>
      {icon}
      <span className="sp-ui-menu-main"><strong dir="auto">{title}</strong>{sub && <small dir="auto">{sub}</small>}</span>
      {after}
      {selected && <ICheck size={15} className="sp-ui-menu-check" />}
    </>
  );
  return href
    ? <a className="sp-ui-menu-item" role={role} href={href}>{body}</a>
    : <button type="button" className="sp-ui-menu-item" role={role} aria-selected={role === "option" ? !!selected : undefined} onClick={onClick} disabled={disabled}>{body}</button>;
}

/** A block of facts at the top of a menu (who is signed in). */
export const MenuCard = ({ children }: { children: ReactNode }) => <div className="sp-ui-menu-card">{children}</div>;

/** The lifted button that opens a menu and shows the current choice. */
export function MenuTrigger({ open, onClick, disabled, title, popup = "menu", quiet, children }: {
  open: boolean; onClick: () => void; disabled?: boolean; title?: string; popup?: "menu" | "listbox"; quiet?: boolean; children: ReactNode;
}) {
  return (
    <button type="button" className="sp-ui-menu-trigger" data-quiet={quiet || undefined} aria-haspopup={popup} aria-expanded={open} disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
