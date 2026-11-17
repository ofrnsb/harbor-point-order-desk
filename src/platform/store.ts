// Platform metadata store: one SQLite file per installation. Documents are JSON per kind; audit and usage are append-only tables.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR } from "../lib/data-dir.ts";
import type {
  ActionTemplate, AuditEvent, CatalogObject, Connection, DataProfile, Membership, ModelRoute, OrgUnit, Pin, Project, Tenant, UsageRow, User, WorkItem,
} from "./contract.ts";
import type { TkDocument, TkMessage, TkNote, TkReminder, TkTask, TkWatch } from "../domain/toolkit/records.ts";
import type { Triage } from "../domain/orders/types.ts";
import { env } from "../config/env.ts";
import { AUDIT_PAGE, USAGE_ROWS_MAX } from "../config/server.ts";
import { ERR } from "../copy/server.ts";

export type Kinds = {
  tenant: Tenant; unit: OrgUnit; user: User; connection: Connection; catalog: CatalogObject;
  profile: DataProfile; action: ActionTemplate; route: ModelRoute; work: WorkItem; project: Project; pin: Pin;
  tk_document: TkDocument; tk_message: TkMessage; tk_task: TkTask; tk_note: TkNote; tk_reminder: TkReminder; tk_watch: TkWatch;
  triage: Triage;
};
export type Kind = keyof Kinds;

export const DB_FILE = env.db ?? path.join(DATA_DIR, "simpul.db");
const g = globalThis as unknown as { simpulDb?: Database.Database };

