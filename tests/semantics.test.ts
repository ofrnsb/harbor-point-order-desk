// A small legacy bank estate: cryptic names, a shared code table, Julian dates, monthly transaction tables, rating
// history, and a loan system that points at core banking's CIF under another name. Nothing is configured: the engine
// has to learn all of it from the data.
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
const { detectEncoding, encodingHint, periodFamilies } = await import("../src/platform/semantics.ts");

const core = path.join(dir, "core.db"), los = path.join(dir, "los.db");
before(async () => {
  const a = new Database(core);
  a.exec(`CREATE TABLE CODEMST (CD_TYP TEXT NOT NULL, CD_VAL TEXT NOT NULL, CD_DESC TEXT NOT NULL, PRIMARY KEY (CD_TYP, CD_VAL));
    INSERT INTO CODEMST VALUES ('SEG','01','Mass'),('SEG','02','Emerging affluent'),('SEG','03','Priority'),('STS','A','Active'),('STS','C','Closed'),('STS','D','Dormant'),('TXN','101','Cash deposit'),('TXN','102','Cash withdrawal'),('TXN','201','Incoming transfer');
    CREATE TABLE CIFMAST (CIF_NO TEXT PRIMARY KEY, CUST_NM TEXT, SEG_CD TEXT, STS TEXT, DOB_JUL INTEGER);
    CREATE TABLE TXN_202609 (TXN_ID INTEGER PRIMARY KEY, CIF_NO TEXT, TXN_CD TEXT, AMT INTEGER, TXN_TM TEXT);
    CREATE TABLE TXN_202610 (TXN_ID INTEGER PRIMARY KEY, CIF_NO TEXT, TXN_CD TEXT, AMT INTEGER, TXN_TM TEXT);
    CREATE TABLE RATING_HIST (RATING_ID INTEGER PRIMARY KEY, CIF_NO TEXT, RATING TEXT, VALID_FROM TEXT, VALID_TO TEXT);`);
  const ins = a.prepare("INSERT INTO CIFMAST VALUES (?,?,?,?,?)");
  for (let i = 1; i <= 40; i++) ins.run(`C${String(i).padStart(7, "0")}`, `Customer ${i}`, ["01", "02", "03"][i % 3], ["A", "A", "D", "C"][i % 4], 1 * 100000 + (60 + (i % 40)) * 1000 + ((i * 7) % 365) + 1);
  for (const [t, base] of [["TXN_202609", 0], ["TXN_202610", 1000]] as const) {
    const s = a.prepare(`INSERT INTO ${t} VALUES (?,?,?,?,?)`);
    for (let i = 1; i <= 30; i++) s.run(base + i, `C${String((i % 40) + 1).padStart(7, "0")}`, ["101", "102", "201"][i % 3], 1000 * i, `${String(8 + (i % 10)).padStart(2, "0")}${String(i % 60).padStart(2, "0")}05`);
  }
  a.prepare("INSERT INTO RATING_HIST VALUES (1,'C0000001','B','2020-01-01','2024-06-30'),(2,'C0000001','A','2024-07-01',NULL)").run();
  a.close();
  const b = new Database(los);
  b.exec("CREATE TABLE tblLoanApp (AppID INTEGER PRIMARY KEY, CIFNo TEXT NOT NULL, ReqAmt INTEGER NOT NULL, StatusCd TEXT)");
  const l = b.prepare("INSERT INTO tblLoanApp VALUES (?,?,?,?)");
  for (let i = 1; i <= 25; i++) l.run(i, `C${String(i).padStart(7, "0")}`, 5_000_000 * i, "A");
  b.close();
  const p = (x: Record<string, unknown> = {}) => ({ description: "", glossary: [], rules: [], grants: null, actions: null, models: null, clearance: null, budgetMonthly: null, approvalOver: null, attributes: {}, ...x });
  store.put("tenant", { id: "t1", name: "T", legalName: "T Inc.", industry: "Bank", timezone: "America/New_York", locale: "en-US", currency: "USD", levels: ["Company"], restrictedRouting: "mask", sensitivityDefaults: { public: "show", internal: "show", confidential: "mask", restricted: "hash" }, minGroupSize: 5 });
  for (const [id, file] of [["c-core", core], ["c-los", los]]) store.put("connection", { id, tenantId: "t1", code: id.slice(2).toUpperCase(), name: id, kind: "sqlite", config: { file }, readSecret: storeCredentials("t1", {}), writeSecret: null, status: "ok", statusNote: "", introspectedAt: null });
  await introspectConnection("c-core");
  await introspectConnection("c-los");
  store.put("unit", { id: "root", tenantId: "t1", parentId: null, name: "T", code: "T", profile: p({ grants: [{ connectionId: "c-core", objects: "*" }, { connectionId: "c-los", objects: "*" }], clearance: "restricted" }) });
  store.put("user", { id: "u", tenantId: "t1", email: "u@t.example", name: "u", title: "u", attributes: {}, platformRoles: [], active: true });
  store.setMembership({ userId: "u", unitId: "root", role: "operator" });
});

