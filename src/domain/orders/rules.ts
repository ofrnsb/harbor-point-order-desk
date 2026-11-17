// The data pack's business rules as checks: every draft, whoever wrote it, is priced and checked here before it is
// filed, again when a person edits it, and again at the moment it is written.
import { CHECKS, CUSTOMER_STATUS, ORDER_STATUS, PRODUCT_STATUS, TRIAGE, type CheckCode } from "../../config/orders.ts";
import { CHECK_TEXT as M, ORDER_STATUS_LABEL } from "../../copy/orders.ts";
import type { CustomerRow, ErpView, OrderLineRow, OrderRow } from "./erp.ts";
import type { Checked, DraftLine, Issue, PricedLine, Proposal } from "./types.ts";

export type CheckContext = {
  /** The day the email arrived: it decides which contract prices apply and whether a requested date has passed. */
  orderDate: string;
  fromEmail: string;
  /** Customer POs on drafts still waiting for review, with the email each came from. */
  pendingPos: { po: string; emailId: string }[];
  /** Value of this email's other orders for the same customer, checked before this one: credit counts them all. */
  alsoOrdered?: number;
};

const issue = (code: CheckCode, message: string, sku?: string): Issue => ({ code, severity: CHECKS[code], message, ...(sku ? { sku } : {}) });
const cents = (n: number) => Math.round(n * 100) / 100;
const EDITABLE: readonly string[] = [ORDER_STATUS.open, ORDER_STATUS.partial];

const blank = (issues: Issue[], customer?: CustomerRow): Checked =>
  ({ customerId: customer?.customer_id ?? null, customerName: customer?.name ?? null, shipTo: null, lines: [], total: 0, credit: null, issues });

function contactIssues(erp: ErpView, fromEmail: string, customer: CustomerRow): Issue[] {
  return erp.contact(fromEmail)?.customer_id === customer.customer_id ? [] : [issue("unknown_contact", M.unknownContact(fromEmail, customer.name))];
}

/** A line for a SKU the catalog does not have: kept in place, so every draft line has its priced line at the same index. */
const unknownLine = (line: DraftLine): PricedLine => ({ sku: line.sku, name: "", uom: "", qty: line.qty, unitPrice: 0, priceSource: "list", value: 0, available: 0, nextSupply: null });

function priceLine(erp: ErpView, customerId: string, line: DraftLine, date: string, issues: Issue[]): PricedLine {
  const product = erp.product(line.sku);
  if (!product) { issues.push(issue("unknown_sku", M.unknownSku(line.sku), line.sku)); return unknownLine(line); }
  if (product.status === PRODUCT_STATUS.discontinued) issues.push(issue("discontinued", M.discontinued(product.sku, product.name, product.replaced_by), product.sku));
  if (!Number.isInteger(line.qty) || line.qty <= 0) issues.push(issue("bad_quantity", M.badQuantity(product.sku, line.qty), product.sku));
  const contract = erp.contractPrice(customerId, product.sku, date);
  const unitPrice = contract ?? product.list_price;
  const priceSource = contract === undefined ? "list" : "contract";
  if (line.quotedPrice !== undefined && Math.abs(line.quotedPrice - unitPrice) > TRIAGE.priceTolerance) issues.push(issue("price_claim", M.priceClaim(product.sku, line.quotedPrice, unitPrice, priceSource), product.sku));
  return { sku: product.sku, name: product.name, uom: product.sell_uom, qty: line.qty, unitPrice, priceSource, value: cents(line.qty * unitPrice), available: erp.available(product.sku), nextSupply: erp.nextSupply(product.sku) };
}

/** Stock is checked per product across all lines, against what this draft would add. */
function stockIssues(erp: ErpView, lines: PricedLine[]): Issue[] {
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.sku, (wanted.get(l.sku) ?? 0) + l.qty - (l.previousQty ?? 0));
  return [...wanted].filter(([sku, qty]) => erp.product(sku) && qty > erp.available(sku))
    .map(([sku, qty]) => issue("short_stock", M.shortStock(sku, qty, erp.available(sku), erp.nextSupply(sku)), sku));
}

