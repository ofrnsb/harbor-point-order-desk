import fs from "node:fs/promises";
import path from "node:path";
import type { Chat, ChatSummary } from "./types.ts";
import { DATA_DIR } from "./data-dir.ts";
import { ERR } from "../copy/server.ts";

const DIR = path.join(DATA_DIR, "chats");
const ID = /^[A-Za-z0-9_-]{8,40}$/;
export const MODELS = ["sonnet", "opus", "haiku"] as const;
export type Model = (typeof MODELS)[number];

export const isChatId = (id: string) => ID.test(id);
const file = (id: string) => {
  if (!isChatId(id)) throw new Error(ERR.badChatId);
  return path.join(DIR, `${id}.json`);
};

/** Fills fields that older files may lack, so chats saved before a change still open. */
function normalize(raw: Partial<Chat> & { id: string }): Chat {
  const now = new Date().toISOString();
  return {
    id: raw.id, title: raw.title || "Untitled chat", createdAt: raw.createdAt ?? now, updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
    sessionId: raw.sessionId ?? null, model: typeof raw.model === "string" && raw.model ? raw.model : "",
    ...(raw.userId ? { userId: raw.userId } : {}), ...(raw.unitId ? { unitId: raw.unitId } : {}), ...(raw.projectId ? { projectId: raw.projectId } : {}), ...(raw.origin ? { origin: raw.origin } : {}),
    messages: Array.isArray(raw.messages)
      ? raw.messages.map((m) => (m.role === "agent" ? { ...m, blocks: m.blocks ?? [], trace: m.trace ?? [], error: m.error ?? null } : m))
      : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}

export async function getChat(id: string): Promise<Chat | null> {
  if (!isChatId(id)) return null;
  try {
    return normalize(JSON.parse(await fs.readFile(file(id), "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveChat(chat: Chat): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${file(chat.id)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(chat));
  await fs.rename(tmp, file(chat.id));
}

/** Only the chats `userId` owns; chats saved without an owner are never listed. */
export async function listChats(userId: string): Promise<ChatSummary[]> {
  let names: string[] = [];
  try { names = await fs.readdir(DIR); } catch { return []; }
  const chats = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => getChat(n.slice(0, -5)).catch(() => null)));
  return chats.filter((c): c is Chat => !!c && c.userId === userId && !c.origin)
    .map(({ id, title, createdAt, updatedAt, userId: u, unitId, projectId }) => ({ id, title, createdAt, updatedAt, userId: u, unitId, ...(projectId ? { projectId } : {}) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createChat(title: string, owner: { model: string; userId: string; unitId: string; projectId?: string; origin?: Chat["origin"] }): Promise<Chat> {
  const now = new Date().toISOString();
  const { model, userId, unitId, projectId, origin } = owner;
  const chat: Chat = { id: crypto.randomUUID().replace(/-/g, "").slice(0, 16), title, createdAt: now, updatedAt: now, userId, unitId, ...(projectId ? { projectId } : {}), ...(origin ? { origin } : {}), sessionId: null, model, messages: [], notes: [] };
  await saveChat(chat);
  return chat;
}

export async function deleteChat(id: string): Promise<boolean> {
  try { await fs.unlink(file(id)); return true; } catch { return false; }
}
