"use client";
// Admin console primitives: data loading, page heads, list states, form controls (segmented, listbox select, multi pick,
// switch), and the side sheet editors open in. Native <select> is never used: the Select below is a keyboard listbox.
import { DELAY_MS, LINES_ROWS, METER } from "@/config/ui";
import { KIT } from "@/copy/ui-admin";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from "react";
import { IAlert, ICheck, IChevron, IClose, IRefresh, ISearch } from "../../icons";
import { D, EASE, FADE, REVEAL, REVEAL_STILL } from "../../motion";
import { api } from "../client";
import { Skeleton } from "@/components/ui/skeleton";

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(url);
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : KIT.loadFailed);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Runs a mutation, keeps its error, and reports success through `onDone`. */
export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : KIT.saveFailed); return null; }
    finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}

/** Content that comes and goes in the flow (notices, errors, optional fields): it opens and closes its own height,
 *  so whatever is below glides instead of jumping. Pass a falsy child to close it. */
export function Reveal({ children, id = "reveal", className, onGone, swap }: { children: React.ReactNode; id?: string; className?: string; onGone?: () => void; swap?: boolean }) {
  const still = useReducedMotion();
  const v = still ? REVEAL_STILL : REVEAL;
  return (
    // swap: a new id folds the old content shut before the new one opens, for fields that change with a choice.
    <AnimatePresence initial={false} onExitComplete={onGone} mode={swap ? "wait" : "sync"}>
      {children ? (
        // Clipped only while the height moves, so focus rings and shadows show once it has settled.
        <motion.div key={id} className={className} style={{ overflow: "hidden" }}
          initial={v.initial} animate={{ ...v.animate, transitionEnd: { overflow: "visible" } }} exit={{ ...v.exit, overflow: "hidden" }}>
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** One row of an editable list that opens and folds its height when added or removed. Key it with useRowKeys. */
export function RevealRow({ children }: { children: React.ReactNode }) {
  const still = useReducedMotion();
  const v = still ? REVEAL_STILL : REVEAL;
  return (
    <motion.div style={{ overflow: "hidden" }} initial={v.initial} animate={{ ...v.animate, transitionEnd: { overflow: "visible" } }} exit={{ ...v.exit, overflow: "hidden" }}>
      {children}
    </motion.div>
  );
}

/** Stable keys for a list edited by position (no ids), so removing row 2 folds row 2, not the last one.
 *  Call removeAt before removing the item and swap before moving one; other length changes add or drop keys at the end. */
export function useRowKeys(n: number) {
  const seq = useRef(0);
  const keys = useRef<string[]>([]);
  while (keys.current.length < n) keys.current.push(`row${seq.current++}`);
  if (keys.current.length > n) keys.current = keys.current.slice(0, n);
  return {
    keys: keys.current,
    removeAt: (i: number) => { keys.current = keys.current.filter((_, j) => j !== i); },
    /** Call before swapping two items, so each row keeps its key and glides to its new place. */
    swap: (i: number, j: number) => { const k = [...keys.current]; [k[i], k[j]] = [k[j], k[i]]; keys.current = k; },
  };
}

export function Notice({ tone = "info", children, onClose, onRetry }: { tone?: "info" | "bad" | "good" | "warn"; children: React.ReactNode; onClose?: () => void; onRetry?: () => void }) {
  return (
    <motion.div className="sp-state" data-tone={tone} role={tone === "bad" ? "alert" : "status"} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: D.d2, ease: EASE }}>
      {tone === "good" ? <ICheck size={16} /> : <IAlert size={16} />}
      <span>{children}</span>
      {onRetry && <button type="button" className="sp-link" onClick={onRetry}><IRefresh size={13} /> {KIT.retry}</button>}
      {onClose && <button type="button" className="sp-link" onClick={onClose}>{KIT.close}</button>}
    </motion.div>
  );
}

/** Loading, error, empty and no-results states for any list. Renders children only when there is something to show. */
export function ListState({ loading, error, onRetry, empty, emptyText, filtered, filterText, onClearFilter, children }: {
  loading: boolean; error: string | null; onRetry: () => void; empty: boolean; emptyText: string;
  filtered?: boolean; filterText?: string; onClearFilter?: () => void; children: React.ReactNode;
}) {
  const state = error ? "error" : loading && empty ? "loading" : empty && filtered ? "nomatch" : empty ? "empty" : "list";
  // One state on screen at a time, crossfading: skeleton, error, empty and the list never swap in a single frame.
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={state} className="sp-liststate" {...FADE}>
        {state === "error" ? <Notice tone="bad" onRetry={onRetry}>{error}</Notice>
          : state === "loading" ? <Skeleton rows={5} />
          : state === "nomatch" ? (
            <div className="sp-ad-empty">
              <ISearch size={18} />
              <span>{filterText ?? KIT.noFilterMatch}</span>
              {onClearFilter && <button type="button" className="sp-link" onClick={onClearFilter}>{KIT.clearFilter}</button>}
            </div>
          )
          : state === "empty" ? <div className="sp-ad-empty"><span>{emptyText}</span></div>
          : children}
      </motion.div>
    </AnimatePresence>
  );
}

export function Filter({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="sp-search sp-ad-filter">
      <ISearch size={15} />
      <input dir="auto" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
      {value && <button type="button" className="sp-icon-x" aria-label={KIT.clearFilter} onClick={() => onChange("")}><IClose size={13} /></button>}
    </label>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  const id = useId();
  return (
    <div className="sp-ui-stack" data-gap="s" data-wide={wide}>
      <label htmlFor={id} className="sp-ui-text" data-size="s" data-strong>{label}</label>
      <div id={`${id}-wrap`}>{withId(children, id)}</div>
      {hint && <small className="sp-ui-text" data-size="s" data-tone="muted">{hint}</small>}
    </div>
  );
}
function withId(node: React.ReactNode, id: string): React.ReactNode {
  if (isValidElement<{ id?: string }>(node) && node.props.id === undefined) return cloneElement(node, { id });
  return node;
}

export function TextInput(p: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string; maxLength?: number; autoComplete?: string; "aria-label"?: string; autoFocus?: boolean }) {
  return (
    <input id={p.id} className="sp-input" data-mono={p.mono} dir="auto" type={p.type ?? "text"} value={p.value} placeholder={p.placeholder} aria-label={p["aria-label"]} autoFocus={p.autoFocus}
      maxLength={p.maxLength} autoComplete={p.autoComplete ?? "off"} onChange={(e) => p.onChange(e.target.value)} />
  );
}

/** A value edited in place inside a row: saved when the field is left or Enter is pressed, Escape puts the old one back. */
export function InlineInput({ value, onSave, label, placeholder, disabled, maxLength }: { value: string; onSave: (v: string) => void; label: string; placeholder?: string; disabled?: boolean; maxLength?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="sp-input sp-inline" dir="auto" aria-label={label} value={v} readOnly={disabled} placeholder={placeholder} maxLength={maxLength}
    onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(value); }} />;
}

