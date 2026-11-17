import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { ActionTemplate } from "../src/platform/contract.ts";
import { classifyColumn, columnType, humanLabel } from "../src/platform/classify.ts";
import { compileAction, parseAmount } from "../src/platform/catalog.ts";
import { seedErp } from "../src/platform/seed/erp.ts";
import { DATA_PACK_DB, ERP_TABLES } from "../src/config/erp.ts";

test("classifyColumn reads sensitivity from column names", () => {
  for (const n of ["ssn", "bank_account_no", "base_salary", "birth_date", "religion"]) assert.equal(classifyColumn(n, "text", []), "restricted", n);
  for (const n of ["email", "phone", "address", "full_name"]) assert.equal(classifyColumn(n, "text", []), "confidential", n);
  for (const n of ["credit_limit", "amount", "unit_price", "so_number"]) assert.equal(classifyColumn(n, "numeric", []), "internal", n);
  for (const n of ["category", "segment", "status", "branch"]) assert.equal(classifyColumn(n, "text", []), "public", n);
});

test("classifyColumn falls back to sample values when the name says nothing", () => {
  assert.equal(classifyColumn("id_number", "text", ["078-05-1120", "219-09-9999", "457-55-5462"]), "restricted");
  assert.equal(classifyColumn("contact", "text", ["maria@bluefinbistro.example", "chef@oakandember.example"]), "confidential");
  assert.equal(classifyColumn("contact", "text", ["(617) 555-0142", "+1 401-555-0199"]), "confidential");
  assert.equal(classifyColumn("remark", "text", ["Morning delivery", "Call the dock first"]), "internal");
});

test("humanLabel and columnType", () => {
  assert.equal(humanLabel("credit_limit"), "Credit limit");
  assert.equal(humanLabel("sell_uom"), "Sell UoM");
  assert.equal(humanLabel("customerCode"), "Customer code");
  assert.equal(columnType("numeric(16,2)"), "number");
  assert.equal(columnType("timestamp with time zone"), "date");
  assert.equal(columnType("tinyint(1)"), "bool");
  assert.equal(columnType("jsonb"), "json");
  assert.equal(columnType("character varying"), "text");
});

test("parseAmount reads US-formatted amounts and refuses anything else", () => {
  assert.equal(parseAmount("1250000"), 1_250_000);
  assert.equal(parseAmount("1,250,000"), 1_250_000);
  assert.equal(parseAmount("$1,250,000.50"), 1_250_000.5);
  assert.equal(parseAmount("39.5"), 39.5);
  assert.ok(Number.isNaN(parseAmount("1.250.000")), "a European thousands separator is not guessed");
  assert.ok(Number.isNaN(parseAmount("twelve")));
});

const cancel: ActionTemplate = {
  id: "a1", tenantId: "t", name: "Log a customer case", description: "", connectionId: "erp", object: "customer_cases", op: "insert",
  fields: [
    { column: "customer_id", label: "Customer", kind: "text", required: true },
    { column: "channel", label: "Channel", kind: "choice", required: true, options: ["Email", "Phone"] },
    { column: "message", label: "Message", kind: "text", required: false },
    { column: "logged_by", label: "Logged by", kind: "text", required: true, fixed: "{user.name}" },
    { column: "unit_code", label: "Team", kind: "text", required: true, fixed: "{unit.code}" },
    { column: "status", label: "Status", kind: "text", required: true, fixed: "open" },
    { column: "note", label: "Ref", kind: "text", required: false, fixed: "CASE-{rand} {today}" },
  ],
  risk: "low", owner: "Order Desk", receiptPrefix: "CASE",
};
const ctx = { userId: "u1", userName: "Sam Ortiz", unitCode: "OPS", now: "2026-11-02T12:00:00.000Z" };

