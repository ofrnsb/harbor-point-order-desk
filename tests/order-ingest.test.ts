import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshStore } from "./fixtures/tenant.ts";
import { fingerprint, isoDate, parseEml, parseJsonLine } from "../src/domain/orders/mail.ts";

const PACK = "data-pack/harbor-point";
const eml = (id: string) => fs.readFileSync(path.join(PACK, "emails", `${id}.eml`), "utf8");
const jsonLine = (id: string) => fs.readFileSync(path.join(PACK, "emails.jsonl"), "utf8").split("\n").find((l) => l.includes(`"${id}"`))!;

const NEW_EML = [
  "From: =?utf-8?Q?Jos=C3=A9_P=C3=A9rez?= <jose@newcafe.example>",
  "To: orders@harborpointsupply.example",
  "Subject: =?utf-8?B?T3JkZXIgZm9yIEZyaWRheQ==?=",
  "Date: Tue, 17 Nov 2026 09:15:00 -0500",
  "Message-ID: <new-1@newcafe.example>",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  'Content-Type: text/plain; charset="utf-8"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Please send 4 cases of HPS-1408 =E2=80=93 thanks!",
  "--b1",
  'Content-Type: application/pdf; name="po-77.pdf"',
  'Content-Disposition: attachment; filename="po-77.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--b1--",
  "",
].join("\r\n");

test("a data pack .eml reads into the same fields as its JSON line, with its Message-ID", () => {
  const r = parseEml(eml("E001"));
  assert.ok(r.ok);
  const j = parseJsonLine(jsonLine("E001"));
  assert.ok(j.ok);
  assert.equal(r.email.receivedAt, "2026-11-02T07:02:00-05:00");
  assert.equal(r.email.fromEmail, "maria@bluefinbistro.example");
  assert.equal(r.email.fromName, "Maria Lopez");
  assert.match(r.email.messageId ?? "", /@bluefinbistro\.example$/);
  assert.equal(fingerprint(r.email), fingerprint(j.email), "the same email from either source has one fingerprint");
});

test("a multipart email: encoded name and subject, quoted-printable text, attachments listed", () => {
  const r = parseEml(NEW_EML);
  assert.ok(r.ok);
  assert.equal(r.email.fromName, "José Pérez");
  assert.equal(r.email.subject, "Order for Friday");
  assert.equal(r.email.body, "Please send 4 cases of HPS-1408 – thanks!");
  assert.deepEqual(r.email.attachments, ["po-77.pdf"]);
  assert.equal(r.email.receivedAt, "2026-11-17T09:15:00-05:00");
});

test("emails without a sender or a date are refused with the reason", () => {
  assert.deepEqual(parseEml("To: a@b.example\nSubject: x\n\nhi"), { ok: false, reason: "no sender address" });
  assert.deepEqual(parseEml("From: a@b.example\nSubject: x\n\nhi"), { ok: false, reason: "no readable Date header" });
  assert.equal(parseJsonLine("{not json").ok, false);
  assert.equal(isoDate("17 Nov 2026 9:05 +0700"), "2026-11-17T09:05:00+07:00");
  assert.equal(isoDate("yesterday"), null);
});

let ingest: typeof import("../src/domain/orders/ingest.ts");
let desk: typeof import("../src/domain/orders/desk.ts");
let store: Awaited<ReturnType<typeof freshStore>>["store"];
const T = "harbor-point";
const by = { tenantId: T, userId: "u-sam", unitId: "order-desk", role: "operator", mayChangeErp: false };
const up = (name: string, text: string) => ({ name, data: Buffer.from(text), bytes: Buffer.byteLength(text) });

before(async () => {
  ({ store } = await freshStore());
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hp-ingest-")), "erp.sqlite");
  process.env.SIMPUL_ERP_DB = file;
  process.env.SIMPUL_TENANT = T;
  (await import("../src/platform/seed/erp.ts")).seedErp(file);
  const seed = await import("../src/platform/seed/tenant.ts");
  store.put("tenant", seed.TENANT);
  for (const u of seed.harborUnits()) store.put("unit", u);
  ingest = await import("../src/domain/orders/ingest.ts");
  desk = await import("../src/domain/orders/desk.ts");
  desk.ingestInbox(T);
});

