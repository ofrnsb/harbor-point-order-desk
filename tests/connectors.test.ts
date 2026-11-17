import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { CatalogObject, ScopedAggregate, ScopedSelect } from "../src/platform/contract.ts";
import { compileAggregate, compileKeySelect, compileSelect, compileWrite, escapeLike, normalizeRow } from "../src/platform/connectors/sql.ts";

const col = (name: string, type: "text" | "number" | "date" = "text") => ({ name, type, nativeType: type, nullable: true, pk: false, label: name, description: "", sensitivity: "internal" as const, sensitivitySource: "auto" as const });
const invoices: CatalogObject = {
  connectionId: "c1", name: "invoices", kind: "table", label: "Invoices", description: "", rowEstimate: 10, exposed: true, primaryKey: ["invoice_no"],
  columns: [col("invoice_no"), col("branch"), col("amount", "number"), col("due_date", "date"), col("status"), col("customer_name")],
};
const sel = (over: Partial<ScopedSelect> = {}): ScopedSelect => ({ kind: "select", object: invoices, columns: ["invoice_no", "amount"], filters: [], limit: 50, offset: 0, ...over });
const agg = (over: Partial<ScopedAggregate> = {}): ScopedAggregate => ({ kind: "aggregate", object: invoices, metrics: [{ fn: "sum", column: "amount", as: "total" }], groupBy: ["branch"], filters: [], minGroupSize: 1, limit: 100, ...over });

