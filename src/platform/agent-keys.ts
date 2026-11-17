// A person's own Anthropic API key, given at sign-in: sealed with the master key, read only to run that person's agent
// turns, and removed when they sign out. With it the agent never touches the host's Claude login.
import { removeSecret, putSecretBlob, secretBlob } from "./store.ts";
import { open, seal } from "./secrets.ts";
import { AGENT_KEY } from "../config/server.ts";

const idOf = (userId: string) => `agent-key:${userId}`;

export const isAgentKey = (key: string) => AGENT_KEY.pattern.test(key);

export function saveAgentKey(tenantId: string, userId: string, key: string): void {
  putSecretBlob(idOf(userId), tenantId, seal(key));
}

export function agentKeyOf(userId: string): string | null {
  const blob = secretBlob(idOf(userId));
  return blob ? open(blob) : null;
}

export const forgetAgentKey = (userId: string) => removeSecret(idOf(userId));
