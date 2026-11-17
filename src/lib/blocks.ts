// The agent's `present` call, validated and resolved against results the tools really produced.
// The model only passes ids and short labels; every value shown comes from tool data.
import { z } from "zod";
import type { Action, Block, Column, FormField, Result, RowsResult } from "./types.ts";
import { legoByName, legoInputs } from "./lego/index.ts";
import { pageSize } from "./lego/contract.ts";
import { BataInput } from "./bata/schema.ts";
import { resolveBata } from "./bata/resolve.ts";
import { COUNT, LEN } from "../config/data.ts";
import { ERR, WORDS } from "../copy/server.ts";
import { HINT } from "../copy/agent.ts";

const id = z.string().min(1).max(LEN.id);
const label = z.string().trim().min(1).max(LEN.label);
const col = z.string().min(1).max(LEN.key);

// The agent composes every answer from bricks (bata). Besides that it only hands over the parts a brick cannot be:
// a write to confirm, a form or choice to answer, a board or calendar to work in, and the team's whiteboards and sheets.
const CoreInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("confirm"), action_id: id }),
  z.object({
    type: z.literal("form"), title: label, submit_label: label.optional(),
    fields: z.array(z.object({
      name: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), label, kind: z.enum(["text", "number", "date", "choice"]),
      options: z.array(label).min(2).max(COUNT.ms).optional(), required: z.boolean().optional(), value: z.string().max(LEN.line).optional(),
    })).min(1).max(COUNT.ms),
  }),
  z.object({ type: z.literal("choices"), question: label, options: z.array(z.string().trim().min(1).max(LEN.name)).min(2).max(COUNT.sm) }),
  z.object({ type: z.literal("board"), ref: id, lane: col, lane_order: z.array(z.string().max(LEN.label)).max(COUNT.l).optional().describe(HINT.laneValuesProcessOrder), page_size: pageSize, card_label: col.optional(), facts: z.array(col).max(COUNT.xxs).optional(), heading: label.optional() }),
  z.object({ type: z.literal("calendar"), ref: id, start: col, end: col.optional(), card_label: col.optional(), facts: z.array(col).max(COUNT.xxs).optional(), heading: label.optional() }),
]);
type CoreInput = z.infer<typeof CoreInput>;
const PartInput = legoInputs.length ? z.union(legoInputs as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]) : null;
export const BlockInput = PartInput ? z.union([BataInput, CoreInput, PartInput]) : z.union([BataInput, CoreInput]);
export type BlockInput = CoreInput | { type: string; [k: string]: unknown };
export const PresentShape = { blocks: z.array(BlockInput).min(1).max(COUNT.xxs) };

export type Registry = { get(id: string): Result | Action | undefined };
const isAction = (x: Result | Action | undefined): x is Action => !!x && "status" in x && "payload" in x;

/** The column a record is named by: its title role, else its key, else the first text column. */
const labelColumn = (r: RowsResult): Column | undefined =>
  r.columns.find((c) => c.role === "title") ?? r.columns.find((c) => c.name === r.open?.key) ?? r.columns.find((c) => c.type === "text");
/** Up to two facts that say most about a record next to its label: dates, money, categories. */
const factColumns = (r: RowsResult, skip: Set<string>): Column[] =>
  ["start", "date", "money", "quantity", "category", "status"].flatMap((role) => r.columns.filter((c) => c.role === role && !skip.has(c.name))).slice(0, 2);