const obj = (c: string, o: string) => store.get("catalog", `${c}/${o}`)!;
const col = (c: string, o: string, n: string) => obj(c, o).columns.find((x) => x.name === n)!;

test("legacy date and time encodings are recognised from the values", () => {
  assert.equal(col("c-core", "CIFMAST", "DOB_JUL").encoding, "julian_cyyddd");
  assert.equal(col("c-core", "TXN_202609", "TXN_TM").encoding, "hhmmss");
  assert.equal(detectEncoding("POST_DT", "integer", ["20261013", "20261101", "20260930", "20260102", "20251231"]), "yyyymmdd");
  assert.equal(detectEncoding("AMT", "integer", ["20261013", "1000", "250000", "3", "77"]), undefined, "amounts are not dates");
  assert.match(encodingHint("julian_cyyddd", new Date("2026-11-13T00:00:00Z")), /126317/);
  assert.equal(detectEncoding("DOB_JUL", "number", ["61234", "75012", "88365", "99001", "105200", "52101", "70301", "64111", "81222", "93055"]), "julian_cyyddd", "19xx births have 5 digits, 20xx births 6");
  assert.equal(detectEncoding("DOB_JUL", "number", ["61234", "75012", "88365", "99001", "52101", "70301"]), "julian_yyddd");
});

test("a shared code table is found and each coded column gets its own list", () => {
  assert.deepEqual(obj("c-core", "CODEMST").codeTable, { value: "CD_VAL", desc: "CD_DESC", type: "CD_TYP" });
  assert.deepEqual(new Map(col("c-core", "CIFMAST", "SEG_CD").decode!.meanings).get("03"), "Priority");
  assert.equal(new Map(col("c-core", "CIFMAST", "STS").decode!.meanings).get("D"), "Dormant");
  assert.equal(new Map(col("c-core", "TXN_202609", "TXN_CD").decode!.meanings).get("101"), "Cash deposit");
});

test("an id under another name in another system is linked after checking the data", () => {
  assert.deepEqual(col("c-los", "tblLoanApp", "CIFNo").link, { connectionId: "c-core", object: "CIFMAST", column: "CIF_NO", overlap: 1 });
});

test("history and period tables are recognised, and the period family reads as one table", async () => {
  assert.deepEqual(obj("c-core", "RATING_HIST").history, { from: "VALID_FROM", to: "VALID_TO" });
  const fam = obj("c-core", "TXN");
  assert.deepEqual(fam.unionOf, ["TXN_202609", "TXN_202610"]);
  const rows = (await selectScoped(resolveEffective("u", "root"), fam, { columns: ["TXN_ID", "SOURCE_TABLE"], filters: [{ column: "SOURCE_TABLE", op: "eq", value: "TXN_202610" }], limit: 100 }, { external: false })).rows;
  assert.equal(rows.length, 30);
  assert.ok(rows.every((r) => Number(r.TXN_ID) > 1000));
  assert.equal(periodFamilies([obj("c-core", "CIFMAST")]).length, 0);
});

test("a column renamed in the source is reported as a likely rename and audited", async () => {
  const db = new Database(los);
  db.exec("ALTER TABLE tblLoanApp RENAME COLUMN ReqAmt TO RequestedAmt; ALTER TABLE tblLoanApp ADD COLUMN Branch TEXT");
  db.close();
  await introspectConnection("c-los");
  const changed = obj("c-los", "tblLoanApp").changed!;
  assert.deepEqual(changed.renamed, [["ReqAmt", "RequestedAmt"]]);
  assert.deepEqual(changed.added, ["Branch"]);
  const ev = store.auditAll("t1").filter((e) => e.kind === "schema_change").at(-1)!;
  assert.equal(ev.target, "LOS");
  assert.equal(col("c-los", "tblLoanApp", "CIFNo").link?.object, "CIFMAST", "learned links survive a re-read");
});

test("an admin's correction of what was learned survives the next introspection", async () => {
  const o = obj("c-core", "CIFMAST");
  store.put("catalog", { ...o, columns: o.columns.map((c) => (c.name === "STS" ? { ...c, decode: undefined, semanticsSource: "admin" as const } : c)) });
  await introspectConnection("c-core");
  assert.equal(col("c-core", "CIFMAST", "STS").decode, undefined, "the removed code list does not come back");
  assert.equal(col("c-core", "CIFMAST", "STS").semanticsSource, "admin");
  assert.ok(col("c-core", "CIFMAST", "SEG_CD").decode, "other columns are still learned");
});

