import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedErp } from "../src/platform/seed/erp.ts";
import { applyProposal, erpDb, erpView } from "../src/domain/orders/erp.ts";
import { blocking, checkProposal, needsCredit, type CheckContext } from "../src/domain/orders/rules.ts";
import type { DraftLine, Proposal } from "../src/domain/orders/types.ts";

// Every test runs against a fresh copy of the real data pack ERP.
function freshErp() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hp-rules-")), "erp.sqlite");
  seedErp(file);
  const db = erpDb(file);
  return { db, erp: erpView(db) };
}

const ctx = (fromEmail: string, over: Partial<CheckContext> = {}): CheckContext => ({ orderDate: "2026-11-02", fromEmail, pendingPos: [], ...over });
const line = (sku: string, qty: number, over: Partial<DraftLine> = {}): DraftLine => ({ sku, qty, sourceText: `${sku} x ${qty}`, skuNamed: true, ...over });
const create = (customerId: string, lines: DraftLine[], over: Partial<Extract<Proposal, { action: "create" }>> = {}): Proposal =>
  ({ action: "create", customerId, shipToId: null, customerPo: null, requestedDate: null, lines, ...over });
const codes = (c: { issues: { code: string }[] }) => c.issues.map((i) => i.code).sort();

test("a clean order from a known contact prices every line and raises nothing", () => {
  const { erp } = freshErp();
  const c = checkProposal(erp, create("C001", [line("HPS-1408", 4), line("HPS-1402", 6), line("HPS-1502", 2)]), ctx("maria@bluefinbistro.example"));
  assert.deepEqual(codes(c), []);
  assert.equal(c.shipTo?.id, "S001");
  assert.equal(c.lines.length, 3);
  assert.equal(c.total, c.lines.reduce((s, l) => s + l.value, 0));
  assert.ok(c.credit && c.credit.after === c.credit.openBalance + c.total);
});

test("a contract price applies only inside its validity, and a quoted price that differs is raised", () => {
  const { erp } = freshErp();
  const inside = checkProposal(erp, create("C002", [line("HPS-1403", 4)]), ctx("x@greenleafcafes.example", { orderDate: "2026-06-01" }));
  assert.equal(inside.lines[0].unitPrice, 70);
  assert.equal(inside.lines[0].priceSource, "contract");
  const after = checkProposal(erp, create("C002", [line("HPS-1403", 4, { quotedPrice: 70 })]), ctx("x@greenleafcafes.example"));
  assert.equal(after.lines[0].unitPrice, 78);
  assert.equal(after.lines[0].priceSource, "list");
  assert.ok(codes(after).includes("price_claim"));
});

test("discontinued products, unknown SKUs and part-units block approval", () => {
  const { erp } = freshErp();
  const c = checkProposal(erp, create("C015", [line("HPS-1004", 4), line("HPS-9999", 1), line("HPS-1408", 2.5)]), ctx("office@northsidecc.example"));
  assert.deepEqual(blocking(c).map((i) => i.code).sort(), ["bad_quantity", "discontinued", "unknown_sku"]);
  assert.match(c.issues.find((i) => i.code === "discontinued")!.message, /HPS-1001/);
  assert.deepEqual(c.lines.map((l) => l.sku), ["HPS-1004", "HPS-9999", "HPS-1408"], "every draft line keeps its place");
  assert.equal(c.lines[1].value, 0);
});

test("credit hold and an order that would pass the credit limit both need Credit Control", () => {
  const { erp } = freshErp();
  const hold = checkProposal(erp, create("C009", [line("HPS-1408", 1)]), ctx("hello@coastalcatering.example"));
  assert.ok(codes(hold).includes("credit_hold"));
  assert.ok(needsCredit(hold));
  const over = checkProposal(erp, create("C006", [line("HPS-1408", 20)]), ctx("chef@oakandember.example"));
  assert.ok(codes(over).includes("over_credit_limit"), JSON.stringify(over.issues));
  assert.deepEqual(blocking(over).map((i) => i.code), ["over_credit_limit"], "a credit issue stops the write too");
});

test("an email's earlier orders for the same customer count against its credit", () => {
  const { erp } = freshErp();
  const alone = checkProposal(erp, create("C006", [line("HPS-1408", 5)]), ctx("chef@oakandember.example"));
  assert.equal(codes(alone).includes("over_credit_limit"), false, JSON.stringify(alone.issues));
  const after = checkProposal(erp, create("C006", [line("HPS-1408", 5)]), ctx("chef@oakandember.example", { alsoOrdered: alone.total }));
  assert.ok(codes(after).includes("over_credit_limit"));
  assert.equal(after.credit?.after, 7600 + 2 * alone.total);
});

