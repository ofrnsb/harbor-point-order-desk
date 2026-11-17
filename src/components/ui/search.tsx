"use client";
// A search field: the icon, the words, and either a clear button or the keyboard shortcut that focuses it.
import { forwardRef, type KeyboardEvent } from "react";
import { IClose, ISearch } from "../icons";
import "./search.css";

export const SearchField = forwardRef<HTMLInputElement, {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; clearLabel: string; shortcut?: string; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void; onClear?: () => void;
}>(function SearchField({ value, onChange, placeholder, label, clearLabel, shortcut, onKeyDown, onClear }, ref) {
  return (
    <div className="sp-ui-search">
      <ISearch size={15} className="sp-ui-search-ico" />
      <input ref={ref} dir="auto" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} onKeyDown={onKeyDown} />
      {value ? (
        <button type="button" className="sp-ui-search-clear" aria-label={clearLabel} onClick={() => { onChange(""); onClear?.(); }}><IClose size={12} /></button>
      ) : shortcut ? <kbd className="sp-ui-search-kbd" aria-hidden>{shortcut}</kbd> : null}
    </div>
  );
});
