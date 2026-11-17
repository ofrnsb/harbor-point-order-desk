// Is the model gateway reachable, and is a Claude login available for the claude-sdk backend?
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gatewayUrl } from "./litellm.ts";
import { env } from "../../config/env.ts";
import { GATEWAY } from "../../config/server.ts";

export async function litellmReachable(fetcher: typeof fetch = fetch): Promise<boolean> {
  const base = gatewayUrl();
  if (!base) return false;
  for (const p of ["/health/liveliness", "/v1/models"]) {
    try {
      const res = await fetcher(`${base}${p}`, { headers: env.litellmKey ? { authorization: `Bearer ${env.litellmKey}` } : {}, signal: AbortSignal.timeout(GATEWAY.probeTimeoutMs) });
      if (res.ok) return true;
    } catch { /* try the next probe */ }
  }
  return false;
}

/** True when a Claude login profile exists for the SDK backend (development use only). */
export function claudeLoginPresent(): boolean {
  if (env.claudeOauthToken) return true;
  const dir = env.claudeProfile ?? env.claudeConfigDir ?? path.join(os.homedir(), ".claude");
  return fs.existsSync(path.join(dir, ".credentials.json")) || fs.existsSync(path.join(dir, ".claude.json"));
}

export async function gatewayStatus(): Promise<{ litellmUrl: string | null; reachable: boolean; claudeLogin: boolean }> {
  return { litellmUrl: gatewayUrl(), reachable: await litellmReachable(), claudeLogin: claudeLoginPresent() };
}
