import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The route kit opens the platform store, so point it at a throwaway file before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simpul-routes-"));
process.env.SIMPUL_DB = path.join(dir, "test.db");
let kit: typeof import("../src/platform/route-kit.ts");
let store: typeof import("../src/platform/store.ts");

before(async () => {
  store = await import("../src/platform/store.ts");
  kit = await import("../src/platform/route-kit.ts");
});
after(() => { store.db().close(); fs.rmSync(dir, { recursive: true, force: true }); });

const req = (b: unknown) => new Request("http://x/api", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) });

test("handle passes thrown Responses through and turns errors into 500s", async () => {
  const r1 = await kit.handle(() => { throw new Response("no", { status: 401 }); });
  assert.equal(r1.status, 401);
  const orig = console.error; console.error = () => {};
  const r2 = await kit.handle(() => { throw new Error("connection lost"); });
  console.error = orig;
  assert.equal(r2.status, 500);
  assert.deepEqual(await r2.json(), { error: "connection lost" });
});

test("body() rejects bad JSON and invalid fields with a 400 naming the field", async () => {
  const thrown = async (p: Promise<unknown>) => { try { await p; } catch (r) { return r as Response; } throw new Error("expected a rejection"); };
  assert.equal((await thrown(kit.body(req("{not json"), kit.RouteS))).status, 400);
  const r = await thrown(kit.body(req({ label: "x" }), kit.RouteS));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /label|provider/);
});

test("route input: Claude login routes only take sonnet, haiku or opus", async () => {
  const ok = { label: "Claude (login dev)", provider: "claude-login", model: "sonnet", backend: "claude-sdk", external: true, fallbacks: [], inputPer1M: 0, outputPer1M: 0, active: true };
  assert.equal(kit.RouteS.safeParse(ok).success, true);
  assert.equal(kit.RouteS.safeParse({ ...ok, model: "gpt-4.1" }).success, false);
  assert.equal(kit.RouteS.safeParse({ ...ok, provider: "openai", model: "openai/company-model", backend: "litellm" }).success, true);
  assert.equal(kit.RouteS.safeParse({ ...ok, provider: "openai", backend: "claude-sdk" }).success, false);
  assert.equal(kit.RouteS.safeParse({ ...ok, provider: "claude-login", backend: "litellm" }).success, false);
});

test("action input: updates need a key column, prefixes are uppercase letters", () => {
  const base = { name: "Kirim reminder", description: "", connectionId: "cn_erp", object: "invoices", op: "update", fields: [{ column: "dunning_level", label: "Level", kind: "number", required: true }], risk: "low", owner: "Finance AR", receiptPrefix: "RMD" };
  assert.equal(kit.ActionTemplateS.safeParse(base).success, false);
  assert.equal(kit.ActionTemplateS.safeParse({ ...base, keyColumn: "invoice_no" }).success, true);
  assert.equal(kit.ActionTemplateS.safeParse({ ...base, keyColumn: "invoice_no", receiptPrefix: "rm-1" }).success, false);
});

test("profile input refuses identifiers that could smuggle SQL into a row filter", () => {
  const profile = { description: "", glossary: [], rules: [], grants: [{ connectionId: "cn_erp", objects: [{ object: "invoices", rowFilters: [{ column: "branch", op: "eq", value: "{user.branch}" }] }] }], actions: null, models: null, clearance: null, budgetMonthly: null, approvalOver: null, attributes: {} };
  assert.equal(kit.ProfileS.safeParse(profile).success, true);
  const evil = structuredClone(profile);
  evil.grants[0].objects[0].rowFilters[0].column = "branch' OR '1'='1";
  assert.equal(kit.ProfileS.safeParse(evil).success, false);
});

test("connection input: codes are short uppercase ids, the only kind is SQLite, a file is required", () => {
  const c = { code: "ERP", name: "Harbor Point ERP", kind: "sqlite", config: { file: "data/systems/harbor_erp.sqlite" }, read: {} };
  assert.equal(kit.ConnectionInputS.safeParse(c).success, true);
  assert.equal(kit.ConnectionInputS.safeParse({ ...c, code: "erp db" }).success, false);
  assert.equal(kit.ConnectionInputS.safeParse({ ...c, kind: "postgres" }).success, false);
  assert.equal(kit.ConnectionInputS.safeParse({ ...c, config: {} }).success, false);
});

test("owned() hides another tenant's records behind a 404", async () => {
  const profile = kit.emptyProfile();
  store.put("unit", { id: "u_a", tenantId: "ta", parentId: null, name: "A Inc.", code: "A", profile });
  store.put("unit", { id: "u_b", tenantId: "tb", parentId: null, name: "B Inc.", code: "B", profile });
  assert.equal(kit.owned("unit", "u_a", "ta").name, "A Inc.");
  assert.throws(() => kit.owned("unit", "u_b", "ta"), (r: Response) => r.status === 404);
  assert.throws(() => kit.owned("unit", "nope", "ta"), (r: Response) => r.status === 404);
});

test("unit tree lists depth first with level names, children and member counts", () => {
  const p = kit.emptyProfile();
  const units = [
    { id: "root", tenantId: "t", parentId: null, name: "Harbor Point Supply Co.", code: "HPS", profile: p },
    { id: "fin", tenantId: "t", parentId: "root", name: "Finance", code: "FIN", profile: p },
    { id: "ar", tenantId: "t", parentId: "fin", name: "AR East", code: "AR-E", profile: p },
    { id: "hr", tenantId: "t", parentId: "root", name: "Human Capital", code: "HR", profile: p },
  ];
  store.setMembership({ userId: "rina", unitId: "ar", role: "operator" });
  store.setMembership({ userId: "budi", unitId: "ar", role: "approver" });
  const tree = kit.unitTree(units, ["Company", "Division", "Team"]);
  assert.deepEqual(tree.map((u) => [u.id, u.depth, u.levelName]), [["root", 0, "Company"], ["fin", 1, "Division"], ["ar", 2, "Team"], ["hr", 1, "Division"]]);
  assert.deepEqual(tree[0].children, ["fin", "hr"]);
  assert.equal(tree.find((u) => u.id === "ar")?.members, 2);
});
