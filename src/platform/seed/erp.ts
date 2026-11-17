// Builds Harbor Point's working ERP from the read-only data pack: typed columns, keys, and the day's inbox as a
// table. Every reset rebuilds it from the pack, so the snapshot at 07:00 can be replayed as often as needed.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_PACK_DB, DATA_PACK_EMAILS, DATA_PACK_INBOX, ERP_DB, ERP_TABLES as T } from "../../config/erp.ts";
import { fingerprint, parseEml } from "../../domain/orders/mail.ts";

const SCHEMA = `
CREATE TABLE ${T.customers} (
  customer_id TEXT PRIMARY KEY, name TEXT NOT NULL, payment_terms TEXT NOT NULL,
  credit_limit REAL NOT NULL, open_balance REAL NOT NULL, status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CREDIT_HOLD')));
CREATE TABLE ${T.contacts} (
  email TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES ${T.customers}, name TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE ${T.shipTos} (
  ship_to_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES ${T.customers}, name TEXT NOT NULL, address TEXT NOT NULL,
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)));
CREATE TABLE ${T.products} (
  sku TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, sell_uom TEXT NOT NULL CHECK (sell_uom IN ('CS', 'EA')),
  pack TEXT NOT NULL, list_price REAL NOT NULL, status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISCONTINUED')),
  replaced_by TEXT REFERENCES ${T.products});
CREATE TABLE ${T.prices} (
  customer_id TEXT NOT NULL REFERENCES ${T.customers}, sku TEXT NOT NULL REFERENCES ${T.products}, unit_price REAL NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT NOT NULL, PRIMARY KEY (customer_id, sku, valid_from));
CREATE TABLE ${T.inventory} (
  sku TEXT PRIMARY KEY REFERENCES ${T.products}, on_hand INTEGER NOT NULL, allocated INTEGER NOT NULL, available INTEGER NOT NULL,
  CHECK (available = on_hand - allocated));
CREATE TABLE ${T.incoming} (
  supplier_po TEXT NOT NULL, sku TEXT NOT NULL REFERENCES ${T.products}, qty INTEGER NOT NULL, expected_date TEXT NOT NULL,
  PRIMARY KEY (supplier_po, sku));
CREATE TABLE ${T.orders} (
  so_number TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES ${T.customers}, ship_to_id TEXT NOT NULL REFERENCES ${T.shipTos},
  customer_po TEXT, order_date TEXT NOT NULL, requested_date TEXT, status TEXT NOT NULL);
CREATE TABLE ${T.orderLines} (
  so_number TEXT NOT NULL REFERENCES ${T.orders}, line_no INTEGER NOT NULL, sku TEXT NOT NULL REFERENCES ${T.products},
  qty_ordered INTEGER NOT NULL, qty_shipped INTEGER NOT NULL, unit_price REAL NOT NULL, PRIMARY KEY (so_number, line_no),
  CHECK (qty_shipped <= qty_ordered));
CREATE TABLE ${T.inbox} (
  email_id TEXT PRIMARY KEY, received_at TEXT NOT NULL, from_name TEXT NOT NULL, from_email TEXT NOT NULL, to_address TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, attachments TEXT NOT NULL,
  message_id TEXT UNIQUE, fingerprint TEXT NOT NULL UNIQUE);
`;

/** The pack stores every column as text; this is the one place it is cast. */
const COPY = `
INSERT INTO ${T.customers} SELECT customer_id, name, payment_terms, CAST(credit_limit AS REAL), CAST(open_balance AS REAL), status FROM pack.customers;
INSERT INTO ${T.contacts} SELECT email, customer_id, name, role FROM pack.customer_contacts;
INSERT INTO ${T.shipTos} SELECT ship_to_id, customer_id, name, address, CAST(is_default AS INTEGER) FROM pack.ship_to_addresses;
INSERT INTO ${T.products} SELECT sku, name, category, sell_uom, pack, CAST(list_price AS REAL), status, NULLIF(replaced_by, '') FROM pack.products;
INSERT INTO ${T.prices} SELECT customer_id, sku, CAST(unit_price AS REAL), valid_from, valid_to FROM pack.customer_prices;
INSERT INTO ${T.inventory} SELECT sku, CAST(on_hand AS INTEGER), CAST(allocated AS INTEGER), CAST(available AS INTEGER) FROM pack.inventory;
INSERT INTO ${T.incoming} SELECT supplier_po, sku, CAST(qty AS INTEGER), expected_date FROM pack.incoming_supply;
INSERT INTO ${T.orders} SELECT so_number, customer_id, ship_to_id, NULLIF(customer_po, ''), order_date, NULLIF(requested_date, ''), status FROM pack.sales_orders;
INSERT INTO ${T.orderLines} SELECT so_number, CAST(line_no AS INTEGER), sku, CAST(qty_ordered AS INTEGER), CAST(qty_shipped AS INTEGER), CAST(unit_price AS REAL) FROM pack.sales_order_lines;
`;

type InboxEmail = { email_id: string; received_at: string; from_name: string; from_email: string; to: string; subject: string; body: string; attachments: string[] };

function readInbox(): InboxEmail[] {
  return fs.readFileSync(path.resolve(DATA_PACK_INBOX), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as InboxEmail);
}

/** The pack's JSON lines carry no Message-ID; its .eml copies do, so a later upload of the same file is recognised. */
function messageIdOf(id: string): string | null {
  const file = path.resolve(DATA_PACK_EMAILS, `${id}.eml`);
  const parsed = fs.existsSync(file) ? parseEml(fs.readFileSync(file, "utf8")) : null;
  return parsed?.ok ? parsed.email.messageId : null;
}

function loadInbox(db: Database.Database): void {
  const insert = db.prepare(`INSERT INTO ${T.inbox} (email_id, received_at, from_name, from_email, to_address, subject, body, attachments, message_id, fingerprint)
    VALUES (@email_id, @received_at, @from_name, @from_email, @to, @subject, @body, @attachments, @message_id, @fingerprint)`);
  for (const e of readInbox()) {
    insert.run({ ...e, attachments: JSON.stringify(e.attachments), message_id: messageIdOf(e.email_id),
      fingerprint: fingerprint({ fromEmail: e.from_email, receivedAt: e.received_at, subject: e.subject, body: e.body }) });
  }
}

function removeDatabase(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

/** Rebuilds the working ERP from the pack at `target`. Returns the absolute path of the database. */
export function seedErp(target = ERP_DB): string {
  const file = path.resolve(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  removeDatabase(file);
  const db = new Database(file);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    db.prepare("ATTACH DATABASE ? AS pack").run(path.resolve(DATA_PACK_DB));
    db.transaction(() => { db.exec(COPY); loadInbox(db); })();
    db.exec("DETACH DATABASE pack");
  } finally {
    db.close();
  }
  return file;
}
