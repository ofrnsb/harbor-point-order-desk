// The agent's tools behind two meta-tools. The model sees an index of categories and tool names; it reads the tools it
// needs with describe_tools (description and input schema) and calls one with run_tool. A tool not described in this
// turn is refused, so the model never guesses its arguments, and every input is validated against the tool's schema.
import { z } from "zod";
import type { StepLabel, ToolHost } from "../platform/gateway/loop.ts";
import { DESCRIBE_MAX, META_TOOLS, TOOL_CATEGORIES, type ToolCategory } from "../config/tools.ts";
import { LEN } from "../config/data.ts";
import { CATALOG } from "../copy/agent.ts";

type Outcome = { text: string; isError: boolean };
export type CatalogTool = {
  name: string;
  category: ToolCategory;
  description: string;
  shape: z.ZodRawShape;
  label: (input: Record<string, unknown>) => StepLabel | null;
  call: (args: Record<string, unknown>) => Promise<Outcome>;
};

const DescribeShape = { names: z.array(z.string().min(1).max(LEN.label)).min(1).max(DESCRIBE_MAX) };
const RunShape = { name: z.string().min(1).max(LEN.label), input: z.record(z.string(), z.unknown()).default({}) };

/** The categories and the tools in each, as the prompt lists them. Empty categories are left out. */
export function toolIndex(tools: CatalogTool[]): string {
  return TOOL_CATEGORIES
    .map((c) => ({ c, names: tools.filter((t) => t.category === c).map((t) => t.name) }))
    .filter((x) => x.names.length)
    .map((x) => CATALOG.indexLine(x.c, CATALOG.categories[x.c], x.names.join(", ")))
    .join("\n");
}

function schemaOf(t: CatalogTool): string {
  const { $schema: _s, ...schema } = z.toJSONSchema(z.object(t.shape)) as Record<string, unknown>;
  return JSON.stringify(schema);
}

function describe(byName: Map<string, CatalogTool>, described: Set<string>, names: string[]): Outcome {
  const known = names.filter((n) => byName.has(n));
  const unknown = names.filter((n) => !byName.has(n));
  for (const n of known) described.add(n);
  const parts = known.map((n) => { const t = byName.get(n)!; return CATALOG.described(t.name, t.description, schemaOf(t)); });
  if (unknown.length) parts.push(CATALOG.unknownTools(unknown.join(", "), [...byName.keys()].join(", ")));
  return { text: parts.join("\n\n"), isError: known.length === 0 };
}

async function run(byName: Map<string, CatalogTool>, described: Set<string>, name: string, input: Record<string, unknown>): Promise<Outcome> {
  const t = byName.get(name);
  if (!t) return { text: CATALOG.unknownTools(name, [...byName.keys()].join(", ")), isError: true };
  if (!described.has(name)) return { text: CATALOG.describeFirst(name), isError: true };
  const parsed = z.object(t.shape).safeParse(input);
  if (!parsed.success) return { text: CATALOG.badInput(name, parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")), isError: true };
  return t.call(parsed.data);
}

/** The step a meta-tool call shows: run_tool shows the tool it runs; before its name is written, a neutral preparing step. */
function labelOf(byName: Map<string, CatalogTool>, name: string, input: Record<string, unknown>): StepLabel | null {
  if (name === META_TOOLS.describe) return { kind: "tool", label: CATALOG.reading, doneLabel: CATALOG.read };
  if (name !== META_TOOLS.run) return null;
  const inner = typeof input.name === "string" ? byName.get(input.name) : undefined;
  if (!inner) return { kind: "tool", label: CATALOG.preparing, doneLabel: CATALOG.prepared, writing: CATALOG.preparing };
  return inner.label((input.input ?? {}) as Record<string, unknown>);
}

/** A tool host for one turn: the two meta-tools, with what this turn has described. */
export function catalogHost(tools: CatalogTool[]): ToolHost {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const described = new Set<string>();
  return {
    tools: [
      { name: META_TOOLS.describe, description: CATALOG.describeTool, shape: DescribeShape },
      { name: META_TOOLS.run, description: CATALOG.runTool, shape: RunShape },
    ],
    call: async (name, args) => {
      if (name === META_TOOLS.describe) return describe(byName, described, (args.names ?? []) as string[]);
      if (name === META_TOOLS.run) return run(byName, described, String(args.name ?? ""), (args.input ?? {}) as Record<string, unknown>);
      return { text: CATALOG.unknownTools(name, [...byName.keys()].join(", ")), isError: true };
    },
    label: (name, input) => labelOf(byName, name, input),
  };
}
