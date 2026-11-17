import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { CompiledAction, Connection, Connector, ScopedAggregate, ScopedSelect, WriteResult } from "../contract.ts";
import { buildObject, type RawColumn } from "../classify.ts";
import { aggregateNumeric, changedColumn, compileAggregate, compileKeySelect, compileSelect, compileWrite, insertedRef, normalizeRow, numericColumns } from "./sql.ts";
import { CONNECTOR } from "../../config/server.ts";
import { ERR } from "../../copy/server.ts";
import { DB_FILE } from "../store.ts";

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function sqliteConnector(conn: Connection, mode: "read" | "write"): Connector {
  const file = conn.config.file;
  if (!file) throw new Error(ERR.sqliteConnectionNeedsConfig);
  const full = path.isAbsolute(file) ? file : path.join(/*turbopackIgnore: true*/ process.cwd(), file);
  // The platform's own store (users, sealed credentials, audit) is never a data source, whatever path leads to it.
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  if (real(full) === real(DB_FILE)) throw new Error(ERR.sqliteIsPlatformStore);
  let handle: Database.Database | null = null;
  let inode = 0;
  // A file replaced on disk (a restore, a re-seed) must not keep serving the old, unlinked copy.
  const db = () => {
    const ino = fs.statSync(full).ino;
    if (handle?.open && ino === inode) return handle;
    if (handle?.open) handle.close();
    handle = new Database(full, { readonly: mode === "read", fileMustExist: true, timeout: CONNECTOR.statementTimeoutMs });
    inode = ino;
    return handle;
  };

  return {
    kind: "sqlite",
    async test() { db().prepare("SELECT 1").get(); },

    async introspect() {
      const d = db();
      const objs = d.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; type: string }[];
      return objs.map((o) => {
        const info = d.prepare(`PRAGMA table_info(${qi(o.name)})`).all() as { name: string; type: string; notnull: number; pk: number }[];
        const fks = d.prepare(`PRAGMA foreign_key_list(${qi(o.name)})`).all() as { table: string; from: string; to: string }[];
        const sample = d.prepare(`SELECT * FROM ${qi(o.name)} LIMIT ${CONNECTOR.sampleRows}`).all() as Record<string, unknown>[];
        const rowEstimate = Number((d.prepare(`SELECT COUNT(*) AS n FROM ${qi(o.name)}`).get() as { n: number }).n);
        const raw: RawColumn[] = info.map((c) => {
          const fk = fks.find((f) => f.from === c.name);
          return { name: c.name, nativeType: c.type || "TEXT", nullable: !c.notnull && !c.pk, ...(fk ? { fk: { object: fk.table, column: fk.to } } : {}) };
        });
        return buildObject({
          name: o.name, kind: o.type === "view" ? "view" : "table", columns: raw,
          primaryKey: info.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name), rowEstimate,
          samples: Object.fromEntries(raw.map((r) => [r.name, sample.map((s) => s[r.name])])),
        });
      });
    },

    async select(q: ScopedSelect) {
      const t0 = Date.now();
      const { rows, count } = compileSelect(q);
      const num = numericColumns(q.object);
      const d = db();
      const r = d.prepare(rows.sql).all(...(rows.params as never[])) as Record<string, unknown>[];
      const n = d.prepare(count.sql).get(...(count.params as never[])) as { n: number };
      return { rows: r.map((x) => normalizeRow(x, num)), total: Number(n.n), ms: Date.now() - t0, statement: rows.sql };
    },

    async aggregate(q: ScopedAggregate) {
      const t0 = Date.now();
      const s = compileAggregate(q);
      const num = aggregateNumeric(q);
      const r = db().prepare(s.sql).all(...(s.params as never[])) as Record<string, unknown>[];
      return { rows: r.map((x) => normalizeRow(x, num)), total: r.length, ms: Date.now() - t0, statement: s.sql };
    },

    async execute(a: CompiledAction, opts: { rehearse?: boolean } = {}): Promise<WriteResult> {
      if (mode !== "write") throw new Error(ERR.thisConnectionReadOnly);
      const t0 = Date.now();
      const s = compileWrite(a);
      const bind = (vs: unknown[]) => vs.map((v) => (typeof v === "boolean" ? Number(v) : v)) as never[];
      const none = new Set<string>();
      const d = db();
      // BEGIN IMMEDIATE takes the write lock before the row is read, so nothing changes between the check and the write.
      d.exec("BEGIN IMMEDIATE");
      try {
        let before: Record<string, unknown> | null = null;
        if (a.op === "update") {
          const k = compileKeySelect(a.object, a.key!);
          const rows = d.prepare(k.sql).all(...bind(k.params)) as Record<string, unknown>[];
          if (rows.length !== 1) throw new Error(ERR.updateMustTouchExactly(rows.length));
          before = normalizeRow(rows[0], none);
          const changed = changedColumn(before, a.expect);
          if (changed) throw new Error(ERR.rowChangedSinceReview(changed));
        }
        const rows = d.prepare(`${s.sql} RETURNING *`).all(...bind(s.params)) as Record<string, unknown>[];
        if (rows.length !== 1) throw new Error(ERR.updateMustTouchExactly(rows.length));
        const after = normalizeRow(rows[0], none);
        d.exec(opts.rehearse ? "ROLLBACK" : "COMMIT");
        const id = a.op === "insert" ? insertedRef(after) : undefined;
        return { affected: 1, ms: Date.now() - t0, before, after, rehearsed: !!opts.rehearse, ...(id ? { id } : {}) };
      } catch (err) {
        if (d.inTransaction) d.exec("ROLLBACK");
        throw err;
      }
    },

    async close() { handle?.close(); handle = null; },
  };
}
