// Server side of the bricks: checks every ref, column and placeholder against the rows the tools really returned,
// and attaches the data the browser needs. A problem stops the answer with
// a reason the agent can fix, never a half-broken screen.
import type { Block, Result, RowsResult } from "../types.ts";
import { colOf, refOf, type Dataset, type DataMap } from "./eval.ts";
import { MAX_DEPTH, MAX_NODES, type BataInput, type Node, type RowsRef, type Text, type Val } from "./schema.ts";
import { ERR } from "../../copy/server.ts";

import { shapeBuild } from "./shape.ts";

const BOUND = new Set(["figure", "stat", "bar", "ring", "spark", "each", "table", "chart", "decide", "parts"]);

export type Registry = { get(id: string): unknown };
export type ResolvedNode = Node;

const isRows = (x: unknown): x is RowsResult => !!x && typeof x === "object" && (x as Result).kind === "rows";

export function resolveBata(input: BataInput, reg: Registry): { block?: Extract<Block, { type: "bata" }>; problems: string[] } {
  const problems: string[] = [];
  const data: DataMap = {};
  let count = 0;

  const useRows = (r: RowsRef, where: string): Dataset | null => {
    const id = refOf(r);
    const res = reg.get(id);
    if (!isRows(res)) { problems.push(ERR.notRowsResultUse(where, id)); return null; }
    const ds: Dataset = data[id] ?? { title: res.title, columns: res.columns, rows: res.rows, ...(res.open ? { open: res.open } : {}) };
    data[id] = ds;
    if (typeof r !== "string") {
      for (const c of r.where ?? []) if (!colOf(ds, c.col)) problems.push(ERR.filterColumnNot(where, c.col, id));
      if (r.sort && !colOf(ds, r.sort.by)) problems.push(ERR.sortColumnNot2(where, r.sort.by, id));
    }
    return ds;
  };
  const needCol = (ds: Dataset | null, name: string, where: string) => {
    if (!ds) problems.push(ERR.boundOutsideAnyRows(where, name));
    else if (!colOf(ds, name)) problems.push(ERR.columnNotThisData(where, name, ds.columns.map((c) => c.name).join(", ")));
  };
  const checkVal = (v: Val, ds: Dataset | null, where: string): void => {
    if ("bind" in v) return needCol(ds, v.bind, where);
    if ("agg" in v) {
      const src = v.rows ? useRows(v.rows, where) : ds;
      if (!src) { if (!v.rows) problems.push(ERR.needsRowsGiveRows(where, v.agg)); return; }
      if (v.of) needCol(src, v.of, where);
      else if (!["count", "first", "last"].includes(v.agg)) problems.push(ERR.needsColumn2(where, v.agg, v.agg));
      return;
    }
    checkVal(v.a, ds, where); checkVal(v.b, ds, where);
  };
  const checkText = (t: Text | undefined, ds: Dataset | null, where: string) => {
    if (t === undefined) return;
    if (typeof t !== "string") return checkVal(t, ds, where);
    for (const m of t.matchAll(/\{([a-z0-9_]+)\}/gi)) needCol(ds, m[1], `${where} text`);
  };

  const walk = (n: Node, ds: Dataset | null, depth: number, path: string): ResolvedNode => {
    if (++count > MAX_NODES) { if (count === MAX_NODES + 1) problems.push(ERR.tooManyBricksMax(MAX_NODES)); return n; }
    if (depth > MAX_DEPTH) { problems.push(ERR.nestedTooDeepMax(path, MAX_DEPTH)); return n; }
    const at = `${path}/${n.brick}`;
    switch (n.brick) {
      case "stack": case "row": case "grid": case "split": case "section": {
        const inner = n.rows ? useRows(n.rows, at) : ds;
        if (n.brick === "section") { checkText(n.title, inner, at); checkText(n.note, inner, at); }
        return { ...n, children: n.children.map((c, i) => walk(c, inner, depth + 1, `${at}[${i}]`)) } as ResolvedNode;
      }
      case "tabs": return { ...n, tabs: n.tabs.map((t, i) => ({ ...t, children: t.children.map((c, k) => walk(c, ds, depth + 1, `${at}[${i}][${k}]`)) })) } as ResolvedNode;
      case "divider": return n;
      case "heading": case "text": case "callout": case "badge":
        checkText(n.text, ds, at); if (n.brick === "callout") checkText(n.title, ds, at); return n;
      case "figure": checkVal(n.value, ds, at); if (n.delta) checkVal(n.delta, ds, at); checkText(n.label, ds, at); checkText(n.note, ds, at); return n;
      case "stat": checkText(n.label, ds, at); checkText(n.value as Text, ds, at); return n;
      case "ring": checkVal(n.value, ds, at); if (n.max) checkVal(n.max, ds, at); checkText(n.label, ds, at); checkText(n.note, ds, at); return n;
      case "bar": checkVal(n.value, ds, at); if (n.max) checkVal(n.max, ds, at); if (n.target) checkVal(n.target, ds, at); checkText(n.label, ds, at); return n;
      case "avatar": checkText(n.name, ds, at); return n;
      case "parts": { const d = useRows(n.rows, at); needCol(d, n.label, at); needCol(d, n.value, at); const c = colOf(d, n.value); if (c && c.type !== "number") problems.push(ERR.chartValueNotNumber(at, n.value)); return n; }
      case "status": case "stamp": checkText(n.value as Text, ds, at); if (n.brick === "stamp") checkText(n.meta, ds, at); return n;
      case "spark": { const d = useRows(n.rows, at); needCol(d, n.x, at); needCol(d, n.y, at); return n; }
      case "each": {
        const d = useRows(n.rows, at);
        if (n.group_by) needCol(d, n.group_by, at);
        return { ...n, item: walk(n.item, d, depth + 1, `${at}.item`) } as ResolvedNode;
      }
      case "table": {
        const d = useRows(n.rows, at);
        n.columns.forEach((c, i) => checkText(c.value as Text, d, `${at}.columns[${i}]`));
        return n;
      }
      case "chart": {
        const d = useRows(n.rows, at);
        needCol(d, n.x, at);
        for (const m of n.marks) {
          needCol(d, m.y, at);
          const c = colOf(d, m.y);
          if (c && c.type !== "number") problems.push(ERR.chartValueNotNumber(at, m.y));
        }
        return n;
      }
      case "action":
        checkText(n.label, ds, at); checkText(n.send, ds, at);
        if (!n.send && !n.open) problems.push(ERR.actionNeedsSendNext(at));
        if (n.open && !ds?.open) problems.push(ERR.openNeedsRowsThat(at));
        return n;
      case "decide": needCol(ds, n.work, at); if (n.ref) needCol(ds, n.ref, at); return n;
    }
  };

  const root = walk(input.root, null, 0, "root");
  // Figures belong in bound bricks: a build made only of words that carry several numbers is a table typed by hand.
  const flat: ResolvedNode[] = [];
  const collect = (n: ResolvedNode) => { flat.push(n); if ("children" in n) n.children.forEach((c) => collect(c as ResolvedNode)); if (n.brick === "tabs") n.tabs.forEach((t) => t.children.forEach((c) => collect(c as ResolvedNode))); if (n.brick === "each") collect(n.item as ResolvedNode); };
  collect(root);
  const bound = flat.some((n) => BOUND.has(n.brick));
  const typed = flat.filter((n) => (n.brick === "text" || n.brick === "heading") && typeof n.text === "string" && (n.text.match(/\d[\d.,]*/g)?.length ?? 0) >= 3).length;
  if (!bound && typed >= 3) problems.push(ERR.typedNumbers);
  if (problems.length) return { problems };
  return { block: { type: "bata", title: input.title, where: input.where ?? "canvas", root: shapeBuild(root, data), data }, problems };
}
