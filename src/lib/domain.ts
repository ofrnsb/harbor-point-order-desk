// The contract a domain implements. Swap src/domain/ for a new product; nothing in src/lib changes.
import type { z } from "zod";
import type { ActionHandler, Proposal } from "./actions.ts";
import type { Action, PanelData, Result } from "./types.ts";
import type { AccessTouch, Effective, Principal } from "../platform/contract.ts";
import type { ToolCategory } from "../config/tools.ts";

type Unsaved<T> = T extends unknown ? Omit<T, "id"> : never;

export type ToolCtx = {
  chatId: string;
  /** The person's project this conversation runs in, if any. */
  projectId?: string | null;
  /** Store a result so `present` can show it. Returns it with its id; mention the id in the tool's text. */
  save: <T extends Result>(r: Unsaved<T>) => T;
  /** Propose a state-changing action. It runs only after the user presses Confirm. */
  propose: (p: Omit<Proposal, "chatId">) => Promise<Action>;
  /** Who is acting, and what they may see and do while acting as that unit. */
  principal: Principal;
  eff: Effective;
  /** True when the model route sends data outside the company network: restricted columns must be masked first. */
  external: boolean;
  /** A result an earlier tool call in this conversation saved (by its ref id), to export, compare or reshape it. */
  result: (id: string) => Result | undefined;
  /** Record one system touched; it streams to the access trail and is kept on the message. */
  touch: (t: Omit<AccessTouch, "id">) => AccessTouch;
};

export type DomainTool = {
  name: string;
  /** Where the tool sits in the catalog index the agent reads every turn. */
  category: ToolCategory;
  description: string;
  shape: z.ZodRawShape;
  /** Present-tense and past-tense labels for the activity bubble. */
  /** `writing`: what to show while the call itself is still being written (a large one takes a while), if anything. */
  label: (input: Record<string, unknown>) => { running: string; done: string; writing?: string };
  /** Returns plain text for the model. Throw to report a failure. */
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
};

export function defineTool<S extends z.ZodRawShape>(t: Omit<DomainTool, "shape" | "run"> & { shape: S; run: (args: z.infer<z.ZodObject<S>>, ctx: ToolCtx) => Promise<string> }): DomainTool {
  return t as unknown as DomainTool;
}

export type Domain = {
  agentName: string;
  /** IANA zone for "now" in the agent's prompt. */
  timezone: string;
  /** Domain rules appended to the core system prompt: who the agent serves, its workflow, its limits. */
  prompt: string;
  tools: DomainTool[];
  /** Executors for proposed actions, keyed by action type. */
  actions: Record<string, ActionHandler>;
  /** Right panel when nothing is selected, and the home sections' data: live, useful, never filler. Optional `metrics` feed the key figures. */
  panel: (scope?: { eff: Effective }) => Promise<PanelData>;
};