test("an upload adds new emails with the next ids, recognises ones already in the inbox, and reports the unreadable", () => {
  const before = store.get("triage", "E001");
  const r = ingest.ingestUploads(by, [
    up("E001.eml", eml("E001")),
    up("pack.jsonl", `${jsonLine("E002")}\n\n{broken`),
    up("new.eml", NEW_EML),
    up("notes.txt", "hello"),
  ], true);
  assert.deepEqual(r.added.map((a) => a.id), ["E041"]);
  assert.deepEqual(r.duplicates, [{ source: "E001.eml", id: "E001" }, { source: "pack.jsonl:1", id: "E002" }]);
  assert.deepEqual(r.rejected.map((x) => x.source).sort(), ["notes.txt", "pack.jsonl:3"]);
  assert.equal(store.get("triage", "E041")?.state, "queued", "the new email waits for the agent");
  assert.equal(desk.queue(T).length, 41);
  assert.deepEqual(store.get("triage", "E001"), before, "nothing already in the inbox changes");
  assert.ok(store.auditAll(T).some((e) => e.kind === "ingest" && (e.detail.added as string[]).includes("E041")));
});

test("the same email uploaded twice, or twice in one upload, is added once", () => {
  const again = ingest.ingestUploads(by, [up("new.eml", NEW_EML)], true);
  assert.deepEqual(again.duplicates, [{ source: "new.eml", id: "E041" }]);
  const other = NEW_EML.replace("new-1@", "new-2@").replace("4 cases", "6 cases");
  const twice = ingest.ingestUploads(by, [up("a.eml", other), up("b.eml", other)], true);
  assert.deepEqual(twice.added.map((a) => a.id), ["E042"]);
  assert.deepEqual(twice.duplicates, [{ source: "b.eml", id: "E042" }]);
});

test("uploads over the limits are refused before reading", () => {
  assert.match(ingest.checkUploadSize([]) ?? "", /No files/);
  assert.match(ingest.checkUploadSize(Array.from({ length: 51 }, () => ({ size: 1 }))) ?? "", /More than 50 files/);
  assert.equal(ingest.checkUploadSize([{ size: 10 }]), null);
});

// ERP data: the same upload path, merged on keys, only for a company admin, previewed before it is written.
const admin = { ...by, userId: "u-morgan", unitId: "harbor-point", role: "approver", mayChangeErp: true };
const erpOf = async () => { const m = await import("../src/domain/orders/erp.ts"); return m.erpView(m.erpDb()); };

test("a CSV in the data pack's shape updates stock; on hand alone is enough, available follows", async () => {
  const erp = await erpOf();
  const before = erp.available("HPS-1408");
  const preview = ingest.ingestUploads(admin, [up("inventory.csv", "sku,on_hand\nHPS-1408,90\n")], false);
  assert.equal(preview.applied, false);
  assert.deepEqual(preview.tables.map((t) => [t.table, t.updated]), [["inventory", 1]]);
  assert.equal(erp.available("HPS-1408"), before, "a preview writes nothing");
  const done = ingest.ingestUploads(admin, [up("inventory.csv", "sku,on_hand\nHPS-1408,90\n")], true);
  assert.equal(done.applied, true);
  const audit = store.auditAll(T).filter((e) => e.kind === "ingest").pop();
  const change = (audit?.detail.tables as { changes: { key: string; before: Record<string, number>; after: Record<string, number> }[] }[])[0].changes[0];
  assert.equal(change.key, "HPS-1408");
  assert.deepEqual([change.before.on_hand, change.after.on_hand], [30, 90], "the audit log keeps what each row was and became");
  const allocated = 90 - erp.available("HPS-1408");
  assert.ok(allocated >= 0 && erp.available("HPS-1408") === 90 - allocated);
});

