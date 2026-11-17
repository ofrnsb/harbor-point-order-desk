"use client";
// A group of form controls that can be made read-only at once: disabled, every control inside it is disabled.
import type { ReactNode } from "react";
import "./fieldset.css";

export const Fieldset = ({ disabled, children }: { disabled?: boolean; children: ReactNode }) => <fieldset className="sp-ui-fieldset" disabled={disabled}>{children}</fieldset>;
