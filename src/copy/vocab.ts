// Words the product reads and writes data in: status names, column-name translations, acronyms.

export const STATUS_LABEL: Record<string, string> = {
  approved: "Approved", submitted: "Submitted", rejected: "Rejected", cancelled: "Cancelled", canceled: "Cancelled", pending: "Pending",
  draft: "Draft", open: "Open", closed: "Closed", resolved: "Resolved", done: "Done", completed: "Completed", paid: "Paid",
  partial: "Partly paid", overdue: "Overdue", written_off: "Written off", confirmed: "Confirmed", picking: "Picking",
  shipped: "Shipped", delivered: "Delivered", new: "New", waiting: "Waiting", in_progress: "In progress", blocked: "Blocked",
  failed: "Failed", executed: "Executed", active: "Active", inactive: "Inactive", lost: "Lost", short: "Short",
  closing: "Closing", credit_hold: "Credit hold", partially_shipped: "Partly shipped", discontinued: "Discontinued",
  on_hold: "On hold", in_review: "In review", under_review: "Under review", missed: "Missed", scheduled: "Scheduled", filed: "Filed", filed_late: "Filed late", waiting_documents: "Awaiting documents", ready_for_review: "Ready for review", issued: "Issued", sent: "Sent", received: "Received", won: "Won", settled: "Settled", withdrawn: "Withdrawn", potential_conflict: "Potential conflict", cleared: "Cleared", unbilled: "Unbilled", billed: "Billed",
};

export const ACRONYMS = new Set(["sku", "so", "po", "kpi", "sla", "dso", "ar", "ap", "hr", "it", "id", "cod", "uom", "usd", "vat", "eta"]);

/**
 * Abbreviations of old systems, read as the words they stand for in an English auto label ("CUST_NM" -> "Customer name").
 * Only whole tokens are expanded; a label an admin wrote is never touched.
 */
export const LEGACY_WORDS: Record<string, string> = {
  cust: "customer", cus: "customer", nm: "name", amt: "amount", bal: "balance", acct: "account", acc: "account", txn: "transaction", trx: "transaction",
  prod: "product", dt: "date", tm: "time", ts: "timestamp", qty: "quantity", desc: "description", addr: "address", br: "branch", brn: "branch",
  sts: "status", stat: "status", cd: "code", typ: "type", no: "number", num: "number", opn: "opened", cls: "closed", appr: "approved", app: "application",
  req: "request", ccy: "currency", cur: "currency", lmt: "limit", mat: "maturity", dob: "date of birth", jul: "(Julian)", seg: "segment", rt: "rate", int: "interest", ref: "reference",
};
/** Acronyms kept upper-case in generated labels. */
export const LABEL_ACRONYMS = new Set(["id", "gl", "sku", "usd", "po", "so", "sla"]);
/** Table-name prefixes that say nothing to a reader: tblLoanApp is "Loan application". */
export const TABLE_PREFIXES = new Set(["tbl", "tb", "vw", "v"]);

/** Words a generated column label always writes in capitals or its own casing. */
export const UPPER_WORDS: [string, string][] = [["sku", "SKU"], ["so", "SO"], ["po", "PO"], ["uom", "UoM"]];
