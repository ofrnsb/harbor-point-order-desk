// Confirmation gate: a state-changing action is only proposed by the agent and only executed
// after the user confirms it through the API. The agent has no tool that executes actions.
import fs from "node:fs/promises";
import path from "node:path";
import type { Action, Field } from "./types.ts";
import { DATA_DIR } from "./data-dir.ts";
import { ERR } from "../copy/server.ts";

/** A handler returns the receipt, or the receipt and whether the action now waits for an approver before it runs. */
export type ActionHandler = (a: Action) => Promise<Field[] | { receipt: Field[]; awaitingApproval: boolean }>;
const FILE = path.join(DATA_DIR, "actions.json");
let queue: Promise<unknown> = Promise.resolve();
const locked = <T>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

async function readAll(): Promise<Record<string, Action>> {
  try { return JSON.parse(await fs.readFile(FILE, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
}
async function writeAll(all: Record<string, Action>) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(`${FILE}.tmp`, JSON.stringify(all));
  await fs.rename(`${FILE}.tmp`, FILE);
}

export type Proposal = Pick<Action, "chatId" | "type" | "payload" | "title" | "summary" | "consequence" | "danger">;

export const propose = (p: Proposal) => locked(async () => {
  const all = await readAll();
  const a: Action = { ...p, id: `act_${crypto.randomUUID().slice(0, 8)}`, status: "pending", receipt: null, error: null, createdAt: new Date().toISOString(), decidedAt: null };
  all[a.id] = a;
  await writeAll(all);
  return a;
});

export const getAction = async (id: string) => (await readAll())[id] ?? null;

/** The approver's decision lands on the card the requester saw: executed with its receipt, or rejected with the reason. */
export const settle = (id: string, outcome: { receipt: Field[] } | { error: string }) => locked(async () => {
  const all = await readAll();
  const a = all[id];
  if (!a) return;
  all[id] = "receipt" in outcome
    ? { ...a, awaitingApproval: false, receipt: outcome.receipt, decidedAt: new Date().toISOString() }
    : { ...a, awaitingApproval: false, status: "failed", error: outcome.error, decidedAt: new Date().toISOString() };
  await writeAll(all);
});

export const decide = (id: string, decision: "confirm" | "cancel", handlers: Record<string, ActionHandler>) =>
  locked(async (): Promise<{ action: Action } | { error: string; status: number }> => {
    const all = await readAll();
    const a = all[id];
    if (!a) return { error: ERR.actionNotFound, status: 404 };
    if (a.status !== "pending") return { error: ERR.actionAlready2(a.status), status: 409 };
    const decidedAt = new Date().toISOString();
    if (decision === "cancel") {
      all[id] = { ...a, status: "cancelled", decidedAt };
    } else {
      const handler = handlers[a.type];
      try {
        if (!handler) throw new Error(ERR.noHandlerActionType(a.type));
        const r = await handler(a);
        all[id] = Array.isArray(r) ? { ...a, status: "confirmed", receipt: r, decidedAt } : { ...a, status: "confirmed", receipt: r.receipt, decidedAt, ...(r.awaitingApproval ? { awaitingApproval: true } : {}) };
      } catch (err) {
        all[id] = { ...a, status: "failed", error: err instanceof Error ? err.message : String(err), decidedAt };
      }
    }
    await writeAll(all);
    return { action: all[id] };
  });
