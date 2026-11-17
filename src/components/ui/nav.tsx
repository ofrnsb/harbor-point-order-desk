"use client";
// Navigation in the sidebar: a titled section with an optional add action, items that pick a context (an agent, a
// project, a board), compact rows for a long history, and the product mark at the top. Every item is one fixed height.
import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { SPRING } from "../motion";
import "./nav.css";

/** A sidebar section: its title, an optional action beside it (New), and its items. */
/** `action` is one button beside the title; `actions` puts any control there instead (a menu of choices). */
export function NavSection({ title, action, actions, label, children }: {
  title?: ReactNode; label?: string; children: ReactNode;
  action?: { label: ReactNode; icon?: ReactNode; onClick: () => void; disabled?: boolean };
  actions?: ReactNode;
}) {
  return (
    <section className="sp-ui-nav" aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      {(title || action || actions) && (
        <div className="sp-ui-nav-head">
          {title && <h3 className="sp-ui-nav-title">{title}</h3>}
          {action && <button type="button" className="sp-ui-nav-add" onClick={action.onClick} disabled={action.disabled}>{action.icon}{action.label}</button>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A group title inside a section (In this project, Today); it can animate as groups appear and empty. */
export const NavGroup = forwardRef<HTMLHeadingElement, HTMLMotionProps<"h4">>(function NavGroup({ children, ...rest }, ref) {
  return <motion.h4 ref={ref} className="sp-ui-nav-group" {...rest}>{children as ReactNode}</motion.h4>;
});

/** The items of a section, one under another. Children are list items (plain or animated). */
export const NavList = ({ children }: { children: ReactNode }) => <ul className="sp-ui-nav-list">{children}</ul>;

/**
 * One context to pick: a mark (an icon or a letter), a title and a quieter line, the current one lifted. `tool` sits on the
 * item's end edge (Edit) and stays a separate button.
 */
export function NavItem({ mark, title, sub, active, onClick, hint, tool }: {
  mark: ReactNode; title: ReactNode; sub?: ReactNode; active?: boolean; onClick: () => void; hint?: string; tool?: ReactNode;
}) {
  return (
    <div className="sp-ui-nav-item" data-tool={tool ? true : undefined}>
      <button type="button" className="sp-ui-nav-pick" data-active={active || undefined} aria-current={active || undefined} onClick={onClick} title={hint}>
        <span className="sp-ui-nav-mark" aria-hidden>{mark}</span>
        <span className="sp-ui-nav-text"><strong dir="auto">{title}</strong>{sub && <small dir="auto">{sub}</small>}</span>
      </button>
      {tool}
    </div>
  );
}

/** A small labelled button on an item's edge (Edit). */
export function NavTool({ icon, label, aria, onClick, expanded }: { icon: ReactNode; label: ReactNode; aria: string; onClick: () => void; expanded?: boolean }) {
  return <button type="button" className="sp-ui-nav-tool" aria-label={aria} aria-expanded={expanded} onClick={onClick}>{icon}<span>{label}</span></button>;
}

/**
 * A compact row for a long list (the conversation history): title, a quiet time, and tools that show on hover or focus.
 * The current row carries a highlight that glides between rows (`glide` names the shared layout).
 */
export const NavRow = forwardRef<HTMLDivElement, HTMLMotionProps<"div"> & { active?: boolean; pinned?: boolean; flash?: boolean; glide: string }>(
  function NavRow({ active, pinned, flash, glide, children, ...rest }, ref) {
    return (
      <motion.div ref={ref} className="sp-ui-nav-row" data-active={active || undefined} data-pinned={pinned || undefined} data-flash={flash || undefined} {...rest}>
        {active && <motion.span layoutId={glide} className="sp-ui-nav-hl" transition={SPRING} />}
        {children as ReactNode}
      </motion.div>
    );
  },
);

/** Parts of a compact row: its title, its quiet time, and the tools that replace the time on hover. */
export const NavRowTitle = ({ children, title }: { children: ReactNode; title?: string }) => <span className="sp-ui-nav-row-title" title={title} dir="auto">{children}</span>;
export const NavRowTime = ({ children }: { children: ReactNode }) => <span className="sp-ui-nav-row-time ap-num">{children}</span>;
export const NavRowTools = ({ children }: { children: ReactNode }) => <span className="sp-ui-nav-row-tools">{children}</span>;
export function NavRowTool({ icon, label, title, on, onClick }: { icon: ReactNode; label: string; title: string; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="sp-ui-nav-row-tool" data-on={on || undefined} title={title} aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }}>{icon}</button>
  );
}

/** A compact row being renamed: the title becomes an input; Enter or leaving keeps it, Escape cancels. */
export function NavRowInput({ value, onChange, onDone, onCancel, label, maxLength }: { value: string; onChange: (v: string) => void; onDone: () => void; onCancel: () => void; label: string; maxLength: number }) {
  return (
    <motion.input initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="sp-ui-nav-row-input" dir="auto" autoFocus value={value} maxLength={maxLength} aria-label={label}
      onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value)} onBlur={onDone}
      onKeyDown={(e) => { if (e.key === "Enter") onDone(); if (e.key === "Escape") onCancel(); }} />
  );
}

/** A compact row asking to confirm a removal in place. */
export function NavRowConfirm({ question, yes, no, onYes, onNo }: { question: string; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return (
    <motion.span className="sp-ui-nav-row-confirm" initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} onClick={(e) => e.stopPropagation()}>
      <span>{question}</span>
      <button type="button" data-danger autoFocus onClick={onYes}>{yes}</button>
      <button type="button" onClick={onNo}>{no}</button>
    </motion.span>
  );
}

/** The product at the top of the sidebar: its mark, name and line, with an optional control (close) at the end. */
export function NavBrand({ mark, name, sub, end }: { mark: ReactNode; name: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  return (
    <div className="sp-ui-nav-brand">
      <span className="sp-ui-nav-brand-mark">{mark}</span>
      <span className="sp-ui-nav-brand-text"><strong>{name}</strong>{sub && <small>{sub}</small>}</span>
      {end}
    </div>
  );
}

/** A padded strip in the sidebar for a control that is not an item (search, the New conversation button). */
export const NavPad = ({ children }: { children: ReactNode }) => <div className="sp-ui-nav-pad">{children}</div>;

/** The sidebar's main action: an accent mark and a label, full width. */
export function NavAction({ icon, children, onClick, disabled }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="sp-ui-nav-action" onClick={onClick} disabled={disabled}><span className="sp-ui-nav-action-mark" aria-hidden>{icon}</span>{children}</button>;
}

/** The scrolling part of a sidebar that holds a long list. */
export const NavScroll = forwardRef<HTMLDivElement, { children: ReactNode }>(function NavScroll({ children }, ref) {
  return <div ref={ref} className="sp-ui-nav-scroll">{children}</div>;
});
