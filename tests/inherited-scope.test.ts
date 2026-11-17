// Row filters follow links: an East-only user sees only payments and lines of East invoices, in the same database (one SQL
// statement) and across systems (row-by-row check), and a total that cannot be limited that way is refused.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import path from "node:path";
import Database from "better-sqlite3";
import { freshStore } from "./fixtures/tenant.ts";

const { store, dir } = await freshStore();
const { storeCredentials } = await import("../src/platform/secrets.ts");
const { introspectConnection } = await import("../src/platform/catalog.ts");
const { resolveEffective } = await import("../src/platform/org.ts");
const { selectScoped } = await import("../src/platform/scoped-read.ts");
const { planAggregate, PolicyError } = await import("../src/platform/policy.ts");
const { connectorFor } = await import("../src/platform/connectors/index.ts");

const erp = path.join(dir, "erp.db"), fin = path.join(dir, "fin.db");
before(async () => {
  const a = new Database(erp);
  a.exec(`CREATE TABLE invoices (invoice_no TEXT PRIMARY KEY, region_code TEXT NOT NULL, total INTEGER NOT NULL);
    CREATE TABLE invoice_lines (line_id INTEGER PRIMARY KEY, invoice_no TEXT NOT NULL REFERENCES invoices(invoice_no), qty INTEGER NOT NULL);
    CREATE TABLE outlets (outlet_code TEXT PRIMARY KEY, region_code TEXT NOT NULL);
    CREATE TABLE credit_limits (outlet_code TEXT PRIMARY KEY, credit_limit INTEGER NOT NULL);
    INSERT INTO invoices VALUES ('INV/EAST/1','EAST',100), ('INV/WEST/1','WEST',200), ('INV/NORTH/1','NORTH',300);
    INSERT INTO invoice_lines VALUES (1,'INV/EAST/1',5), (2,'INV/WEST/1',7), (3,'INV/NORTH/1',9), (4,'INV/EAST/1',1);
    INSERT INTO outlets VALUES ('OUT-EAST-1','EAST'), ('OUT-WEST-1','WEST'), ('OUT-EAST-2','EAST');
    INSERT INTO credit_limits VALUES ('OUT-EAST-1',10), ('OUT-WEST-1',20);`);
  a.close();
  const b = new Database(fin);
  b.exec(`CREATE TABLE payments (payment_no TEXT PRIMARY KEY, invoice_no TEXT NOT NULL, amount INTEGER NOT NULL);
    INSERT INTO payments VALUES ('P1','INV/EAST/1',50), ('P2','INV/WEST/1',60), ('P3','INV/NORTH/1',70), ('P4','INV/EAST/1',40);`);
  b.close();
  const { put, setMembership } = store;
  const p = (x: Record<string, unknown> = {}) => ({ description: "", glossary: [], rules: [], grants: null, actions: null, models: null, clearance: null, budgetMonthly: null, approvalOver: null, attributes: {}, ...x });
  put("tenant", { id: "t1", name: "T", legalName: "T Inc.", industry: "x", timezone: "America/New_York", locale: "en-US", currency: "USD", levels: ["Company", "Team"], restrictedRouting: "mask", sensitivityDefaults: { public: "show", internal: "show", confidential: "mask", restricted: "hash" }, minGroupSize: 5 });
  for (const [id, file] of [["c-erp", erp], ["c-fin", fin]]) put("connection", { id, tenantId: "t1", code: id.slice(2).toUpperCase(), name: id, kind: "sqlite", config: { file }, readSecret: storeCredentials("t1", {}), writeSecret: null, status: "ok", statusNote: "", introspectedAt: null });
  await introspectConnection("c-erp"); await introspectConnection("c-fin");
  const region = [{ column: "region_code", op: "eq", value: "{user.region_code}" }];
  put("unit", { id: "root", tenantId: "t1", parentId: null, name: "T", code: "T", profile: p({ grants: [{ connectionId: "c-erp", objects: "*" }, { connectionId: "c-fin", objects: "*" }], clearance: "restricted" }) });
  put("unit", { id: "east", tenantId: "t1", parentId: "root", name: "East", code: "EAST", profile: p({ grants: [
    { connectionId: "c-erp", objects: [{ object: "invoices", rowFilters: region }, { object: "invoice_lines" }, { object: "outlets", rowFilters: region }, { object: "credit_limits" }] },
    { connectionId: "c-fin", objects: [{ object: "payments" }] }] }) });
  put("user", { id: "u1", tenantId: "t1", email: "u1@t.example", name: "u1", title: "u1", attributes: { region_code: "EAST" }, platformRoles: [], active: true });
  put("user", { id: "u0", tenantId: "t1", email: "u0@t.example", name: "u0", title: "u0", attributes: {}, platformRoles: [], active: true });
  setMembership({ userId: "u1", unitId: "east", role: "operator" });
  setMembership({ userId: "u0", unitId: "root", role: "operator" });
});

