import assert from "node:assert/strict";
import { before, test } from "node:test";
import { freshStore } from "./fixtures/tenant.ts";

let setup: typeof import("../src/platform/setup.ts");
let org: typeof import("../src/platform/org.ts");
let store: Awaited<ReturnType<typeof freshStore>>["store"];
before(async () => {
  ({ store } = await freshStore());
  delete process.env.SIMPUL_TENANT;
  setup = await import("../src/platform/setup.ts");
  org = await import("../src/platform/org.ts");
});

const input = { company: { name: "Harbor Logistics", legalName: "Harbor Logistics LLC", industry: "Logistics", timezone: "America/New_York", levels: ["Company", "Division", "Team"] }, admin: { name: "Andi Walsh", email: "Andi@HarborLogistics.example", title: "IT Manager", password: "first-admin-pass-42" } };

test("before setup there is no company to serve", () => {
  assert.throws(() => org.currentTenant(), /\/setup/);
});

test("setup creates a working company once, with an admin who can act right away", () => {
  const r = setup.setupCompany(input)!;
  assert.equal(r.tenant.id, "harbor-logistics");
  assert.equal(org.currentTenant().id, "harbor-logistics", "the only tenant is served without SIMPUL_TENANT");
  assert.equal(r.admin.email, "andi@harborlogistics.example");
  assert.deepEqual(r.admin.platformRoles, ["company_admin", "security_admin"]);
  const eff = org.resolveEffective(r.admin.id, "harbor-logistics-root");
  assert.equal(eff.can.administer, true);
  assert.deepEqual(eff.data, {}, "a new company sees no data until a database is connected and granted");
  assert.deepEqual(eff.models, []);
  assert.deepEqual(store.list("route", "harbor-logistics"), [], "new companies choose their own model provider");
  assert.equal(store.auditAll("harbor-logistics").at(-1)?.target, "setup");
  assert.equal(setup.setupCompany({ ...input, company: { ...input.company, name: "Other" } }), null, "a second setup is refused");
  assert.equal(store.listTenants().length, 1);
});

test("the first admin signs in with the setup password, which is stored only as a hash", async () => {
  const { signIn } = await import("../src/platform/sign-in.ts");
  const tenant = org.currentTenant();
  const hash = store.passwordHashOf("u-andi");
  assert.ok(hash && hash.startsWith("scrypt$") && !hash.includes("first-admin-pass-42"));
  assert.equal(signIn(tenant, "andi@harborlogistics.example", "first-admin-pass-42")?.id, "u-andi");
  assert.equal(signIn(tenant, "andi@harborlogistics.example", "wrong-password-00"), null);
  assert.throws(() => setup.SetupS.parse({ ...input, admin: { ...input.admin, password: "short" } }), "a password under the minimum is refused");
});
