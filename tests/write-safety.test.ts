// Writes against a real SQLite system: rehearsal leaves nothing behind, scope covers what a write names, an approval
// executes once, a row changed after review is not overwritten, and aggregate-only columns cannot be differenced.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { freshStore } from "./fixtures/tenant.ts";

const { store, dir } = await freshStore();
const { storeCredentials } = await import("../src/platform/secrets.ts");
const { introspectConnection } = await import("../src/platform/catalog.ts");
const { resolveEffective } = await import("../src/platform/org.ts");
const { prepareWrite, rehearseWrite } = await import("../src/platform/write-guard.ts");
const { createWorkItem, confirmWorkItem, decideWorkItem, viewOf } = await import("../src/platform/work.ts");
const { guardDifferencing } = await import("../src/platform/disclosure.ts");
const { PolicyError } = await import("../src/platform/policy.ts");
const { withNames } = await import("../src/platform/names.ts");

const file = path.join(dir, "erp.db");
const rows = (sql: string) => new Database(file, { readonly: true }).prepare(sql).all() as Record<string, unknown>[];
const p = (x: Record<string, unknown> = {}) => ({ description: "", glossary: [], rules: [], grants: null, actions: null, models: null, clearance: null, budgetMonthly: null, approvalOver: null, attributes: {}, ...x });

before(async () => {
  const src = new Database(file);
  src.exec(`CREATE TABLE outlets (outlet_code TEXT PRIMARY KEY, region_code TEXT NOT NULL, outlet_name TEXT NOT NULL);
    CREATE TABLE credit_limits (outlet_code TEXT PRIMARY KEY, region_code TEXT NOT NULL, credit_limit INTEGER NOT NULL);
    CREATE TABLE limit_requests (request_id INTEGER PRIMARY KEY AUTOINCREMENT, outlet_code TEXT NOT NULL, requested_limit INTEGER NOT NULL, requested_by TEXT NOT NULL);
    INSERT INTO outlets VALUES ('OUT-EAST-00042','EAST','Bluefin Bistro Group'), ('OUT-WEST-00117','WEST','Harborview Hotel');
    INSERT INTO credit_limits VALUES ('OUT-EAST-00042','EAST',40000), ('OUT-WEST-00117','WEST',6000);`);
  src.close();
  const { put, setMembership } = store;
  put("tenant", { id: "t1", name: "T", legalName: "T Inc.", industry: "x", timezone: "America/New_York", locale: "en-US", currency: "USD", levels: ["Company", "Division", "Team"], restrictedRouting: "mask", sensitivityDefaults: { public: "show", internal: "show", confidential: "mask", restricted: "hash" }, minGroupSize: 5 });
  put("connection", { id: "c-erp", tenantId: "t1", code: "ERP", name: "ERP", kind: "sqlite", config: { file }, readSecret: storeCredentials("t1", {}), writeSecret: storeCredentials("t1", {}), status: "ok", statusNote: "", introspectedAt: null });
  await introspectConnection("c-erp");
  const region = [{ column: "region_code", op: "eq", value: "{user.region_code}" }];
  put("unit", { id: "root", tenantId: "t1", parentId: null, name: "T", code: "T", profile: p({ grants: [{ connectionId: "c-erp", objects: "*" }], clearance: "restricted", actions: ["raise", "set"], approvalOver: 50_000 }) });
  put("unit", { id: "east", tenantId: "t1", parentId: "root", name: "Sales East", code: "EAST", profile: p({ grants: [{ connectionId: "c-erp", objects: [{ object: "outlets", rowFilters: region }, { object: "credit_limits", rowFilters: region }, { object: "limit_requests" }] }] }) });
  put("unit", { id: "ar", tenantId: "t1", parentId: "root", name: "AR", code: "AR", profile: p() });
  for (const [id, attrs] of [["u-east", { region_code: "EAST" }], ["u-ar", {}], ["u-boss", {}]] as const) put("user", { id, tenantId: "t1", email: `${id}@t.example`, name: id, title: id, attributes: attrs, platformRoles: [], active: true });
  setMembership({ userId: "u-east", unitId: "east", role: "operator" });
  setMembership({ userId: "u-ar", unitId: "ar", role: "operator" });
  setMembership({ userId: "u-boss", unitId: "root", role: "approver" });
  const fields = [{ column: "outlet_code", label: "Outlet", kind: "text" as const, required: true }, { column: "requested_limit", label: "Limit", kind: "number" as const, required: true }, { column: "requested_by", label: "By", kind: "text" as const, required: true, fixed: "{user.name}" }];
  put("action", { id: "raise", tenantId: "t1", name: "Raise", description: "", connectionId: "c-erp", object: "limit_requests", op: "insert", fields, amountField: "requested_limit", risk: "low", owner: "AR", receiptPrefix: "CLR" });
  put("action", { id: "set", tenantId: "t1", name: "Set limit", description: "", connectionId: "c-erp", object: "credit_limits", op: "update", keyColumn: "outlet_code", fields: [{ column: "credit_limit", label: "Limit", kind: "number", required: true }, { column: "region_code", label: "Region", kind: "text", required: false }], risk: "low", owner: "AR", receiptPrefix: "CLS" });
});

