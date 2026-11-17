import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshStore } from "./fixtures/tenant.ts";
import type { FileInput } from "../src/domain/orders/desk.ts";
import type { DraftLine, Proposal } from "../src/domain/orders/types.ts";

// The queue against a throwaway platform store and a fresh copy of the data pack ERP: no agent, only what it files.
let desk: typeof import("../src/domain/orders/desk.ts");
let erp: typeof import("../src/domain/orders/erp.ts");
let store: Awaited<ReturnType<typeof freshStore>>["store"];
const T = "harbor-point";
const by = { tenantId: T, userId: "u-sam", unitId: "order-desk", chatId: "chat-test" };

before(async () => {
  ({ store } = await freshStore());
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hp-desk-")), "erp.sqlite");
  process.env.SIMPUL_ERP_DB = file;
  process.env.SIMPUL_TENANT = T;
  (await import("../src/platform/seed/erp.ts")).seedErp(file);
  const seed = await import("../src/platform/seed/tenant.ts");
  store.put("tenant", seed.TENANT);
  for (const u of seed.harborUnits()) store.put("unit", u);
  for (const p of seed.PEOPLE) {
    store.put("user", { id: p.id, tenantId: T, email: p.email, name: p.name, title: p.title, attributes: {}, platformRoles: [], active: true });
    for (const [unitId, role] of p.units) store.setMembership({ userId: p.id, unitId, role });
  }
  desk = await import("../src/domain/orders/desk.ts");
  erp = await import("../src/domain/orders/erp.ts");
  desk.ingestInbox(T);
});

const line = (sku: string, qty: number, skuNamed = true): DraftLine => ({ sku, qty, sourceText: sku, skuNamed });
const order = (customerId: string, lines: DraftLine[], over: Partial<Extract<Proposal, { action: "create" }>> = {}): Proposal =>
  ({ action: "create", customerId, shipToId: null, customerPo: null, requestedDate: null, lines, ...over });
const filing = (emailId: string, over: Partial<FileInput> = {}): FileInput => ({
  emailId, kind: "new_order", customerId: null, summary: "s", reasons: [], nextStep: "n", flags: [], related: [], reply: null, proposals: [], supersedes: null, ...over,
});
const view = () => erp.erpView(erp.erpDb());

test("ingesting the inbox queues every email once", () => {
  assert.equal(desk.ingestInbox(T).length, 40);
  assert.equal(desk.ingestInbox(T).filter((t) => t.state === "queued").length, 40);
});

test("a clean order with every SKU named, from a known contact, within the limit, is released by the agent", () => {
  const before = view().available("HPS-1103");
  const t = desk.fileTriage(filing("E015", { proposals: [order("C020", [line("HPS-1103", 15), line("HPS-1104", 6), line("HPS-1305", 6)], { customerPo: "SSL-7781" })] }), by);
  assert.equal(t.state, "released", JSON.stringify(t.checked.map((c) => c.issues)));
  assert.equal(t.released?.soNumbers.length, 1);
  assert.equal(view().order(t.released!.soNumbers[0])?.customer_po, "SSL-7781");
  assert.equal(view().available("HPS-1103"), before - 15);
  assert.ok(store.auditAll(T).some((e) => e.kind === "release" && e.target === "E015"));
});

test("the same order matched from descriptions, or flagged, or over the limit, waits for a person", () => {
  const described = desk.fileTriage(filing("E038", { proposals: [order("C020", [line("HPS-1001", 6, false)])] }), by);
  assert.equal(described.state, "needs_review");
  const flagged = desk.fileTriage(filing("E039", { flags: ["needs_reply"], proposals: [order("C008", [line("HPS-1304", 4)])] }), by);
  assert.equal(flagged.state, "needs_review");
  const big = desk.fileTriage(filing("E003", { proposals: [order("C007", [line("HPS-1201", 70), line("HPS-1301", 6)], { shipToId: "S010" })] }), by);
  assert.ok(desk.totalOf(big.checked) > desk.deskLimit(), JSON.stringify(big.checked));
  assert.deepEqual(big.checked[0].issues, []);
  assert.equal(big.state, "needs_review");
});

test("an urgent clean order is still released; the urgent flag only orders the queue", () => {
  const t = desk.fileTriage(filing("E038", { flags: ["urgent"], proposals: [order("C020", [line("HPS-1101", 2)])] }), by);
  assert.equal(t.state, "released");
});

test("spam closes without review; a duplicate resend of a released PO too", () => {
  assert.equal(desk.fileTriage(filing("E029", { kind: "spam" }), by).state, "closed");
  assert.equal(desk.fileTriage(filing("E016", { kind: "duplicate", related: ["E015"] }), by).state, "closed");
});

test("the agent cannot close an email the server sees no reason to close", () => {
  assert.equal(desk.fileTriage(filing("E036", { kind: "duplicate" }), by).state, "needs_review", "a duplicate must name the earlier email");
  assert.equal(desk.fileTriage(filing("E036", { kind: "duplicate", related: ["E029"] }), by).state, "needs_review", "the earlier email must be from the same sender");
  assert.equal(desk.fileTriage(filing("E036", { kind: "spam" }), by).state, "needs_review", "a known customer contact is never spam");
});

