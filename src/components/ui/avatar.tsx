"use client";
// A person as their initials on the accent colour.
import "./avatar.css";

export function Avatar({ name, max = 2 }: { name: string; max?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, max).map((s) => s[0]).join("").toUpperCase();
  return <span className="sp-ui-avatar" aria-hidden>{initials}</span>;
}
