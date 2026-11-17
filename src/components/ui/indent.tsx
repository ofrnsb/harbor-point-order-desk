// A place in a tree: indented by depth, with an elbow that ties a child to the row above.
import type { ReactNode } from "react";
import "./indent.css";

export function Indent({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div className="sp-ui-indent" style={{ ["--sp-ui-depth" as string]: String(Math.max(0, depth)) }}>
      {depth > 0 && <span className="sp-ui-indent-elbow" aria-hidden />}
      <div className="sp-ui-indent-body">{children}</div>
    </div>
  );
}