test("a follow-up folds the earlier draft into its own", () => {
  desk.fileTriage(filing("E002", { flags: ["prompt_injection"], proposals: [order("C004", [line("HPS-1104", 3, false)])] }), by);
  const t = desk.fileTriage(filing("E026", { supersedes: "E002", proposals: [order("C004", [line("HPS-1104", 3, false), line("HPS-1001", 1, false)])] }), by);
  assert.equal(t.state, "needs_review");
  assert.deepEqual(t.related, ["E002"]);
  assert.deepEqual(t.flags, ["prompt_injection"], "the earlier email's warning carries over");
  assert.equal(store.get("triage", "E002")?.state, "merged");
  assert.throws(() => desk.fileTriage(filing("E030", { supersedes: "E001" }), by), /not an earlier email from this sender/);
  desk.fileTriage(filing("E009", { kind: "quote_request" }), by);
  assert.throws(() => desk.fileTriage(filing("E025", { supersedes: "E009", proposals: [order("C010", [line("HPS-1406", 6)])] }), by), /not an order/, "a quote is never folded into an order");
  desk.fileTriage(filing("E010", { proposals: [order("C011", [line("HPS-1408", 1, false)])] }), by);
  const loose = desk.fileTriage(filing("E035", { related: ["E010"] }), by);
  assert.deepEqual(desk.openEarlier(loose).map((x) => x.id), ["E010"], "a related but unmerged earlier draft is still open");
});

test("credit problems go to Credit Control: the specialist cannot decide, the controller can", () => {
  const t = desk.fileTriage(filing("E007", { proposals: [order("C009", [line("HPS-1408", 2)])] }), by);
  assert.equal(t.desk, "credit-control");
  assert.throws(() => desk.decide(T, "E007", "u-sam", { decision: "approve" }), /Credit Control/);
  assert.throws(() => desk.decide(T, "E007", "u-victor", { decision: "approve" }), /credit hold/, "not even Credit Control releases past a hold");
  desk.fileTriage(filing("E027", { proposals: [order("C014", [line("HPS-1408", 1)])] }), by);
  erp.erpDb().prepare("UPDATE customers SET status = 'ACTIVE', open_balance = 0 WHERE customer_id = 'C014'").run();
  assert.throws(() => desk.decide(T, "E027", "u-victor", { decision: "approve" }), /only the Order Desk can decide/);
  assert.equal(desk.decide(T, "E027", "u-sam", { decision: "approve" }).state, "approved", "once the hold is lifted in the ERP, the order is the Order Desk's again and approval passes");
  assert.equal(desk.decide(T, "E007", "u-victor", { decision: "reject", note: "Hold stays" }).state, "rejected");
});

test("a specialist approves within the limit, a lead above it; blocking issues stop everyone", () => {
  assert.throws(() => desk.decide(T, "E003", "u-sam", { decision: "approve" }), /Lead approves/);
  const done = desk.decide(T, "E003", "u-leah", { decision: "approve" });
  assert.equal(done.state, "approved");
  assert.equal(view().order(done.decision!.soNumbers[0])?.status, "OPEN");
  desk.fileTriage(filing("E019", { proposals: [order("C015", [line("HPS-1004", 4)])] }), by);
  assert.throws(() => desk.decide(T, "E019", "u-leah", { decision: "approve" }), /discontinued/);
  const swapped = desk.decide(T, "E019", "u-sam", { decision: "approve", proposals: [order("C015", [line("HPS-1001", 4)])] });
  assert.equal(swapped.decision?.edited, true);
  assert.ok(store.auditAll(T).some((e) => e.kind === "approve" && e.target === "E019" && e.detail.edited === true));
});

test("a new run picks up untriaged, failed and stale working emails, never decided ones", () => {
  const t = store.get("triage", "E040")!;
  store.put("triage", { ...t, state: "working" });
  const ids = desk.runnable(desk.queue(T)).map((x) => x.id);
  assert.ok(ids.includes("E040"), "an email left working by a dead run is picked up again");
  assert.ok(!ids.includes("E015") && !ids.includes("E029") && !ids.includes("E007"), "released, closed and decided emails are not");
  assert.deepEqual(desk.runnable(desk.queue(T), ["E040", "E015"]).map((x) => x.id), ["E040"]);
});

test("a decided email cannot be filed or decided again", () => {
  assert.throws(() => desk.fileTriage(filing("E003"), by), /already decided/);
  assert.throws(() => desk.decide(T, "E003", "u-leah", { decision: "reject" }), /nothing left to decide/);
});

test("the review queue puts urgent first, then the nearest delivery date, then credit cases, then arrival", async () => {
  const { byPriority } = await import("../src/domain/orders/priority.ts");
  const base = store.get("triage", "E001")!;
  const make = (id: string, receivedAt: string, over: Partial<typeof base> = {}) => ({ ...base, id, receivedAt, flags: [], proposals: [], desk: "order-desk" as const, ...over });
  const dated = (day: string) => [order("C001", [line("HPS-1408", 1)], { requestedDate: day })];
  const items = [
    make("plain-early", "2026-11-02T07:00:00-05:00"),
    make("credit", "2026-11-02T09:00:00-05:00", { desk: "credit-control" }),
    make("due-late", "2026-11-02T08:00:00-05:00", { proposals: dated("2026-11-09") }),
    make("due-soon", "2026-11-02T10:00:00-05:00", { proposals: dated("2026-11-04") }),
    make("urgent", "2026-11-02T11:00:00-05:00", { flags: ["urgent"] }),
  ];
  assert.deepEqual([...items].sort(byPriority).map((t) => t.id), ["urgent", "due-soon", "due-late", "credit", "plain-early"]);
});
