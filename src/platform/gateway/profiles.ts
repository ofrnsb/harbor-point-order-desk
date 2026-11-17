// Several Claude logins can serve the app. When one hits its usage limit the turn moves to the next, and the
// exhausted one rests until the reset time its own message names, so people never see a raw limit error.
import { env } from "../../config/env.ts";
import { isLimit, resetAt } from "../../lib/limits.ts";

export { isLimit, resetAt };

const g = globalThis as unknown as { claudeProfileRest?: Map<string, number> };
const resting = (g.claudeProfileRest ??= new Map());

/** The logins to use, in order: APP_CLAUDE_PROFILES (comma separated), else the single APP_CLAUDE_PROFILE. */
export function profiles(): string[] {
  const many = (env.claudeProfiles ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return many.length ? [...new Set(many)] : env.claudeProfile ? [env.claudeProfile] : [];
}

/** Logins not resting right now, in order. An app with no profile configured runs on the default login (undefined). */
export function usable(now = Date.now()): (string | undefined)[] {
  const all = profiles();
  if (!all.length) return [undefined];
  return all.filter((p) => (resting.get(p) ?? 0) <= now);
}

export function rest(profile: string | undefined, until: number): void {
  if (profile) resting.set(profile, until);
}

/** The earliest moment any login is free again, for the message shown when all of them are resting. */
export function nextFree(now = Date.now()): number | null {
  const times = profiles().map((p) => resting.get(p) ?? 0).filter((t) => t > now);
  return times.length ? Math.min(...times) : null;
}
