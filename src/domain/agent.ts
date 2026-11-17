// The one agent every person works with, with every tool. What it may read or write is the person's own effective scope
// (grants, masking, actions, approval thresholds), checked by the platform on every call.
import type { Agent } from "../platform/contract.ts";
import { AGENT } from "../copy/agent.ts";

export function theAgent(): Agent {
  return { ...AGENT, owners: [...AGENT.owners] };
}