const tpl = (id: string) => store.get("action", id)!;
const conn = () => store.get("connection", "c-erp")!;
async function proposal(user: string, unit: string, templateId: string, params: Record<string, unknown>, key?: unknown) {
  const eff = resolveEffective(user, unit);
  const { compiled, facts } = await prepareWrite(eff, tpl(templateId), params, key);
  const r = await rehearseWrite(eff, tpl(templateId), conn(), compiled);
  const amount = typeof params.requested_limit === "number" ? params.requested_limit : null;
  const item = createWorkItem({ tenantId: "t1", templateId, title: templateId, chatId: "c1", actionId: `act_${Math.random()}`, requestedBy: user, unitId: unit, params, key, amount: amount, needsApproval: (amount ?? 0) > 50_000, preview: { before: r.before, after: r.after } }, "X");
  return { item, facts, r };
}

test("a rehearsal shows the stored row and leaves nothing behind", async () => {
  const { r, facts } = await proposal("u-ar", "ar", "raise", { outlet_code: "OUT-EAST-00042", requested_limit: 45_000 });
  assert.equal(r.rehearsed, true);
  assert.equal(r.after?.outlet_code, "OUT-EAST-00042");
  assert.equal(r.after?.requested_by, "u-ar", "fixed fields are filled by the server");
  assert.equal(rows("SELECT * FROM limit_requests").length, 0, "rolled back");
  assert.ok(facts.some((f) => f.object === "credit_limits" && f.fields.some((x) => x.value.includes("40"))), "the current limit is shown from the system, not from the request");
});

test("a write may not name a record outside the requester's row scope, nor one that does not exist", async () => {
  await assert.rejects(proposal("u-east", "east", "raise", { outlet_code: "OUT-WEST-00117", requested_limit: 8_000 }), (e: unknown) => e instanceof PolicyError && e.code === "out_of_scope");
  await assert.rejects(proposal("u-ar", "ar", "raise", { outlet_code: "OUT-XXX-99999", requested_limit: 8_000 }), PolicyError);
  await assert.doesNotReject(proposal("u-east", "east", "raise", { outlet_code: "OUT-EAST-00042", requested_limit: 8_000 }));
  assert.equal(rows("SELECT * FROM limit_requests").length, 0);
});

test("an update may not move its row out of the requester's scope", async () => {
  await assert.rejects(proposal("u-east", "east", "set", { credit_limit: 1, region_code: "WEST" }, "OUT-EAST-00042"), (e: unknown) => e instanceof PolicyError && e.code === "out_of_scope");
  assert.equal(rows("SELECT region_code FROM credit_limits WHERE outlet_code='OUT-EAST-00042'")[0].region_code, "EAST");
});

