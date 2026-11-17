// One cached connector per connection and mode. Reads use the read credential; only the action executor asks for "write".
import type { Connection, Connector } from "../contract.ts";
import { sqliteConnector } from "./sqlite.ts";
import { CONNECTOR } from "../../config/server.ts";
import { ERR } from "../../copy/server.ts";

type Entry = { connector: Connector; signature: string; born: number };
const g = globalThis as unknown as { simpulConnectors?: Map<string, Entry> };
const cache = (g.simpulConnectors ??= new Map());

/** Changes to config or secrets produce a new connector; the stale one is closed. */
const signatureOf = (c: Connection, mode: string) => JSON.stringify([c.kind, c.config, mode === "write" ? c.writeSecret : c.readSecret]);

export function connectorFor(conn: Connection, mode: "read" | "write"): Connector {
  const key = `${conn.id}:${mode}`;
  const signature = signatureOf(conn, mode);
  const hit = cache.get(key);
  if (hit && hit.signature === signature && Date.now() - hit.born < CONNECTOR.poolMaxAgeMs) return hit.connector;
  // Database sessions keep the privileges they started with; a fresh pool picks up grants and revokes.
  if (hit) { const old = hit.connector; setTimeout(() => void old.close().catch(() => {}), hit.signature === signature ? CONNECTOR.poolDrainMs : 0).unref?.(); }
  const secret = mode === "write" ? conn.writeSecret : conn.readSecret;
  if (mode === "write" && !secret) throw new Error(ERR.hasNoWriteCredential(conn.name));
  if (conn.kind !== "sqlite") throw new Error(ERR.unsupportedDatabaseKind(String(conn.kind)));
  const connector = sqliteConnector(conn, mode);
  cache.set(key, { connector, signature, born: Date.now() });
  return connector;
}

export async function closeAll(): Promise<void> {
  const all = [...cache.values()];
  cache.clear();
  await Promise.allSettled(all.map((e) => e.connector.close()));
}