test("short stock, an unknown sender, a passed date and a PO already on an order are warnings", () => {
  const { erp } = freshErp();
  const c = checkProposal(erp, create("C020", [line("HPS-1301", 30)], { customerPo: "SSL-7752", requestedDate: "2026-10-30" }), ctx("someone@else.example"));
  assert.deepEqual(codes(c), ["date_before_receipt", "duplicate_po", "short_stock", "unknown_contact"]);
  assert.ok(c.issues.every((i) => i.severity === "warn"));
  const pending = checkProposal(erp, create("C020", [line("HPS-1408", 1)], { customerPo: "SSL-7781" }), ctx("purchasing@seasideseniorliving.example", { pendingPos: [{ po: "SSL-7781", emailId: "E015" }] }));
  assert.match(pending.issues.find((i) => i.code === "duplicate_po")!.message, /E015/);
});

test("a customer with several delivery addresses gets the default only with a warning", () => {
  const { erp } = freshErp();
  const c = checkProposal(erp, create("C003", [line("HPS-1408", 1)]), ctx("procurement@harborviewhotel.example"));
  assert.equal(c.shipTo?.id, "S003");
  assert.ok(codes(c).includes("ship_to_assumed"));
  const named = checkProposal(erp, create("C003", [line("HPS-1408", 1)], { shipToId: "S004" }), ctx("procurement@harborviewhotel.example"));
  assert.equal(named.shipTo?.id, "S004");
  const wrong = checkProposal(erp, create("C003", [line("HPS-1408", 1)], { shipToId: "S001" }), ctx("procurement@harborviewhotel.example"));
  assert.ok(codes(wrong).includes("unknown_ship_to"));
});

test("changing an open order prices the difference at the order's own price", () => {
  const { erp } = freshErp();
  const c = checkProposal(erp, { action: "change", soNumber: "SO-24051", lines: [line("HPS-1103", 25)] }, ctx("procurement@harborviewhotel.example"));
  assert.deepEqual(codes(c), []);
  assert.equal(c.lines[0].lineNo, 1);
  assert.equal(c.lines[0].previousQty, 20);
  assert.equal(c.total, 5 * 66);
});

test("a partly shipped order changes only unshipped quantities; a shipped one not at all", () => {
  const { erp } = freshErp();
  const partial = checkProposal(erp, { action: "change", soNumber: "SO-24052", lines: [line("HPS-1305", 5), line("HPS-1408", 1)] }, ctx("ops@metrofitness.example"));
  assert.deepEqual(blocking(partial).map((i) => i.code).sort(), ["below_shipped", "not_editable"]);
  const shipped = checkProposal(erp, { action: "change", soNumber: "SO-24056", lines: [line("HPS-1408", 1)] }, ctx("events@bayfrontvenue.example"));
  assert.ok(codes(shipped).includes("not_editable"));
});

test("another customer's order is refused, an unknown order too", () => {
  const { erp } = freshErp();
  const other = checkProposal(erp, { action: "cancel", soNumber: "SO-24051", reason: "x" }, ctx("maria@bluefinbistro.example"));
  assert.ok(codes(other).includes("other_customers_order"));
  const none = checkProposal(erp, { action: "cancel", soNumber: "SO-99999", reason: "x" }, ctx("maria@bluefinbistro.example"));
  assert.deepEqual(codes(none), ["unknown_order"]);
});

test("applying a new order writes header and lines and allocates stock", () => {
  const { db, erp } = freshErp();
  const p = create("C001", [line("HPS-1408", 4)]);
  const before = erp.available("HPS-1408");
  const c = checkProposal(erp, p, ctx("maria@bluefinbistro.example"));
  const r = applyProposal(db, p, c, { orderDate: "2026-11-02" });
  assert.equal(r.soNumber, "SO-24059");
  assert.equal(erp.order("SO-24059")?.status, "OPEN");
  assert.equal(erp.orderLines("SO-24059")[0].unit_price, c.lines[0].unitPrice);
  assert.equal(erp.available("HPS-1408"), before - 4);
});

test("a change moves allocation by the difference, a cancellation releases what was unshipped", () => {
  const { db, erp } = freshErp();
  const before = erp.available("HPS-1103");
  const ch: Proposal = { action: "change", soNumber: "SO-24051", lines: [line("HPS-1103", 25)] };
  applyProposal(db, ch, checkProposal(erp, ch, ctx("procurement@harborviewhotel.example")), { orderDate: "2026-11-02" });
  assert.equal(erp.orderLines("SO-24051")[0].qty_ordered, 25);
  assert.equal(erp.available("HPS-1103"), before - 5);
  const cancel: Proposal = { action: "cancel", soNumber: "SO-24055", reason: "Budget frozen" };
  const c = checkProposal(erp, cancel, ctx("facilities@summitoffice.example"));
  assert.deepEqual(codes(c), []);
  applyProposal(db, cancel, c, { orderDate: "2026-11-02" });
  assert.equal(erp.order("SO-24055")?.status, "CANCELLED");
  assert.equal(erp.available("HPS-1103"), before - 5 + 10);
});