test("period tables never filter each other, while a filter on the customer still follows into them", async () => {
  const p = (x: Record<string, unknown> = {}) => ({ description: "", glossary: [], rules: [], grants: null, actions: null, models: null, clearance: null, budgetMonthly: null, approvalOver: null, attributes: {}, ...x });
  store.put("unit", { id: "prio", tenantId: "t1", parentId: "root", name: "Priority", code: "PRIO", profile: p({ grants: [{ connectionId: "c-core", objects: [{ object: "CIFMAST", rowFilters: [{ column: "SEG_CD", op: "eq", value: "03" }] }, { object: "TXN_202609" }, { object: "TXN_202610" }, { object: "TXN" }] }] }) });
  store.put("user", { id: "u-prio", tenantId: "t1", email: "p@t.example", name: "p", title: "p", attributes: {}, platformRoles: [], active: true });
  store.setMembership({ userId: "u-prio", unitId: "prio", role: "operator" });
  const eff = resolveEffective("u-prio", "prio");
  const prio = new Set((await selectScoped(eff, obj("c-core", "CIFMAST"), { columns: ["CIF_NO"], limit: 100 }, { external: false })).rows.map((r) => r.CIF_NO));
  for (const t of ["TXN_202610", "TXN"]) {
    const rows = (await selectScoped(eff, obj("c-core", t), { columns: ["TXN_ID", "CIF_NO"], limit: 200 }, { external: false })).rows;
    assert.ok(rows.length > 0, `${t} is not emptied by another month's keys`);
    assert.ok(rows.every((r) => prio.has(r.CIF_NO)), `${t} shows only Priority customers' transactions`);
  }
});

test("money in cents is suggested from the data, and once an admin confirms it every read, filter and total is in dollars", async () => {
  const { detectMinorUnits } = await import("../src/platform/semantics.ts");
  assert.equal(detectMinorUnits("BAL_AMT", "number", [125000000, 98000000, 4500000000, 1200000, 77700000, 300000000]), 100);
  assert.equal(detectMinorUnits("BAL_AMT", "number", [125000050, 98000013, 4500000000, 1200000, 77700001]), undefined, "real cents are not all hundreds");
  assert.equal(detectMinorUnits("TXN_ID", "number", [1000000, 2000000, 3000000, 4000000, 5000000]), undefined, "only money columns");
  const o = obj("c-core", "TXN_202609");
  store.put("catalog", { ...o, columns: o.columns.map((c) => (c.name === "AMT" ? { ...c, minorUnits: 100, semanticsSource: "admin" as const } : c)) });
  const eff = resolveEffective("u", "root");
  const { planAggregate } = await import("../src/platform/policy.ts");
  const { connectorFor } = await import("../src/platform/connectors/index.ts");
  const raw = new Database(core, { readonly: true }).prepare("SELECT SUM(AMT) s, COUNT(*) n FROM TXN_202609 WHERE AMT > 10000").get() as { s: number; n: number };
  const plan = planAggregate(eff, obj("c-core", "TXN_202609"), { metrics: [{ fn: "sum", column: "AMT", as: "usd" }, { fn: "count", as: "n" }], filters: [{ column: "AMT", op: "gt", value: 100 }] }, { external: false });
  const got = (await connectorFor(store.get("connection", "c-core")!, "read").aggregate(plan.query)).rows[0];
  assert.equal(Number(got.usd), raw.s / 100, "the total is in dollars");
  assert.equal(Number(got.n), raw.n, "the filter value was read in dollars too ($100 = 10000 cents)");
  const rows = (await selectScoped(eff, obj("c-core", "TXN_202609"), { columns: ["TXN_ID", "AMT"], filters: [{ column: "TXN_ID", op: "eq", value: 5 }], limit: 1 }, { external: false })).rows;
  assert.equal(rows[0].AMT, 50, "5000 cents reads as $50");
});

test("a cents suggestion an admin rejected does not come back on the next introspection", async () => {
  assert.equal(col("c-los", "tblLoanApp", "RequestedAmt").unitHint, 100, "suggested from the data");
  const o = obj("c-los", "tblLoanApp");
  store.put("catalog", { ...o, columns: o.columns.map((c) => (c.name === "RequestedAmt" ? { ...c, unitHint: undefined, semanticsSource: "admin" as const } : c)) });
  await introspectConnection("c-los");
  assert.equal(col("c-los", "tblLoanApp", "RequestedAmt").unitHint, undefined);
  assert.equal(col("c-los", "tblLoanApp", "RequestedAmt").minorUnits, undefined, "and nothing is scaled");
});