test("compileAction builds the insert with fixed values resolved", () => {
  const a = compileAction(cancel, { customer_id: " C001 ", channel: "Email" }, undefined, ctx);
  assert.equal(a.op, "insert");
  assert.equal(a.object, "customer_cases");
  assert.equal(a.values.customer_id, "C001");
  assert.equal(a.values.logged_by, "Sam Ortiz");
  assert.equal(a.values.unit_code, "OPS");
  assert.equal(a.values.status, "open");
  assert.match(String(a.values.note), /^CASE-[0-9A-F]{6} 2026-11-02$/);
  assert.equal("message" in a.values, false);
});

test("compileAction rejects unknown, missing, wrong-kind and server-fixed fields", () => {
  assert.throws(() => compileAction(cancel, { customer_id: "C001", channel: "Email", amount: 5 }, undefined, ctx), /Unknown field amount/);
  assert.throws(() => compileAction(cancel, { channel: "Email" }, undefined, ctx), /Customer is required/);
  assert.throws(() => compileAction(cancel, { customer_id: "C001", channel: "Fax" }, undefined, ctx), /Channel must be one of/);
  assert.throws(() => compileAction(cancel, { customer_id: "C001", channel: "Email", logged_by: "CEO" }, undefined, ctx), /set by the system/);
});

test("compileAction coerces numbers and dates and requires a key for updates", () => {
  const t: ActionTemplate = { ...cancel, op: "update", object: "sales_orders", keyColumn: "so_number", fields: [
    { column: "priority", label: "Priority", kind: "number", required: true },
    { column: "requested_date", label: "Requested date", kind: "date", required: false },
    { column: "updated_at", label: "Updated", kind: "date", required: true, fixed: "{now}" },
  ] };
  const a = compileAction(t, { priority: "2", requested_date: "2026-11-05" }, "SO-24051", ctx);
  assert.deepEqual(a, { object: "sales_orders", op: "update", key: { column: "so_number", value: "SO-24051" }, values: { priority: 2, requested_date: "2026-11-05", updated_at: ctx.now } });
  assert.throws(() => compileAction(t, { priority: "two" }, "SO-24051", ctx), /must be a number/);
  assert.throws(() => compileAction(t, { priority: 1, requested_date: "Thursday" }, "SO-24051", ctx), /must be a date/);
  assert.throws(() => compileAction(t, { priority: 1 }, "", ctx), /needs the record key/);
});

test("the working ERP is a typed, consistent copy of the data pack", () => {
  const file = seedErp(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "harbor-erp-")), "erp.sqlite"));
  const db = new Database(file, { readonly: true });
  const pack = new Database(path.resolve(DATA_PACK_DB), { readonly: true });
  const count = (d: Database.Database, t: string) => (d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const packName: Record<string, string> = { [ERP_TABLES.inbox]: "" };
  for (const t of Object.values(ERP_TABLES).filter((t) => packName[t] === undefined)) assert.equal(count(db, t), count(pack, t), t);
  assert.equal(count(db, ERP_TABLES.inbox), 40, "the day's 40 emails are loaded");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "every reference resolves");
  assert.equal((db.prepare(`SELECT typeof(credit_limit) AS t FROM ${ERP_TABLES.customers} LIMIT 1`).get() as { t: string }).t, "real");
  // Allocated stock is exactly the unshipped quantity of orders that have not fully shipped.
  const unshipped = db.prepare(`SELECT l.sku, SUM(l.qty_ordered - l.qty_shipped) AS q FROM ${ERP_TABLES.orderLines} l JOIN ${ERP_TABLES.orders} o USING (so_number) WHERE o.status <> 'SHIPPED' GROUP BY l.sku`).all() as { sku: string; q: number }[];
  const allocated = new Map((db.prepare(`SELECT sku, allocated FROM ${ERP_TABLES.inventory} WHERE allocated > 0`).all() as { sku: string; allocated: number }[]).map((r) => [r.sku, r.allocated]));
  assert.deepEqual(new Map(unshipped.filter((r) => r.q > 0).map((r) => [r.sku, r.q])), allocated);
  pack.close();
  db.close();
});
