"use client";
// One shared view of the queue for the home screen and the side panel: a single poller, faster while the agent works,
// and the email that is open for review.
import { useSyncExternalStore } from "react";
import { API } from "@/config/routes";
import { INBOX_POLL } from "@/config/orders";
import type { RunStatus } from "@/domain/orders/pipeline";
import type { TriageView } from "@/domain/orders/views";
import { api } from "../sp/client";

export type InboxResponse = { items: TriageView[]; run: RunStatus; canRun: boolean };
type Snapshot = { data: InboxResponse | null; error: string | null; openId: string | null };

let snap: Snapshot = { data: null, error: null, openId: null };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

const set = (next: Partial<Snapshot>) => { snap = { ...snap, ...next }; subs.forEach((f) => f()); };

export async function refreshInbox(): Promise<void> {
  if (timer) clearTimeout(timer);
  try { set({ data: await api<InboxResponse>(API.inbox), error: null }); }
  catch (err) { set({ error: err instanceof Error ? err.message : String(err) }); }
  if (subs.size) timer = setTimeout(refreshInbox, snap.data?.run.running ? INBOX_POLL.runningMs : INBOX_POLL.idleMs);
}

function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) void refreshInbox();
  return () => {
    subs.delete(f);
    if (!subs.size && timer) { clearTimeout(timer); timer = null; }
  };
}

export const useInbox = () => useSyncExternalStore(subscribe, () => snap, () => snap);
export const openEmail = (id: string | null) => set({ openId: id });
