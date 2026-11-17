// Machine text shown as it is: JSON, a statement, a key. Scrolls inside a fixed height, never stretches the page.
import type { ReactNode } from "react";
import "./code.css";

export function Code({ children }: { children: ReactNode }) {
  return <pre className="sp-ui-code" translate="no">{children}</pre>;
}
