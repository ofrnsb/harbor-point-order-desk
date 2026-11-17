// What every build is held to, whatever the agent composed. A part whose data turned out empty is left out, so no
// screen carries a box that only says nothing is there; when the whole build is empty it is kept as written, because
// then the empty line is the answer. In a group of actions exactly one leads.
import { pickRows, type DataMap } from "./eval.ts";
import type { ResolvedNode } from "./resolve.ts";

const COLLECTION = new Set(["each", "table", "chart", "spark", "parts"]);
/** Bricks that show data of their own; words, dividers and actions only accompany them. */
const DATA = new Set(["figure", "stat", "bar", "ring", "status", "stamp", "decide", ...COLLECTION]);

type Kept = { node: ResolvedNode | null; data: boolean; dropped: boolean };

function trimDividers(kids: ResolvedNode[]): ResolvedNode[] {
  const out = kids.filter((k, i) => k.brick !== "divider" || (i > 0 && kids[i - 1].brick !== "divider"));
  while (out[0]?.brick === "divider") out.shift();
  while (out.at(-1)?.brick === "divider") out.pop();
  return out;
}

/** One primary per group of sibling actions: the stated one, else the first; a lone action stays quiet. */
function rankActions(kids: ResolvedNode[]): ResolvedNode[] {
  const actions = kids.filter((k) => k.brick === "action");
  if (actions.length < 2) return kids;
  const lead = actions.find((a) => a.brick === "action" && a.kind === "primary") ?? actions[0];
  return kids.map((k) => (k.brick === "action" ? { ...k, kind: k === lead ? "primary" : "secondary" } : k));
}

function prune(n: ResolvedNode, data: DataMap): Kept {
  if (COLLECTION.has(n.brick)) {
    const empty = pickRows((n as Extract<ResolvedNode, { brick: "each" }>).rows, data).rows.length === 0;
    return empty ? { node: null, data: false, dropped: true } : { node: n, data: true, dropped: false };
  }
  if (n.brick === "tabs") {
    const tabs = n.tabs.map((t) => ({ t, kids: t.children.map((c) => prune(c as ResolvedNode, data)) }))
      .filter(({ kids }) => kids.some((k) => k.data) || !kids.some((k) => k.dropped))
      .map(({ t, kids }) => ({ ...t, children: rankActions(trimDividers(kids.flatMap((k) => (k.node ? [k.node] : [])))) }))
      .filter((t) => t.children.length > 0);
    return tabs.length ? { node: { ...n, tabs } as ResolvedNode, data: true, dropped: tabs.length < n.tabs.length } : { node: null, data: false, dropped: true };
  }
  if ("children" in n) {
    const kids = n.children.map((c) => prune(c as ResolvedNode, data));
    const hasData = kids.some((k) => k.data), dropped = kids.some((k) => k.dropped);
    // Words and actions left standing around a collection that came back empty have nothing to talk about.
    if (dropped && !hasData) return { node: null, data: false, dropped: true };
    const children = rankActions(trimDividers(kids.flatMap((k) => (k.node ? [k.node] : []))));
    return children.length ? { node: { ...n, children } as ResolvedNode, data: hasData, dropped } : { node: null, data: false, dropped: true };
  }
  return { node: n, data: DATA.has(n.brick), dropped: false };
}

/** The build as it is shown. An entirely empty build comes back unpruned so its own empty line stands as the answer. */
export function shapeBuild(root: ResolvedNode, data: DataMap): ResolvedNode {
  const kept = prune(root, data);
  if (kept.node) return kept.node;
  return "children" in root ? ({ ...root, children: rankActions(root.children as ResolvedNode[]) } as ResolvedNode) : root;
}
