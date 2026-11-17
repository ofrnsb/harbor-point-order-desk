// The Order Desk's typed access to the working ERP: the reads every check needs, and the three writes an approved
// proposal makes (create, change, cancel), each in one transaction with stock allocation kept in step.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ERP_DB, ERP_TABLES as T } from "../../config/erp.ts";
import { env } from "../../config/env.ts";
import { ORDER_STATUS, SO_PREFIX } from "../../config/orders.ts";
import type { Checked, Proposal } from "./types.ts";

export type CustomerRow = { customer_id: string; name: string; credit_limit: number; open_balance: number; status: string };
export type ContactRow = { email: string; customer_id: string; name: string; role: string };
export type ShipToRow = { ship_to_id: string; customer_id: string; name: string; address: string; is_default: number };
export type ProductRow = { sku: string; name: string; sell_uom: string; pack: string; list_price: number; status: string; replaced_by: string | null };
export type OrderRow = { so_number: string; customer_id: string; ship_to_id: string; customer_po: string | null; order_date: string; requested_date: string | null; status: string };
export type OrderLineRow = { so_number: string; line_no: number; sku: string; qty_ordered: number; qty_shipped: number; unit_price: number };
export type EmailRow = { email_id: string; received_at: string; from_name: string; from_email: string; to_address: string; subject: string; body: string; attachments: string; message_id: string | null; fingerprint: string };

/** What the checks read. A plain interface so the rules run against any copy of the ERP, including a test's. */
export type ErpView = {
  customer: (id: string) => CustomerRow | undefined;
  contact: (email: string) => ContactRow | undefined;
  shipTos: (customerId: string) => ShipToRow[];
  product: (sku: string) => ProductRow | undefined;
  contractPrice: (customerId: string, sku: string, date: string) => number | undefined;
  available: (sku: string) => number;
  nextSupply: (sku: string) => { qty: number; date: string } | null;
  order: (so: string) => OrderRow | undefined;
  orderLines: (so: string) => OrderLineRow[];
  orderWithPo: (customerId: string, po: string) => OrderRow | undefined;
};

const g = globalThis as unknown as { orderDeskErp?: { db: Database.Database; ino: number; path: string } };

const open = (full: string) => { const d = new Database(full); d.pragma("foreign_keys = ON"); return d; };

/** The working ERP. `npm run reset` replaces the file, so a handle on the old file is dropped and the new one opened. */
export function erpDb(file?: string): Database.Database {
  if (file) return open(path.resolve(file));
  const full = path.resolve(env.erpDb ?? ERP_DB);
  const ino = fs.statSync(full).ino;
  const cached = g.orderDeskErp;
  if (cached?.db.open && cached.ino === ino && cached.path === full) return cached.db;
  cached?.db.close();
  const d = open(full);
  g.orderDeskErp = { db: d, ino, path: full };
  return d;
}

export function erpView(d: Database.Database): ErpView {
  const one = <R>(sql: string) => { const s = d.prepare(sql); return (...a: unknown[]) => s.get(...a) as R | undefined; };
  const all = <R>(sql: string) => { const s = d.prepare(sql); return (...a: unknown[]) => s.all(...a) as R[]; };
  const price = one<{ unit_price: number }>(`SELECT unit_price FROM ${T.prices} WHERE customer_id = ? AND sku = ? AND valid_from <= ? AND valid_to >= ? ORDER BY valid_from DESC LIMIT 1`);
  const stock = one<{ available: number }>(`SELECT available FROM ${T.inventory} WHERE sku = ?`);
  return {
    customer: one<CustomerRow>(`SELECT * FROM ${T.customers} WHERE customer_id = ?`),
    contact: one<ContactRow>(`SELECT * FROM ${T.contacts} WHERE lower(email) = lower(?)`),
    shipTos: all<ShipToRow>(`SELECT * FROM ${T.shipTos} WHERE customer_id = ? ORDER BY is_default DESC, ship_to_id`),
    product: one<ProductRow>(`SELECT * FROM ${T.products} WHERE sku = ?`),
    contractPrice: (c, sku, date) => price(c, sku, date, date)?.unit_price,
    available: (sku) => stock(sku)?.available ?? 0,
    nextSupply: one<{ qty: number; date: string }>(`SELECT qty, expected_date AS date FROM ${T.incoming} WHERE sku = ? ORDER BY expected_date LIMIT 1`) as ErpView["nextSupply"],
    order: one<OrderRow>(`SELECT * FROM ${T.orders} WHERE so_number = ?`),
    orderLines: all<OrderLineRow>(`SELECT * FROM ${T.orderLines} WHERE so_number = ? ORDER BY line_no`),
    orderWithPo: one<OrderRow>(`SELECT * FROM ${T.orders} WHERE customer_id = ? AND customer_po = ?`),
  };
}

