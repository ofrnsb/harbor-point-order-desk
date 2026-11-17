// Choosing among a few options. ChoiceGroup: one of them, each in its own tone (a sensitivity, a risk), with the option
// the platform only suggested drawn dashed. CheckList: several of many, each with a line on what it is.
import type { ReactNode } from "react";
import { ICheck } from "@/components/icons";
import type { Tone } from "./index";
import "./choice.css";

export function ChoiceGroup<V extends string>({ value, options, onChange, label, disabled, suggested, selectedTitle }: {
  value: V; options: { value: V; label: string; tone?: Tone }[]; onChange: (v: V) => void; label: string; disabled?: boolean;
  /** The current value is the platform's suggestion, not a person's choice yet. */ suggested?: boolean;
  /** Says where the current value came from (suggested, or set by an admin). */ selectedTitle?: string;
}) {
  return (
    <span className="sp-ui-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} data-tone={o.tone ?? "neutral"} data-suggested={value === o.value && suggested ? true : undefined}
          title={value === o.value ? selectedTitle : undefined} disabled={disabled} onClick={() => value !== o.value && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function CheckList<V extends string>({ values, options, onToggle, label }: {
  values: V[]; options: { value: V; label: string; line?: ReactNode; warn?: boolean }[]; onToggle: (v: V) => void; label: string;
}) {
  return (
    <ul className="sp-ui-checklist" role="group" aria-label={label}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <li key={o.value}>
            <button type="button" aria-pressed={on} data-warn={o.warn || undefined} onClick={() => onToggle(o.value)}>
              <span className="sp-ui-checklist-box" aria-hidden>{on && <ICheck size={12} />}</span>
              <span className="sp-ui-checklist-text"><strong translate="no">{o.label}</strong>{o.line && <small dir="auto">{o.line}</small>}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
