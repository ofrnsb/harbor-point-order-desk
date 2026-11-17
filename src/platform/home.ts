// The agent-built start screen, kept per person, team and agent. The last one built is always shown at once, from
// memory or from the installation's data folder, so a restart or an aged screen never makes anyone wait: it is rebuilt
// behind what they are already reading. It counts as current while it is young and the decisions waiting on the
// person are the ones it was built for.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HOME_BRIEF } from "../config/server.ts";
import { DATA_DIR } from "../lib/data-dir.ts";
import type { Message } from "../lib/types.ts";

type Entry = { message: Message; at: number; queue: string };
const g = globalThis as unknown as { homeBriefs?: Map<string, Entry>; homeBuilding?: Map<string, Promise<Message>> };
const briefs = (g.homeBriefs ??= new Map());
/** Builds in flight, so a second open of the same screen waits for the first instead of paying for another turn. */
export const building = (g.homeBuilding ??= new Map());

const DIR = path.join(DATA_DIR, HOME_BRIEF.dir);
const fileOf = (key: string) => path.join(DIR, `${crypto.createHash("sha256").update(key).digest("hex")}.json`);

/** Whose screen it is. */
export function briefKey(userId: string, unitId: string): string {
  return `${userId}:${unitId}`;
}

/** The decisions waiting on the person, as the screen was built for them. */
export function queueOf(awaiting: { id: string; state: string }[]): string {
  return awaiting.map((w) => `${w.id}=${w.state}`).sort().join(",");
}

/** The last screen built for this person, however old. */
export function lastBrief(key: string): Entry | null {
  const hit = briefs.get(key);
  if (hit) return hit;
  try {
    const e = JSON.parse(fs.readFileSync(fileOf(key), "utf8")) as Entry;
    if (e?.message?.role !== "agent" || typeof e.at !== "number") return null;
    briefs.set(key, e);
    return e;
  } catch {
    return null;  // never built, or an unreadable file: build it
  }
}

/** The last screen, when it is young enough and was built for the same waiting decisions. */
export function freshBrief(key: string, queue: string, now = Date.now(), ttlMs: number = HOME_BRIEF.ttlMs): Message | null {
  const e = lastBrief(key);
  return e && e.queue === queue && now - e.at < ttlMs ? e.message : null;
}

/**
 * What shows at once while a new screen is built: the last one, however old, but only when it was built for the same
 * waiting decisions. Otherwise its Approve and Reject would be for decisions already taken, or miss the new ones.
 */
export function briefWhileBuilding(key: string, queue: string): Entry | null {
  const e = lastBrief(key);
  return e?.queue === queue ? e : null;
}

/** Keeps only a usable screen: a failed or empty turn leaves the last good one in place. */
export function keepBrief(key: string, queue: string, message: Message, now = Date.now()): boolean {
  if (message.role !== "agent" || message.error || !message.blocks.length) return false;
  const e: Entry = { message, at: now, queue };
  briefs.set(key, e);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${fileOf(key)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(e));
    fs.renameSync(tmp, fileOf(key));
  } catch (err) {
    console.warn(`home brief not saved for ${key}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return true;
}

export function dropBrief(key: string): void {
  briefs.delete(key);
  fs.rmSync(fileOf(key), { force: true });
}