const obj = (c: string, o: string) => store.get("catalog", `${c}/${o}`)!;
const read = async (u: string, unit: string, c: string, o: string) => (await selectScoped(resolveEffective(u, unit), obj(c, o), { limit: 100 }, { external: false })).rows;

test("lines of invoices outside the scope are hidden in the same database", async () => {
  assert.deepEqual((await read("u1", "east", "c-erp", "invoice_lines")).map((r) => r.line_id).sort(), [1, 4]);
});

test("a peer keyed by the same id follows the filtered one", async () => {
  assert.deepEqual((await read("u1", "east", "c-erp", "credit_limits")).map((r) => r.outlet_code), ["OUT-EAST-1"]);
  assert.deepEqual((await read("u1", "east", "c-erp", "outlets")).map((r) => r.outlet_code).sort(), ["OUT-EAST-1", "OUT-EAST-2"], "a filtered object is not narrowed by its peers");
});

test("payments in another system are checked row by row, and their source total is not reported", async () => {
  const res = await selectScoped(resolveEffective("u1", "east"), obj("c-fin", "payments"), { limit: 100 }, { external: false });
  assert.deepEqual(res.rows.map((r) => r.payment_no).sort(), ["P1", "P4"]);
  assert.equal(res.total, null);
  const cols = await selectScoped(resolveEffective("u1", "east"), obj("c-fin", "payments"), { columns: ["amount"], limit: 100 }, { external: false });
  assert.deepEqual(cols.rows.map((r) => Object.keys(r)), [["amount"], ["amount"]], "the link column fetched for the check is dropped");
});

test("totals follow the parent in the same database and are refused across systems", async () => {
  const eff = resolveEffective("u1", "east");
  const plan = planAggregate(eff, obj("c-erp", "invoice_lines"), { metrics: [{ fn: "sum", column: "qty" }] }, { external: false });
  const rows = (await connectorFor(store.get("connection", "c-erp")!, "read").aggregate(plan.query)).rows;
  assert.equal(Number(rows[0].sum_qty), 6);
  assert.throws(() => planAggregate(eff, obj("c-fin", "payments"), { metrics: [{ fn: "sum", column: "amount" }] }, { external: false }), PolicyError);
});

test("a user without row filters sees everything", async () => {
  assert.equal((await read("u0", "root", "c-fin", "payments")).length, 4);
  assert.equal((await read("u0", "root", "c-erp", "invoice_lines")).length, 4);
});

test("a related total is joined in one query and respects the related object's scope", async () => {
  const eff = resolveEffective("u1", "east");
  const plan = planAggregate(eff, obj("c-erp", "invoices"), {
    metrics: [{ fn: "sum", column: "total", as: "billed" }, { fn: "sum", column: "open", as: "open" }],
    lookups: [{ as: "units", object: "invoice_lines", child_column: "invoice_no", fn: "sum", column: "qty" }],
    computed: [{ as: "open", left: "total", op: "-", right: "units" }],
  }, { external: false });
  const rows = (await connectorFor(store.get("connection", "c-erp")!, "read").aggregate(plan.query)).rows;
  assert.equal(Number(rows[0].billed), 100, "only the East invoice");
  assert.equal(Number(rows[0].open), 94, "100 minus its 6 units");
  const all = planAggregate(resolveEffective("u0", "root"), obj("c-erp", "invoices"), {
    metrics: [{ fn: "sum", column: "open", as: "open" }], group_by: undefined,
    lookups: [{ as: "units", object: "invoice_lines", child_column: "invoice_no", fn: "sum", column: "qty" }],
    computed: [{ as: "open", left: "total", op: "-", right: "units" }],
    filters: [{ column: "open", op: "gt", value: 195 }],
  } as never, { external: false });
  const r2 = (await connectorFor(store.get("connection", "c-erp")!, "read").aggregate(all.query)).rows;
  assert.equal(Number(r2[0].open), 291, "filters work on computed columns: only NORTH (300-9) is above 195, WEST (200-7) is not");
});

test("a related total from another system is refused, in any scope", async () => {
  const req = { metrics: [{ fn: "sum" as const, column: "open", as: "open" }],
    lookups: [{ as: "paid", system: "FIN", object: "payments", child_column: "invoice_no", fn: "sum" as const, column: "amount" }],
    computed: [{ as: "open", left: "total", op: "-" as const, right: "paid" }] };
  for (const [u, unit] of [["u0", "root"], ["u1", "east"]]) {
    assert.throws(() => planAggregate(resolveEffective(u, unit), obj("c-erp", "invoices"), req, { external: false }),
      (e: unknown) => e instanceof PolicyError && e.code === "bad_request" && /FIN/.test(e.message) && /ERP/.test(e.message), `${u} in ${unit}`);
  }
});