test("two approvals at the same instant write once", async () => {
  const { item } = await proposal("u-ar", "ar", "raise", { outlet_code: "OUT-EAST-00042", requested_limit: 95_000 });
  const confirmed = await confirmWorkItem("t1", item.actionId);
  assert.equal(confirmed.awaitingApproval, true, "a confirmation that still needs an approver says so, it is not 'executed'");
  assert.equal(store.get("work", item.id)!.state, "awaiting_approval");
  const both = await Promise.allSettled([decideWorkItem(item.id, "u-boss", "approve"), decideWorkItem(item.id, "u-boss", "approve")]);
  assert.deepEqual(both.map((b) => b.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(rows("SELECT * FROM limit_requests WHERE requested_limit = 95000").length, 1);
  const done = store.get("work", item.id)!;
  assert.equal(done.state, "executed");
  assert.equal(done.images?.after?.requested_limit, 95_000, "the stored row is kept for audit");
  assert.equal("images" in viewOf(done) || "preview" in viewOf(done), false, "row images never leave the server");
  const ev = store.auditAll("t1").find((e) => e.kind === "execute" && (e.detail as { ref?: string }).ref === done.ref)!;
  assert.deepEqual(Object.keys((ev.detail as { changed: object }).changed).sort(), ["outlet_code", "requested_by", "requested_limit"], "the audit keeps the written columns only");
});

test("a row changed after review is not overwritten", async () => {
  const { item } = await proposal("u-ar", "ar", "set", { credit_limit: 7_000 }, "OUT-WEST-00117");
  const db = new Database(file); db.prepare("UPDATE credit_limits SET credit_limit = 6500 WHERE outlet_code = 'OUT-WEST-00117'").run(); db.close();
  await assert.rejects(confirmWorkItem("t1", item.actionId), /changed after it was reviewed/);
  assert.equal(rows("SELECT credit_limit FROM credit_limits WHERE outlet_code='OUT-WEST-00117'")[0].credit_limit, 6_500);
  assert.equal(store.get("work", item.id)!.state, "failed");
});

test("an unchanged row is updated, inside the transaction that checked it", async () => {
  const { item } = await proposal("u-ar", "ar", "set", { credit_limit: 42_000 }, "OUT-EAST-00042");
  await confirmWorkItem("t1", item.actionId);
  assert.equal(rows("SELECT credit_limit FROM credit_limits WHERE outlet_code='OUT-EAST-00042'")[0].credit_limit, 42_000);
  const done = store.get("work", item.id)!;
  assert.equal(done.images?.before?.credit_limit, 40_000);
});

test("aggregate-only totals that differ by fewer than the group size are refused", () => {
  const eff = resolveEffective("u-ar", "ar");
  const obj = store.get("catalog", "c-erp/outlets")!;
  const f = (column: string, op: string, value: unknown) => ({ column, op, value }) as never;
  guardDifferencing(eff, obj, ["salary"], [f("region_code", "eq", "NORTH")], [], undefined, [{ __n: 25 }], 5);
  assert.throws(() => guardDifferencing(eff, obj, ["salary"], [f("region_code", "eq", "NORTH"), f("position", "in", ["Driver", "Picker"])], [], undefined, [{ __n: 24 }], 5), PolicyError);
  assert.throws(() => guardDifferencing(eff, obj, ["salary"], [f("join_date", "lt", "2020-01-01")], [], undefined, [{ __n: 27 }], 5), PolicyError, "ranges can nest, so they are compared too");
  assert.doesNotThrow(() => guardDifferencing(eff, obj, ["salary"], [], ["region_code"], undefined, [{ region_code: "WEST", __n: 23 }, { region_code: "EAST", __n: 50 }], 5), "groups pinned to other values are disjoint");
  assert.doesNotThrow(() => guardDifferencing(eff, obj, ["salary"], [f("region_code", "eq", "NORTH")], [], undefined, [{ __n: 25 }], 5), "repeating a total reveals nothing");
  assert.throws(() => guardDifferencing(eff, obj, ["salary"], [f("region_code", "eq", "EAST")], [], undefined, [{ sum: 1 }], 5), PolicyError, "a result without group sizes cannot be checked, so it is refused");
  assert.doesNotThrow(() => guardDifferencing(resolveEffective("u-boss", "root"), obj, ["salary"], [f("region_code", "eq", "NORTH"), f("position", "neq", "Supervisor")], [], undefined, [{ __n: 24 }], 5), "the history is per user");
});

test("no connector compiles a delete", () => {
  const dir = "src/platform/connectors";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.includes("sql.ts") && files.includes("sqlite.ts"), files.join(", "));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), "utf8"), /DELETE\s/i, f);
});

test("a code in a result reads with the name it points at, only where the reader may see that record", async () => {
  const obj = store.get("catalog", "c-erp/limit_requests")!;
  const reads: string[] = [];
  const rows = [{ request_id: 1, outlet_code: "OUT-EAST-00042", requested_limit: 1 }, { request_id: 2, outlet_code: "OUT-WEST-00117", requested_limit: 2 }];
  const boss = await withNames(resolveEffective("u-boss", "root"), obj, rows, false, (r) => reads.push(r.target.name));
  assert.deepEqual(boss.added.map((a) => [a.name, a.after]), [["outlet_code_name", "outlet_code"]]);
  assert.deepEqual(boss.rows.map((r) => r.outlet_code_name), ["Bluefin Bistro Group", "Harborview Hotel"], "the object that names outlets is used, not credit_limits on the same key");
  assert.deepEqual(Object.keys(boss.rows[0]), ["request_id", "outlet_code", "outlet_code_name", "requested_limit"], "the name sits beside its code");
  assert.deepEqual(reads, ["outlets"], "the lookup is reported so it is audited like any read");
  const east = await withNames(resolveEffective("u-east", "east"), obj, rows, false, () => {});
  assert.deepEqual(east.rows.map((r) => r.outlet_code_name), ["Bluefin Bistro Group", null], "an East seller gets no name for a West outlet");
  const none = await withNames(resolveEffective("u-boss", "root"), obj, [], false, () => assert.fail("no rows, no read"));
  assert.deepEqual(none.added, []);
});