export const inboxEmails = (d: Database.Database): EmailRow[] => d.prepare(`SELECT * FROM ${T.inbox} ORDER BY received_at, email_id`).all() as EmailRow[];

/** Moves stock between available and allocated: positive allocates (never more than is available), negative releases. */
function allocate(d: Database.Database, sku: string, qty: number): number {
  const row = d.prepare(`SELECT available, allocated FROM ${T.inventory} WHERE sku = ?`).get(sku) as { available: number; allocated: number } | undefined;
  if (!row || qty === 0) return 0;
  const moved = qty > 0 ? Math.min(qty, row.available) : -Math.min(-qty, row.allocated);
  d.prepare(`UPDATE ${T.inventory} SET allocated = allocated + ?, available = available - ? WHERE sku = ?`).run(moved, moved, sku);
  return moved;
}

function nextSoNumber(d: Database.Database): string {
  const row = d.prepare(`SELECT max(CAST(substr(so_number, ${SO_PREFIX.length + 1}) AS INTEGER)) AS n FROM ${T.orders}`).get() as { n: number | null };
  return `${SO_PREFIX}${(row.n ?? 0) + 1}`;
}

export type Applied = { soNumber: string; allocated: Record<string, number> };
type Meta = { orderDate: string };

function create(d: Database.Database, p: Extract<Proposal, { action: "create" }>, c: Checked, m: Meta): Applied {
  const so = nextSoNumber(d);
  d.prepare(`INSERT INTO ${T.orders} (so_number, customer_id, ship_to_id, customer_po, order_date, requested_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(so, p.customerId, c.shipTo?.id, p.customerPo, m.orderDate, p.requestedDate, ORDER_STATUS.open);
  const insert = d.prepare(`INSERT INTO ${T.orderLines} (so_number, line_no, sku, qty_ordered, qty_shipped, unit_price) VALUES (?, ?, ?, ?, 0, ?)`);
  const allocated: Record<string, number> = {};
  c.lines.forEach((l, i) => { insert.run(so, i + 1, l.sku, l.qty, l.unitPrice); allocated[l.sku] = (allocated[l.sku] ?? 0) + allocate(d, l.sku, l.qty); });
  return { soNumber: so, allocated };
}

function change(d: Database.Database, p: Extract<Proposal, { action: "change" }>, c: Checked): Applied {
  const setQty = d.prepare(`UPDATE ${T.orderLines} SET qty_ordered = ? WHERE so_number = ? AND line_no = ?`);
  const insert = d.prepare(`INSERT INTO ${T.orderLines} (so_number, line_no, sku, qty_ordered, qty_shipped, unit_price) VALUES (?, ?, ?, ?, 0, ?)`);
  let next = (d.prepare(`SELECT max(line_no) AS n FROM ${T.orderLines} WHERE so_number = ?`).get(p.soNumber) as { n: number | null }).n ?? 0;
  const allocated: Record<string, number> = {};
  for (const l of c.lines) {
    if (l.lineNo !== undefined) setQty.run(l.qty, p.soNumber, l.lineNo);
    else insert.run(p.soNumber, ++next, l.sku, l.qty, l.unitPrice);
    allocated[l.sku] = (allocated[l.sku] ?? 0) + allocate(d, l.sku, l.qty - (l.previousQty ?? 0));
  }
  return { soNumber: p.soNumber, allocated };
}

function cancel(d: Database.Database, p: Extract<Proposal, { action: "cancel" }>): Applied {
  d.prepare(`UPDATE ${T.orders} SET status = ? WHERE so_number = ?`).run(ORDER_STATUS.cancelled, p.soNumber);
  const allocated: Record<string, number> = {};
  for (const l of erpView(d).orderLines(p.soNumber)) allocated[l.sku] = (allocated[l.sku] ?? 0) + allocate(d, l.sku, -(l.qty_ordered - l.qty_shipped));
  return { soNumber: p.soNumber, allocated };
}

/** Writes an approved proposal. The caller re-checks it against the ERP first; this only applies it. */
export function applyProposal(d: Database.Database, p: Proposal, c: Checked, m: Meta): Applied {
  return d.transaction(() => {
    if (p.action === "create") return create(d, p, c, m);
    if (p.action === "change") return change(d, p, c);
    return cancel(d, p);
  })();
}
