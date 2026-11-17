// Re-reads every connected system on a schedule, so a column renamed or a table added by another team shows up in the
// catalog (and the audit log) without anyone pressing Introspect.
import { introspectConnection } from "./catalog.ts";
import { list, listTenants } from "./store.ts";
import { CATALOG_REFRESH_MS } from "../config/server.ts";

let started = false;
let running = false;

export async function refreshAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const t of listTenants()) for (const c of list("connection", t.id)) {
      if (!c.introspectedAt) continue;
      await introspectConnection(c.id).catch(() => { /* the connection's status records the failure */ });
    }
  } finally { running = false; }
}

export function startRefresh(): void {
  if (started || !(CATALOG_REFRESH_MS > 0)) return;
  started = true;
  setInterval(() => void refreshAll(), CATALOG_REFRESH_MS).unref();
}