export function resolveBlocks(input: BlockInput[], reg: Registry): { blocks: Block[]; problems: string[] } {
  const blocks: Block[] = [];
  const problems: string[] = [];
  for (const raw of input) {
    if (raw.type === "bata") {
      const r = resolveBata(raw as BataInput, reg);
      problems.push(...r.problems.map((p) => `bata: ${p}`));
      if (r.block) blocks.push(r.block);
      continue;
    }
    const part = legoByName.get(raw.type);
    if (part) {
      const { type: _t, ...args } = raw as { type: string; [k: string]: unknown };
      const r = part.resolve(args as never, reg);
      if ("problem" in r) problems.push(`${part.name}: ${r.problem}`);
      else blocks.push({ type: "lego", component: part.name, label: part.label, where: part.where, title: r.title, data: r.data, ...(typeof args.page_size === "number" ? { pageSize: args.page_size } : {}) });
      continue;
    }
    const b = raw as CoreInput;
    if (b.type === "form") {
      const names = new Set<string>();
      const fields: FormField[] = [];
      for (const f of b.fields) {
        if (names.has(f.name)) { problems.push(ERR.formFieldRepeated(f.name)); continue; }
        if (f.kind === "choice" && !f.options) { problems.push(ERR.formFieldChoiceWithout(f.name)); continue; }
        names.add(f.name);
        fields.push({ name: f.name, label: f.label, kind: f.kind, ...(f.options ? { options: f.options } : {}), required: f.required ?? true, ...(f.value ? { value: f.value } : {}) });
      }
      if (fields.length) blocks.push({ type: "form", id: `form_${crypto.randomUUID().slice(0, 6)}`, title: b.title, fields, submitLabel: b.submit_label ?? WORDS.send });
      continue;
    }
    if (b.type === "choices") {
      blocks.push({ type: "choices", id: `ch_${crypto.randomUUID().slice(0, 6)}`, question: b.question, options: [...new Set(b.options)] });
      continue;
    }
    if (b.type === "confirm") {
      const a = reg.get(b.action_id);
      if (!isAction(a)) problems.push(ERR.unknownAction(b.action_id));
      else if (a.status !== "pending") problems.push(ERR.actionAlready(b.action_id, a.status));
      else blocks.push({ type: "confirm", action: a });
      continue;
    }
    const r = reg.get(b.ref);
    if (!r || isAction(r)) { problems.push(ERR.unknownResult(b.ref)); continue; }
    if (r.kind !== "rows") { problems.push(ERR.needsRowsFromQuery(b.ref, r.kind, b.type)); continue; }
    const byName = new Map(r.columns.map((c) => [c.name, c]));
    const pick = (name: string | undefined, what: string): Column | undefined => {
      if (name === undefined) return undefined;
      const c = byName.get(name);
      if (!c) problems.push(ERR.columnNotHas(what, name, b.ref, r.columns.map((x) => x.name).join(", ")));
      return c;
    };
    const base = { title: b.heading || r.title, ...(r.note ? { note: r.note } : {}) };
    const open = r.open ? { open: r.open } : {};
    if (b.type === "board") {
      const lane = pick(b.lane, "lane");
      const lbl = pick(b.card_label, "card_label") ?? labelColumn(r);
      if (!lane || !lbl) continue;
      const facts = b.facts ? b.facts.map((n) => pick(n, "fact")).filter((c): c is Column => !!c) : factColumns(r, new Set([lane.name, lbl.name]));
      blocks.push({ type: "board", ...base, lane, label: lbl, facts, rows: r.rows, ...open, ...(b.lane_order?.length ? { laneOrder: b.lane_order } : {}), ...(b.page_size ? { pageSize: b.page_size } : {}) });
    } else if (b.type === "calendar") {
      const start = pick(b.start, "start");
      const end = pick(b.end, "end");
      const lbl = pick(b.card_label, "card_label") ?? labelColumn(r);
      if (!start || !lbl || (b.end && !end)) continue;
      if (start.type !== "date" && !r.rows.some((x) => typeof x[start.name] === "string" && !Number.isNaN(Date.parse(String(x[start.name]))))) { problems.push(ERR.calendarStartHoldsNo(start.name)); continue; }
      const facts = b.facts ? b.facts.map((n) => pick(n, "fact")).filter((c): c is Column => !!c) : factColumns(r, new Set([start.name, end?.name ?? "", lbl.name]));
      blocks.push({ type: "calendar", ...base, start, ...(end ? { end } : {}), label: lbl, facts, rows: r.rows, ...open });
    }
  }
  return { blocks, problems };
}