/** Stores made when there were several agents carry a usage.agent_id column that new rows no longer fill. */
function dropColumn(d: Database.Database, table: string, column: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

export function db(): Database.Database {
  if (g.simpulDb?.open) return g.simpulDb;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const d = new Database(DB_FILE);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(`
    CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, tenant_id TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (kind, id));
    CREATE INDEX IF NOT EXISTS docs_tenant ON docs (kind, tenant_id);
    CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, unit_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (user_id, unit_id));
    CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, blob TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_tenant ON audit (tenant_id, seq);
    CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, unit_id TEXT NOT NULL, user_id TEXT NOT NULL, chat_id TEXT NOT NULL, route_id TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost REAL NOT NULL, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS usage_unit ON usage (tenant_id, unit_id, at);
    CREATE TABLE IF NOT EXISTS credentials (user_id TEXT PRIMARY KEY, hash TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  dropColumn(d, "usage", "agent_id");
  g.simpulDb = d;
  return d;
}

/** Documents are keyed by kind and id; catalog objects use "<connectionId>/<name>". */
export const docId = <K extends Kind>(kind: K, doc: Kinds[K]): string =>
  kind === "catalog" ? `${(doc as CatalogObject).connectionId}/${(doc as CatalogObject).name}` : (doc as { id: string }).id;

export function get<K extends Kind>(kind: K, id: string): Kinds[K] | null {
  const row = db().prepare("SELECT body FROM docs WHERE kind = ? AND id = ?").get(kind, id) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as Kinds[K]) : null;
}

export function list<K extends Kind>(kind: K, tenantId: string): Kinds[K][] {
  return (db().prepare("SELECT body FROM docs WHERE kind = ? AND tenant_id = ? ORDER BY id").all(kind, tenantId) as { body: string }[])
    .map((r) => JSON.parse(r.body) as Kinds[K]);
}

/** Catalog objects carry no tenant of their own: they belong to their connection's tenant. */
function tenantOf<K extends Kind>(kind: K, doc: Kinds[K]): string {
  if (kind === "tenant") return (doc as Tenant).id;
  if (kind === "catalog") {
    const t = get("connection", (doc as CatalogObject).connectionId)?.tenantId;
    if (!t) throw new Error(ERR.connectionNotFoundForObject((doc as CatalogObject).connectionId));
    return t;
  }
  return (doc as { tenantId: string }).tenantId;
}

export function listTenants(): Tenant[] {
  return (db().prepare("SELECT body FROM docs WHERE kind = 'tenant' ORDER BY id").all() as { body: string }[]).map((r) => JSON.parse(r.body) as Tenant);
}

export function put<K extends Kind>(kind: K, doc: Kinds[K]): Kinds[K] {
  db().prepare("INSERT INTO docs (kind, id, tenant_id, body, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at")
    .run(kind, docId(kind, doc), tenantOf(kind, doc), JSON.stringify(doc), new Date().toISOString());
  return doc;
}

export function remove(kind: Kind, id: string): boolean {
  return db().prepare("DELETE FROM docs WHERE kind = ? AND id = ?").run(kind, id).changes > 0;
}

export function memberships(filter: { userId?: string; unitId?: string }): Membership[] {
  const rows = filter.userId
    ? db().prepare("SELECT user_id, unit_id, role FROM memberships WHERE user_id = ?").all(filter.userId)
    : filter.unitId
      ? db().prepare("SELECT user_id, unit_id, role FROM memberships WHERE unit_id = ?").all(filter.unitId)
      : db().prepare("SELECT user_id, unit_id, role FROM memberships").all();
  return (rows as { user_id: string; unit_id: string; role: Membership["role"] }[]).map((r) => ({ userId: r.user_id, unitId: r.unit_id, role: r.role }));
}

export function setMembership(m: Membership | { userId: string; unitId: string; role: null }): void {
  if (m.role === null) db().prepare("DELETE FROM memberships WHERE user_id = ? AND unit_id = ?").run(m.userId, m.unitId);
  else db().prepare("INSERT INTO memberships (user_id, unit_id, role) VALUES (?, ?, ?) ON CONFLICT(user_id, unit_id) DO UPDATE SET role = excluded.role").run(m.userId, m.unitId, m.role);
}

export function putSecretBlob(id: string, tenantId: string, blob: string): void {
  db().prepare("INSERT INTO secrets (id, tenant_id, blob, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET blob = excluded.blob").run(id, tenantId, blob, new Date().toISOString());
}

export function secretBlob(id: string): string | null {
  return (db().prepare("SELECT blob FROM secrets WHERE id = ?").get(id) as { blob: string } | undefined)?.blob ?? null;
}

export function removeSecret(id: string): void {
  db().prepare("DELETE FROM secrets WHERE id = ?").run(id);
}

export function lastAudit(tenantId: string): AuditEvent | null {
  const row = db().prepare("SELECT body FROM audit WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1").get(tenantId) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as AuditEvent) : null;
}
/** Inserts under a transaction so concurrent appends cannot fork the chain. `build` receives the previous event. */
export function appendAudit(tenantId: string, build: (prev: AuditEvent | null, seq: number) => AuditEvent): AuditEvent {
  const d = db();
  return d.transaction(() => {
    const prev = lastAudit(tenantId);
    const seq = ((d.prepare("SELECT MAX(seq) AS m FROM audit").get() as { m: number | null }).m ?? 0) + 1;
    const ev = build(prev, seq);
    d.prepare("INSERT INTO audit (seq, tenant_id, at, body, hash) VALUES (?, ?, ?, ?, ?)").run(ev.seq, tenantId, ev.at, JSON.stringify(ev), ev.hash);
    return ev;
  }).immediate();
}
export function auditPage(tenantId: string, opts: { beforeSeq?: number; limit: number; kind?: string; userId?: string }): AuditEvent[] {
  const rows = db().prepare("SELECT body FROM audit WHERE tenant_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?")
    .all(tenantId, opts.beforeSeq ?? Number.MAX_SAFE_INTEGER, Math.min(opts.limit * AUDIT_PAGE.overfetch, AUDIT_PAGE.rowsMax)) as { body: string }[];
  return rows.map((r) => JSON.parse(r.body) as AuditEvent)
    .filter((e) => (!opts.kind || e.kind === opts.kind) && (!opts.userId || e.actor.userId === opts.userId))
    .slice(0, opts.limit);
}
export function auditAll(tenantId: string): AuditEvent[] {
  return (db().prepare("SELECT body FROM audit WHERE tenant_id = ? ORDER BY seq ASC").all(tenantId) as { body: string }[]).map((r) => JSON.parse(r.body) as AuditEvent);
}

export function addUsage(u: UsageRow): void {
  db().prepare("INSERT INTO usage (id, tenant_id, unit_id, user_id, chat_id, route_id, input_tokens, output_tokens, cost, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(u.id, u.tenantId, u.unitId, u.userId, u.chatId, u.routeId, u.inputTokens, u.outputTokens, u.cost, u.at);
}
/** Spend in the tenant currency per unit since `since` (ISO). */
export function spendByUnit(tenantId: string, since: string): Record<string, number> {
  const rows = db().prepare("SELECT unit_id, SUM(cost) AS s FROM usage WHERE tenant_id = ? AND at >= ? GROUP BY unit_id").all(tenantId, since) as { unit_id: string; s: number }[];
  return Object.fromEntries(rows.map((r) => [r.unit_id, r.s]));
}
export function usageRows(tenantId: string, since: string): UsageRow[] {
  return (db().prepare("SELECT * FROM usage WHERE tenant_id = ? AND at >= ? ORDER BY at DESC LIMIT ?").all(tenantId, since, USAGE_ROWS_MAX) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), tenantId: String(r.tenant_id), unitId: String(r.unit_id), userId: String(r.user_id), chatId: String(r.chat_id),
    routeId: String(r.route_id), inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), cost: Number(r.cost), at: String(r.at),
  }));
}

/** Drops every table's rows. Used by reset only. */
export function wipe(): void {
  db().exec("DELETE FROM docs; DELETE FROM memberships; DELETE FROM secrets; DELETE FROM audit; DELETE FROM usage; DELETE FROM credentials;");
}

/** Password hashes live apart from user documents, so no user listing can carry one. */
export function setPasswordHash(userId: string, hash: string): void {
  db().prepare("INSERT INTO credentials (user_id, hash, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at")
    .run(userId, hash, new Date().toISOString());
}
export function passwordHashOf(userId: string): string | null {
  return (db().prepare("SELECT hash FROM credentials WHERE user_id = ?").get(userId) as { hash: string } | undefined)?.hash ?? null;
}
