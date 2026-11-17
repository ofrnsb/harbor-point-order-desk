import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { sqliteConnector } from "../src/platform/connectors/sqlite.ts";
import type { CatalogObject, Connection } from "../src/platform/contract.ts";

const make = (file: string, value: string) => {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  const d = new Database(file);
  d.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
  d.prepare("INSERT INTO t VALUES ('a', ?)").run(value);
  d.close();
};

test("a re-seeded SQLite file is read fresh, not from the old open handle", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sp-sqlite-")), "x.db");
  make(file, "old");
  const conn = { id: "c", kind: "sqlite", config: { file } } as Connection;
  const obj = { connectionId: "c", name: "t", columns: [{ name: "id", type: "text" }, { name: "v", type: "text" }] } as CatalogObject;
  const c = sqliteConnector(conn, "read");
  const q = { kind: "select" as const, object: obj, columns: ["v"], filters: [], limit: 5, offset: 0 };
  assert.equal((await c.select(q)).rows[0].v, "old");
  make(file, "new");
  assert.equal((await c.select(q)).rows[0].v, "new");
  await c.close();
});