test("JSON with several tables adds a customer with a contact, and refuses a row that points nowhere", async () => {
  const data = { customers: [{ customer_id: "C900", name: "Harbor Cafe", payment_terms: "Net 30", credit_limit: "5000", open_balance: "0", status: "ACTIVE" }],
    customer_contacts: [{ email: "ana@harborcafe.example", customer_id: "C900", name: "Ana Ruiz", role: "Owner" }, { email: "x@nowhere.example", customer_id: "C999", name: "X", role: "Y" }] };
  const r = ingest.ingestUploads(admin, [up("new-customers.json", JSON.stringify(data))], true);
  const by = Object.fromEntries(r.tables.map((t) => [t.table, t]));
  assert.equal(by.customers.added, 1);
  assert.equal(by.customer_contacts.added, 1);
  assert.match(by.customer_contacts.rejected[0].reason, /does not have/);
  assert.equal((await erpOf()).contact("ana@harborcafe.example")?.customer_id, "C900");
});

test("a value that is not a number, and a new row missing a field, are refused row by row", () => {
  const r = ingest.ingestUploads(admin, [up("products.csv", "sku,name,category,sell_uom,pack,list_price,status\nHPS-9001,Test Tray,Takeout,CS,100,abc,ACTIVE\nHPS-9002,Test Lid,Takeout,CS,100,12.5,\n")], true);
  assert.deepEqual(r.tables[0].rejected.map((x) => x.row), [1, 2]);
  assert.match(r.tables[0].rejected[0].reason, /list_price/);
  assert.match(r.tables[0].rejected[1].reason, /status/);
});

test("a SQLite file with ERP tables is read like the pack", async () => {
  const Database = (await import("better-sqlite3")).default;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hp-up-")), "x.sqlite");
  const d = new Database(file);
  d.exec("CREATE TABLE incoming_supply (supplier_po TEXT, sku TEXT, qty TEXT, expected_date TEXT); INSERT INTO incoming_supply VALUES ('PO-9000', 'HPS-1001', '60', '2026-11-20');");
  d.close();
  const data = fs.readFileSync(file);
  const r = ingest.ingestUploads(admin, [{ name: "supply.sqlite", data, bytes: data.length }], true);
  assert.deepEqual(r.tables.map((t) => [t.table, t.added]), [["incoming_supply", 1]]);
  const notDb = ingest.ingestUploads(admin, [up("fake.sqlite", "hello")], false);
  assert.match(notDb.rejected[0].reason, /not a SQLite/);
});

test("only a company admin may change ERP records; anyone on the desk may add emails", () => {
  const r = ingest.ingestUploads(by, [up("customers.csv", "customer_id,name,payment_terms,credit_limit,open_balance,status\nC901,X,Net 30,1,0,ACTIVE\n")], true);
  assert.equal(r.tables.length, 0);
  assert.match(r.rejected[0].reason, /company admin/);
});

test("lifting a credit hold re-checks the emails waiting for review and sends them back to the Order Desk", () => {
  const filer = { tenantId: T, userId: "u-sam", unitId: "order-desk", chatId: "c" };
  const t = desk.fileTriage({ emailId: "E007", kind: "new_order", customerId: "C009", summary: "s", reasons: [], nextStep: "n", flags: [], related: [], reply: null, supersedes: null,
    proposals: [{ action: "create", customerId: "C009", shipToId: null, customerPo: null, requestedDate: null, lines: [{ sku: "HPS-1408", qty: 1, sourceText: "x", skuNamed: true }] }] }, filer);
  assert.equal(t.desk, "credit-control");
  const r = ingest.ingestUploads(admin, [up("customers.csv", "customer_id,status,open_balance\nC009,ACTIVE,0\n")], true);
  assert.ok(r.rechecked >= 1);
  assert.equal(store.get("triage", "E007")?.desk, "order-desk");
});