function creditOf(customer: CustomerRow, value: number, issues: Issue[], alsoOrdered = 0): Checked["credit"] {
  const after = cents(customer.open_balance + alsoOrdered + Math.max(value, 0));
  if (customer.status === CUSTOMER_STATUS.hold) issues.push(issue("credit_hold", M.creditHold(customer.name)));
  else if (value > 0 && after > customer.credit_limit) issues.push(issue("over_credit_limit", M.overCreditLimit(customer.open_balance + alsoOrdered, value, customer.credit_limit)));
  return { status: customer.status, limit: customer.credit_limit, openBalance: customer.open_balance, after };
}

function shipToOf(erp: ErpView, customer: CustomerRow, id: string | null, issues: Issue[]): Checked["shipTo"] {
  const all = erp.shipTos(customer.customer_id);
  const pick = id ? all.find((s) => s.ship_to_id === id) : all[0];
  if (id && !pick) issues.push(issue("unknown_ship_to", M.unknownShipTo(id, customer.name)));
  if (!id && pick && all.length > 1) issues.push(issue("ship_to_assumed", M.shipToAssumed(pick.name)));
  return pick ? { id: pick.ship_to_id, name: pick.name, address: pick.address } : null;
}

function poIssues(erp: ErpView, customerId: string, po: string | null, c: CheckContext): Issue[] {
  if (!po) return [];
  const existing = erp.orderWithPo(customerId, po)?.so_number ?? c.pendingPos.find((p) => p.po === po)?.emailId;
  return existing ? [issue("duplicate_po", M.duplicatePo(po, existing))] : [];
}

const total = (lines: PricedLine[]) => cents(lines.reduce((s, l) => s + l.value, 0));

function checkCreate(erp: ErpView, p: Extract<Proposal, { action: "create" }>, c: CheckContext): Checked {
  const customer = erp.customer(p.customerId);
  if (!customer) return blank([issue("unknown_customer", M.unknownCustomer(p.customerId))]);
  const issues = contactIssues(erp, c.fromEmail, customer);
  const shipTo = shipToOf(erp, customer, p.shipToId, issues);
  const lines = p.lines.map((l) => priceLine(erp, customer.customer_id, l, c.orderDate, issues));
  issues.push(...stockIssues(erp, lines), ...poIssues(erp, customer.customer_id, p.customerPo, c));
  if (p.requestedDate && p.requestedDate < c.orderDate) issues.push(issue("date_before_receipt", M.dateBeforeReceipt(p.requestedDate, c.orderDate)));
  const value = total(lines);
  return { customerId: customer.customer_id, customerName: customer.name, shipTo, lines, total: value, credit: creditOf(customer, value, issues, c.alsoOrdered), issues };
}

/** The order, its customer, and whether the sender may touch it; null when nothing further can be checked. */
function orderFor(erp: ErpView, so: string, c: CheckContext, issues: Issue[]): { order: OrderRow; customer: CustomerRow } | null {
  const order = erp.order(so);
  const customer = order && erp.customer(order.customer_id);
  if (!order || !customer) { issues.push(issue("unknown_order", M.unknownOrder(so))); return null; }
  const sender = erp.contact(c.fromEmail);
  if (sender && sender.customer_id !== customer.customer_id) issues.push(issue("other_customers_order", M.otherCustomersOrder(so, customer.name)));
  if (!sender) issues.push(issue("unknown_contact", M.unknownContact(c.fromEmail, customer.name)));
  if (!EDITABLE.includes(order.status)) issues.push(issue("not_editable", M.notEditable(so, ORDER_STATUS_LABEL[order.status] ?? order.status)));
  return { order, customer };
}

