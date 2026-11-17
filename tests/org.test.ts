import assert from "node:assert/strict";
import { before, test } from "node:test";
import { seedFixture } from "./fixtures/tenant.ts";

let org: typeof import("../src/platform/org.ts");
let store: Awaited<ReturnType<typeof seedFixture>>;
before(async () => { store = await seedFixture(); org = await import("../src/platform/org.ts"); });

test("a team cannot loosen a column its division protects", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.equal(eff.data["c-erp"].invoices.columns.phone, "hash", "Finance hashed phone; AR East asking for show must not win");
});

test("sensitivity defaults follow the clearance in force at each level", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.equal(eff.clearance, "confidential");
  assert.equal(eff.data["c-erp"].invoices.columns.ssn, undefined, "restricted column above confidential clearance is denied");
  assert.equal(eff.data["c-erp"].invoices.columns.amount, "show");
});

test("objects outside the parent's grant and hidden objects are out of scope", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.deepEqual(Object.keys(eff.data["c-erp"]), ["invoices"]);
  assert.equal(eff.data["c-hr"], undefined, "Finance has no HR grant, so its teams have none");
});

test("row filter templates resolve from unit attributes", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.deepEqual(eff.data["c-erp"].invoices.rowFilters, [{ column: "branch", op: "eq", value: "EAST" }]);
});

test("a row filter whose attribute is missing closes the object instead of opening it", () => {
  const eff = org.resolveEffective("u-x", "ar-nobranch");
  assert.equal(eff.data["c-erp"], undefined);
});

test("budgets and approval thresholds take the lowest value on the path; actions intersect", () => {
  const eff = org.resolveEffective("u-op", "ar-east");
  assert.equal(eff.budgetMonthly, 400);
  assert.equal(eff.approvalOver, 100, "AR East's 900 cannot raise Finance's 100");
  assert.deepEqual(eff.actions, ["a1"]);
  assert.equal(eff.rules[0].locked, true);
});

test("roles decide what a member can do, and membership is required", () => {
  assert.equal(org.resolveEffective("u-view", "ar-east").can.propose, false);
  assert.equal(org.resolveEffective("u-op", "ar-east").can.propose, true);
  assert.throws(() => org.resolveEffective("u-op", "fin"), /not a member/);
});

test("validateProfile reports every widening and accepts a pure narrowing", () => {
  const unit = store.get("unit", "ar-east")!;
  const wide = { ...unit.profile, clearance: "restricted" as const, actions: ["a2"], budgetMonthly: 5000, grants: [{ connectionId: "c-hr", objects: [{ object: "employees" }] }, { connectionId: "c-erp", objects: [{ object: "invoices", columns: { phone: "show" as const } }] }] };
  const problems = org.validateProfile("ar-east", wide);
  assert.ok(problems.some((p) => /c-hr/.test(p)), "new connection");
  assert.ok(problems.some((p) => /phone/.test(p)), "looser column");
  assert.ok(problems.some((p) => /a2/.test(p)), "action outside parent");
  assert.ok(problems.some((p) => /Clearance/.test(p)));
  assert.ok(problems.some((p) => /budget/i.test(p)));
  assert.ok(problems.some((p) => /approval threshold/i.test(p)), "AR East's 900 is looser than Finance's 100");
  const narrow = { ...unit.profile, budgetMonthly: 100, approvalOver: 50, grants: [{ connectionId: "c-erp", objects: [{ object: "invoices", columns: { amount: "mask" as const } }] }] };
  assert.deepEqual(org.validateProfile("ar-east", narrow), []);
});

test("approvers decide for their unit and below, never for themselves or a sibling", () => {
  const item = { id: "w", tenantId: "t1", ref: "A-1", templateId: "a1", title: "x", chatId: "c", actionId: "a", requestedBy: "u-op", unitId: "ar-east", params: {}, amount: 200, needsApproval: true, state: "awaiting_approval" as const, createdAt: "", updatedAt: "" };
  assert.equal(org.canApprove("u-mgr", item), true);
  assert.equal(org.canApprove("u-op", item), false);
  assert.equal(org.canApprove("u-dir", item), false, "Executive approver is not above Finance's tree");
  assert.equal(org.canApprove("u-mgr", { ...item, requestedBy: "u-mgr" }), false);
  assert.equal(org.canApprove("u-mgr", { ...item, state: "executed" }), false);
});

