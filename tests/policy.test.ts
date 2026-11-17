import assert from "node:assert/strict";
import { before, test } from "node:test";
import { seedFixture } from "./fixtures/tenant.ts";

let org: typeof import("../src/platform/org.ts");
let policy: typeof import("../src/platform/policy.ts");
let store: Awaited<ReturnType<typeof seedFixture>>;
before(async () => { store = await seedFixture(); org = await import("../src/platform/org.ts"); policy = await import("../src/platform/policy.ts"); });
const inv = () => store.get("catalog", "c-erp/invoices")!;
const emp = () => store.get("catalog", "c-hr/employees")!;

test("select adds the team's row filter and marks it as scope", () => {
  const plan = policy.planSelect(org.resolveEffective("u-op", "ar-east"), inv(), { filters: [{ column: "amount", op: "gt", value: 10 }] }, { external: false });
  assert.deepEqual(plan.query.filters.at(-1), { column: "branch", op: "eq", value: "EAST", scope: true });
  assert.equal(plan.query.filters.length, 2);
  assert.deepEqual(plan.touch.scope, ["branch = EAST"]);
  assert.ok(!plan.query.columns.includes("ssn"));
  assert.equal(plan.masks.phone, "hash");
});

test("select refuses denied, aggregate-only and protected filter columns", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.throws(() => policy.planSelect(eff, inv(), { columns: ["ssn"] }, { external: false }), (e: Error & { code?: string }) => e.code === "column_denied");
  assert.throws(() => policy.planSelect(eff, inv(), { filters: [{ column: "phone", op: "eq", value: "1" }] }, { external: false }), /protected/);
  assert.throws(() => policy.planSelect(eff, inv(), { sort: { column: "phone", dir: "asc" } }, { external: false }), /Cannot sort/);
  const exec = org.resolveEffective("u-dir", "exec");
  assert.throws(() => policy.planSelect(exec, emp(), { columns: ["base_salary"] }, { external: false }), (e: Error & { code?: string }) => e.code === "aggregate_only");
  assert.throws(() => policy.planSelect(exec, store.get("catalog", "c-erp/secret_table")!, {}, { external: false }), (e: Error & { code?: string }) => e.code === "out_of_scope");
});

test("restricted columns visible in clear are masked when the model is external", () => {
  const hr = org.resolveEffective("u-hr", "hr");
  assert.equal(policy.planSelect(hr, emp(), {}, { external: false }).masks.base_salary, undefined);
  assert.equal(policy.planSelect(hr, emp(), {}, { external: true }).masks.base_salary, "mask");
  assert.equal(policy.planSelect(hr, emp(), {}, { external: false }).masks.national_id, "mask");
});

test("aggregate-only columns allow sum and avg in protected groups, never min or max", () => {
  const exec = org.resolveEffective("u-dir", "exec");
  const plan = policy.planAggregate(exec, emp(), { metrics: [{ fn: "avg", column: "base_salary" }], groupBy: ["department"] }, { external: false });
  assert.equal(plan.query.minGroupSize, 5);
  assert.deepEqual(plan.touch.aggregated, ["base_salary"]);
  assert.throws(() => policy.planAggregate(exec, emp(), { metrics: [{ fn: "max", column: "base_salary" }] }, { external: false }), /individual/);
  assert.equal(policy.planAggregate(exec, emp(), { metrics: [{ fn: "count" }], groupBy: ["department"] }, { external: false }).query.minGroupSize, 1);
  assert.throws(() => policy.planAggregate(exec, emp(), { metrics: [{ fn: "count" }], groupBy: ["base_salary"] }, { external: false }), /Cannot group/);
});

test("masking and hashing", () => {
  assert.equal(policy.maskValue("123-45-6789"), "••••6789");
  assert.equal(policy.maskValue("sam.ortiz@harborpointsupply.example"), "s•••@harborpointsupply.example");
  assert.equal(policy.maskValue(12500), "•••");
  assert.equal(policy.maskValue(null), null);
  assert.equal(policy.hashValue("617-555-0142", "t1"), policy.hashValue("617-555-0142", "t1"));
  assert.notEqual(policy.hashValue("617-555-0142", "t1"), policy.hashValue("617-555-0142", "t2"));
  const rows = policy.shapeRows([{ a: "617-555-0142", b: "x", __n: 9 }], { a: "hash" }, "t1");
  assert.match(String(rows[0].a), /^#[0-9a-f]{12}$/);
  assert.equal(rows[0].b, "x");
  assert.equal("__n" in rows[0], false);
});

test("a user who can read restricted data is routed to the internal model, or masked when none is active", () => {
  const hr = org.resolveEffective("u-hr", "hr");
  const routed = policy.chooseRoute(hr, store.list("route", "t1"));
  assert.equal(routed.route.id, "local");
  assert.equal(routed.use.rerouted, true);
  const noLocal = policy.chooseRoute(hr, store.list("route", "t1").filter((r) => r.id !== "local"));
  assert.equal(noLocal.external, true);
  assert.match(noLocal.use.reason ?? "", /masked/);
  const ar = policy.chooseRoute(org.resolveEffective("u-op", "ar-east"), store.list("route", "t1"));
  assert.equal(ar.route.id, "ext", "no restricted data in scope, no reroute");
});

test("approval needed above the threshold or for high risk", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.equal(policy.needsApproval(eff, "low", 100), false);
  assert.equal(policy.needsApproval(eff, "low", 101), true);
  assert.equal(policy.needsApproval(eff, "high", null), true);
  assert.equal(policy.needsApproval(eff, "low", null), false);
});

test("an unknown column is a bad request that names the usable columns, never a denied one", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.throws(() => policy.planSelect(eff, inv(), { columns: ["name"] }, { external: false }), (e: Error & { code?: string }) =>
    e.code === "bad_request" && /Column name is not/.test(e.message) && /invoice_no/.test(e.message) && !/ssn/.test(e.message));
  assert.throws(() => policy.planSelect(eff, inv(), { filters: [{ column: "full_name", op: "eq", value: "x" }] }, { external: false }), (e: Error & { code?: string }) => e.code === "bad_request");
});
