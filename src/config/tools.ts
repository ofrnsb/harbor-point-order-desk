// The agent's tool catalog. Each turn the agent sees only the categories and the tool names in them; it reads a tool's
// full description and input schema with describe_tools when it needs that tool, then calls it through run_tool.
export const TOOL_CATEGORIES = ["data", "actions", "work", "tasks", "messages", "policy", "answer"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const META_TOOLS = { describe: "describe_tools", run: "run_tool" } as const;

/** The tool that shows the answer on screen. */
export const PRESENT_TOOL = "present";

/** Tool descriptions one describe_tools call may return. */
export const DESCRIBE_MAX = 8;
