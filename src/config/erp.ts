// Harbor Point's ERP: where the read-only data pack lives, where the working database is built, and the moment the
// snapshot was taken. The working database is the only one the agent reads and writes.
export const DATA_PACK_DIR = "data-pack/harbor-point";
export const DATA_PACK_DB = `${DATA_PACK_DIR}/erp.sqlite`;
export const DATA_PACK_INBOX = `${DATA_PACK_DIR}/emails.jsonl`;
export const DATA_PACK_EMAILS = `${DATA_PACK_DIR}/emails`;
export const ERP_DB = "data/systems/harbor_erp.sqlite";

export const ERP_CONNECTION = { id: "conn-erp", code: "ERP", name: "Harbor Point ERP" } as const;

export const ERP_TABLES = {
  customers: "customers",
  contacts: "customer_contacts",
  shipTos: "ship_to_addresses",
  products: "products",
  prices: "customer_prices",
  inventory: "inventory",
  incoming: "incoming_supply",
  orders: "sales_orders",
  orderLines: "sales_order_lines",
  inbox: "inbound_emails",
} as const;