export function NumberInput(p: { id?: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string; min?: number }) {
  return (
    <input id={p.id} className="sp-input ap-num" inputMode="numeric" value={p.value == null ? "" : String(p.value)} placeholder={p.placeholder}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.]/g, "");
        p.onChange(raw === "" ? null : Math.max(p.min ?? 0, Number(raw)));
      }} />
  );
}

export function TextArea(p: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean; readOnly?: boolean }) {
  return <textarea id={p.id} className="sp-textarea" data-mono={p.mono} dir="auto" rows={p.rows ?? 4} value={p.value} placeholder={p.placeholder} readOnly={p.readOnly} spellCheck={p.mono ? false : undefined} onChange={(e) => p.onChange(e.target.value)} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="sp-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="sp-switch-track" aria-hidden><span className="sp-switch-thumb" /></span>
      <span>{label}</span>
    </button>
  );
}

export type Opt<V extends string> = { value: V; label: string; hint?: string };

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: Opt<V>[]; onChange: (v: V) => void; label: string }) {
  return (
    <div className="sp-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="sp-seg-btn" title={o.hint} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<V extends string>({ id, value, options, onChange, placeholder = KIT.pick as string, label }: { id?: string; value: V | null; options: Opt<V>[]; onChange: (v: V) => void; placeholder?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open, options, value]);
  const choose = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); btn.current?.focus(); };
  return (
    <div className="sp-select-wrap" ref={root}>
      <button
        id={id}
        ref={btn}
        type="button"
        className="sp-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) { setOpen(true); return; }
            setHi((h) => (e.key === "ArrowDown" ? Math.min(options.length - 1, h + 1) : Math.max(0, h - 1)));
          } else if (e.key === "Enter" && open) { e.preventDefault(); choose(hi); }
          else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          else if (e.key === "Home" && open) { e.preventDefault(); setHi(0); }
          else if (e.key === "End" && open) { e.preventDefault(); setHi(options.length - 1); }
        }}
      >
        <span className="sp-select-val" data-empty={!current}>{current?.label ?? placeholder}</span>
        <IChevron size={14} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            className="sp-pop sp-select-pop"
            aria-activedescendant={`${listId}-${hi}`}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: D.d1, ease: EASE } }}
            transition={{ duration: D.d2, ease: EASE }}
          >
            {options.length === 0 && <li className="sp-empty-line">{KIT.noOptions}</li>}
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                data-hi={i === hi}
                className="sp-pop-row"
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              >
                <span className="sp-pop-main"><strong>{o.label}</strong>{o.hint && <small>{o.hint}</small>}</span>
                {o.value === value && <ICheck size={15} className="sp-pop-check" />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MultiPick<V extends string>({ values, options, onChange, label }: { values: V[]; options: Opt<V>[]; onChange: (v: V[]) => void; label: string }) {
  const set = new Set(values);
  return (
    <div className="sp-multi" role="group" aria-label={label}>
      {options.length === 0 && <span className="sp-empty-line">{KIT.noChoicesYet}</span>}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={set.has(o.value)} className="sp-multi-btn" title={o.hint}
          onClick={() => onChange(set.has(o.value) ? values.filter((v) => v !== o.value) : [...values, o.value])}>
          <span className="sp-multi-check" aria-hidden><ICheck size={13} /></span>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Editable list of strings, one per line. */
export function Lines({ id, value, onChange, placeholder }: { id?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join("\n"));
  useEffect(() => { setText(value.join("\n")); }, [value]);
  return <textarea id={id} className="sp-textarea" dir="auto" rows={Math.min(LINES_ROWS.max, Math.max(LINES_ROWS.min, value.length + 1))} value={text} placeholder={placeholder}
    onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split("\n").map((s) => s.trim()).filter(Boolean))} />;
}

export function Sheet({ open, title: liveTitle, sub: liveSub, onClose, children: liveChildren, footer: liveFooter }: { open: boolean; title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers clear their draft as they close; the sheet keeps showing what it last showed until it has slid away.
  const last = useRef({ title: liveTitle, sub: liveSub, children: liveChildren, footer: liveFooter });
  if (open) last.current = { title: liveTitle, sub: liveSub, children: liveChildren, footer: liveFooter };
  const { title, sub, children, footer } = last.current;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input, textarea, button:not(.sp-sheet-x)")?.focus(), DELAY_MS.focusSheet);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { clearTimeout(t); document.removeEventListener("keydown", key); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="sp-sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: D.d2, ease: EASE }} onClick={onClose} />
          <motion.div key="sheet" ref={ref} className="sp-sheet" role="dialog" aria-modal="true" aria-label={title}
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0, transition: { duration: D.d2, ease: EASE } }} transition={{ duration: D.d3, ease: EASE }}>
            <header className="sp-sheet-head">
              <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
              <button type="button" className="sp-ui-btn sp-sheet-x" data-tone="ghost" aria-label={KIT.close} onClick={onClose}><IClose size={15} />{KIT.close}</button>
            </header>
            <div className="sp-sheet-body">{children}</div>
            {footer && <footer className="sp-sheet-foot">{footer}</footer>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function SaveBar({ busy, error, onSave, onCancel, label = KIT.save as string, danger }: { busy: boolean; error: string | null; onSave: () => void; onCancel: () => void; label?: string; danger?: React.ReactNode }) {
  return (
    <div className="sp-ui-stack" data-gap="s">
      <Reveal id="savebar-err">{error && <p className="sp-ui-text" data-size="s" data-tone="bad" role="alert">{error}</p>}</Reveal>
      <div className="sp-ui-row" data-gap="s" data-align="center">
        {danger}
        <span className="sp-ui-grow" />
        <button type="button" className="sp-ui-btn" data-tone="ghost" onClick={onCancel}>{KIT.cancel}</button>
        <button type="button" className="sp-ui-btn" data-tone="primary" disabled={busy} onClick={onSave}>{busy ? KIT.saving : label}</button>
      </div>
    </div>
  );
}

export function Bar({ value, max, tone }: { value: number; max: number; tone?: "ok" | "warn" | "bad" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const t = tone ?? (pct >= METER.badPct ? "bad" : pct >= METER.warnPct ? "warn" : "ok");
  return (
    <span className="sp-meter-track" aria-hidden>
      <motion.span className="sp-meter-fill" data-tone={t} initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }} transition={{ duration: D.d4, ease: EASE }} />
    </span>
  );
}