function changeLine(erp: ErpView, o: { order: OrderRow; lines: OrderLineRow[] }, line: DraftLine, issues: Issue[]): PricedLine {
  const existing = o.lines.find((l) => (line.lineNo !== undefined ? l.line_no === line.lineNo : l.sku === line.sku));
  if (!existing) {
    if (o.order.status === ORDER_STATUS.partial) issues.push(issue("not_editable", M.partialNoNewLines(o.order.so_number), line.sku));
    return priceLine(erp, o.order.customer_id, line, o.order.order_date, issues);
  }
  const product = erp.product(existing.sku);
  if (!Number.isInteger(line.qty) || line.qty < 0) issues.push(issue("bad_quantity", M.badQuantity(existing.sku, line.qty), existing.sku));
  if (line.qty < existing.qty_shipped) issues.push(issue("below_shipped", M.belowShipped(existing.sku, line.qty, existing.qty_shipped), existing.sku));
  return {
    sku: existing.sku, name: product?.name ?? existing.sku, uom: product?.sell_uom ?? "", qty: line.qty,
    unitPrice: existing.unit_price, priceSource: "order", value: cents((line.qty - existing.qty_ordered) * existing.unit_price),
    available: erp.available(existing.sku), nextSupply: erp.nextSupply(existing.sku),
    lineNo: existing.line_no, previousQty: existing.qty_ordered, shipped: existing.qty_shipped,
  };
}

function checkChange(erp: ErpView, p: Extract<Proposal, { action: "change" }>, c: CheckContext): Checked {
  const issues: Issue[] = [];
  const found = orderFor(erp, p.soNumber, c, issues);
  if (!found) return blank(issues);
  const o = { order: found.order, lines: erp.orderLines(p.soNumber) };
  const lines = p.lines.map((l) => changeLine(erp, o, l, issues));
  issues.push(...stockIssues(erp, lines));
  const value = total(lines);
  const shipTo = erp.shipTos(found.customer.customer_id).find((s) => s.ship_to_id === found.order.ship_to_id);
  return { customerId: found.customer.customer_id, customerName: found.customer.name, shipTo: shipTo ? { id: shipTo.ship_to_id, name: shipTo.name, address: shipTo.address } : null, lines, total: value, credit: creditOf(found.customer, value, issues, c.alsoOrdered), issues };
}

function checkCancel(erp: ErpView, p: Extract<Proposal, { action: "cancel" }>, c: CheckContext): Checked {
  const issues: Issue[] = [];
  const found = orderFor(erp, p.soNumber, c, issues);
  if (!found) return blank(issues);
  if (found.order.status === ORDER_STATUS.partial) issues.push(issue("not_editable", M.partialNoCancel(p.soNumber)));
  const lines = erp.orderLines(p.soNumber).map((l): PricedLine => ({
    sku: l.sku, name: erp.product(l.sku)?.name ?? l.sku, uom: erp.product(l.sku)?.sell_uom ?? "", qty: l.qty_shipped,
    unitPrice: l.unit_price, priceSource: "order", value: cents((l.qty_shipped - l.qty_ordered) * l.unit_price),
    available: erp.available(l.sku), nextSupply: null, lineNo: l.line_no, previousQty: l.qty_ordered, shipped: l.qty_shipped,
  }));
  return { ...blank(issues, found.customer), lines, total: total(lines) };
}

export function checkProposal(erp: ErpView, p: Proposal, c: CheckContext): Checked {
  if (p.action === "create") return checkCreate(erp, p, c);
  if (p.action === "change") return checkChange(erp, p, c);
  return checkCancel(erp, p, c);
}

/** Issues that stop a write. Credit ones too: the data pack says such an order is not released, by anyone; they also route to Credit Control. */
export const blocking = (c: Checked) => c.issues.filter((i) => i.severity !== "warn");
export const needsCredit = (c: Checked) => c.issues.some((i) => i.severity === "credit");
