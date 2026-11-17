// Numbered steps toward a goal (setting up a company): each opens where it is done; a finished step is ticked, not hidden.
import { ICheck } from "@/components/icons";
import "./steps.css";

export function Steps({ items, label }: { items: { href: string; title: string; text: string; done: boolean }[]; label: string }) {
  return (
    <ol className="sp-ui-steps" aria-label={label}>
      {items.map((s, i) => (
        <li key={s.href} style={{ ["--sp-ui-i" as string]: String(i) }}>
          <a href={s.href} data-done={s.done || undefined}>
            <span className="sp-ui-steps-n ap-num" aria-hidden>{s.done ? <ICheck size={14} /> : i + 1}</span>
            <span className="sp-ui-steps-text"><strong dir="auto">{s.title}</strong><small dir="auto">{s.text}</small></span>
          </a>
        </li>
      ))}
    </ol>
  );
}