/** A real SQLite database, so every compiled statement is also run and its rows checked. */
function seeded(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE invoices (invoice_no TEXT PRIMARY KEY, branch TEXT, amount REAL, due_date TEXT, status TEXT, customer_name TEXT)`);
  const ins = db.prepare("INSERT INTO invoices VALUES (?, ?, ?, ?, ?, ?)");
  ins.run("INV-1", "EAST", 1200, "2026-10-05", "open", "Bluefin Bistro 100% Organic");
  ins.run("INV-2", "EAST", 300, "2026-10-20", "partial", "Oak_Ember Steakhouse");
  ins.run("INV-3", "WEST", 800, "2026-11-02", "open", "Harborview Hotel");
  return db;
}
const run = (db: Database.Database, c: { sql: string; params: unknown[] }) => db.prepare(c.sql).all(...(c.params as never[])) as Record<string, unknown>[];

test("a select quotes identifiers and keeps values out of the SQL", () => {
  const injection = "EAST'; DROP TABLE invoices; --";
  const { rows, count } = compileSelect(sel({ filters: [{ column: "branch", op: "eq", value: injection, scope: true }, { column: "amount", op: "gt", value: 100 }], sort: { column: "amount", dir: "desc" } }));
  assert.equal(rows.sql, `SELECT "invoice_no", "amount" FROM "invoices" WHERE "branch" = ? AND "amount" > ? ORDER BY "amount" DESC LIMIT 50 OFFSET 0`);
  assert.deepEqual(rows.params, [injection, 100]);
  assert.equal(count.sql, `SELECT COUNT(*) AS n FROM "invoices" WHERE "branch" = ? AND "amount" > ?`);
  const db = seeded();
  assert.deepEqual(run(db, rows), []);
  assert.equal(run(db, { sql: "SELECT COUNT(*) AS n FROM invoices", params: [] })[0].n, 3, "the injected text never ran");
});

test("every filter operator compiles to SQL that SQLite runs with the right rows", () => {
  const db = seeded();
  const ids = (filters: ScopedSelect["filters"]) => run(db, compileSelect(sel({ filters, sort: { column: "invoice_no", dir: "asc" } })).rows).map((r) => r.invoice_no);
  assert.deepEqual(ids([{ column: "status", op: "in", value: ["open", "partial"] }]), ["INV-1", "INV-2", "INV-3"]);
  assert.deepEqual(ids([{ column: "status", op: "in", value: [] }]), [], "an empty IN list matches nothing");
  assert.deepEqual(ids([{ column: "due_date", op: "between", value: ["2026-10-01", "2026-10-31"] }]), ["INV-1", "INV-2"]);
  assert.deepEqual(ids([{ column: "amount", op: "lte", value: 800 }, { column: "branch", op: "neq", value: "WEST" }]), ["INV-2"]);
  assert.deepEqual(ids([{ column: "customer_name", op: "is_null" }]), []);
  assert.throws(() => compileSelect(sel({ filters: [{ column: "due_date", op: "between", value: ["2026-10-01"] }] })), /between/i);
});

test("unknown or malicious column names are rejected before any SQL is built", () => {
  assert.throws(() => compileSelect(sel({ columns: ["invoice_no", "salary"] })), /Unknown column salary/);
  assert.throws(() => compileSelect(sel({ filters: [{ column: "x\"; DROP", op: "eq", value: 1 }] })), /Unknown column/);
  assert.throws(() => compileAggregate(agg({ groupBy: ["ssn"] })), /Unknown column ssn/);
  assert.throws(() => compileAggregate(agg({ metrics: [{ fn: "sum", column: "amount", as: "t\"; DROP" }] })), /Invalid identifier/);
  assert.throws(() => compileAggregate(agg({ sort: { column: "amount", dir: "asc" } })), /Cannot sort/);
});

test("contains escapes LIKE wildcards and ignores case", () => {
  assert.equal(escapeLike("50%_off!"), "50!%!_off!!");
  const db = seeded();
  const pct = compileSelect(sel({ filters: [{ column: "customer_name", op: "contains", value: "100%" }] })).rows;
  assert.match(pct.sql, /LOWER\("customer_name"\) LIKE \? ESCAPE '!'/);
  assert.deepEqual(pct.params, ["%100!%%"]);
  assert.deepEqual(run(db, pct).map((r) => r.invoice_no), ["INV-1"]);
  const under = compileSelect(sel({ filters: [{ column: "customer_name", op: "contains", value: "OAK_ember" }] })).rows;
  assert.deepEqual(run(db, under).map((r) => r.invoice_no), ["INV-2"], "_ is a literal underscore, and case does not matter");
});

test("limits are capped at 200 rows for selects and 500 groups for aggregates", () => {
  assert.match(compileSelect(sel({ limit: 10_000 })).rows.sql, /LIMIT 200 OFFSET 0$/);
  assert.match(compileAggregate(agg({ limit: 9_999 })).sql, /LIMIT 500$/);
});

test("aggregates add a row count, bucket by month and drop small groups when minGroupSize > 1", () => {
  const db = seeded();
  const a = compileAggregate(agg({ bucket: { column: "due_date", unit: "month" }, sort: { column: "total", dir: "desc" } }));
  assert.equal(a.sql, `SELECT "branch" AS "branch", strftime('%Y-%m-01', "due_date") AS "due_date_month", SUM("amount") AS "total", COUNT(*) AS "__n" FROM "invoices" GROUP BY "branch", strftime('%Y-%m-01', "due_date") ORDER BY "total" DESC LIMIT 100`);
  assert.deepEqual(run(db, a), [
    { branch: "EAST", due_date_month: "2026-10-01", total: 1500, __n: 2 },
    { branch: "WEST", due_date_month: "2026-11-01", total: 800, __n: 1 },
  ]);
  const small = compileAggregate(agg({ minGroupSize: 2 }));
  assert.match(small.sql, /HAVING COUNT\(\*\) >= 2/);
  assert.deepEqual(run(db, small).map((r) => r.branch), ["EAST"]);
  assert.doesNotMatch(compileAggregate(agg()).sql, /HAVING/);
});

test("writes are parameterized inserts or single-key updates", () => {
  const db = seeded();
  const ins = compileWrite({ object: "invoices", op: "insert", values: { invoice_no: "INV-4", branch: "WEST", amount: 42.5 } });
  assert.equal(ins.sql, `INSERT INTO "invoices" ("invoice_no", "branch", "amount") VALUES (?, ?, ?)`);
  db.prepare(ins.sql).run(...(ins.params as never[]));
  const up = compileWrite({ object: "invoices", op: "update", key: { column: "invoice_no", value: "INV-4" }, values: { status: "open" } });
  assert.equal(up.sql, `UPDATE "invoices" SET "status" = ? WHERE "invoice_no" = ?`);
  assert.deepEqual(up.params, ["open", "INV-4"]);
  db.prepare(up.sql).run(...(up.params as never[]));
  assert.deepEqual(run(db, compileKeySelect("invoices", { column: "invoice_no", value: "INV-4" })).map((r) => [r.amount, r.status]), [[42.5, "open"]]);
  assert.throws(() => compileWrite({ object: "t", op: "update", values: { a: 1 } }), /needs a key/);
  assert.throws(() => compileWrite({ object: "t", op: "insert", values: {} }), /value/i);
});

test("normalizeRow turns driver values into plain JSON", () => {
  const out = normalizeRow({ amount: "1250.50", invoice_no: "007", at: new Date("2026-11-02T12:00:00Z"), big: 12n }, new Set(["amount"]));
  assert.deepEqual(out, { amount: 1250.5, invoice_no: "007", at: "2026-11-02T12:00:00.000Z", big: 12 });
});
