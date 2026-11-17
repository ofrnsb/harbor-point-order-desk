// The Order Desk's working vocabulary and policy: what kinds of request arrive, the checks every draft runs, which desk
// reviews what, and when the agent may release an order without a person.
export const DESKS = { orderDesk: "order-desk", creditControl: "credit-control" } as const;
export type DeskId = (typeof DESKS)[keyof typeof DESKS];

export const REQUEST_KINDS = [
  "new_order", "order_change", "order_cancel", "quote_request", "return_request", "invoice_dispute", "complaint",
  "duplicate", "auto_reply", "spam", "unclear",
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Kinds that belong to Credit Control whatever the checks say. */
export const CREDIT_KINDS: readonly RequestKind[] = ["return_request", "invoice_dispute"];

export const TRIAGE_STATES = ["queued", "working", "needs_review", "released", "approved", "rejected", "closed", "merged", "failed"] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

/** States a reviewer can still act on. */
export const OPEN_STATES: readonly TriageState[] = ["needs_review"];

/** Signals the agent raises from reading the email; the server raises every other check itself. */
export const AGENT_FLAGS = ["prompt_injection", "missing_attachment", "ambiguous_item", "new_customer", "related_email", "needs_reply", "urgent"] as const;
export type AgentFlag = (typeof AGENT_FLAGS)[number];

/** Flags that only order the queue: they do not stop the agent from releasing a clean order. */
export const NON_HOLDING_FLAGS: readonly AgentFlag[] = ["urgent"];

/** block: nobody can approve until the draft changes. credit: Credit Control owns it, and nobody can approve until the hold or limit is cleared in the ERP. warn: the reviewer decides. */
export type Severity = "block" | "credit" | "warn";

export const CHECKS = {
  unknown_customer: "block",
  unknown_ship_to: "block",
  unknown_sku: "block",
  discontinued: "block",
  bad_quantity: "block",
  unknown_order: "block",
  other_customers_order: "block",
  not_editable: "block",
  below_shipped: "block",
  credit_hold: "credit",
  over_credit_limit: "credit",
  short_stock: "warn",
  unknown_contact: "warn",
  ship_to_assumed: "warn",
  price_claim: "warn",
  date_before_receipt: "warn",
  duplicate_po: "warn",
  agent_flag: "warn",
} as const satisfies Record<string, Severity>;
export type CheckCode = keyof typeof CHECKS;

/**
 * The agent releases a new order on its own only when the customer named every SKU, the sender is a known contact, no
 * check raised anything, and the order is within the Order Desk's approval limit. Everything else waits for a person.
 */
export const AUTO_RELEASE = { kinds: ["new_order"] as readonly RequestKind[], requireSkuNamed: true, requireKnownContact: true } as const;

export const ORDER_STATUS = { open: "OPEN", partial: "PARTIALLY_SHIPPED", shipped: "SHIPPED", cancelled: "CANCELLED" } as const;
export const CUSTOMER_STATUS = { active: "ACTIVE", hold: "CREDIT_HOLD" } as const;
export const PRODUCT_STATUS = { active: "ACTIVE", discontinued: "DISCONTINUED" } as const;
export const SO_PREFIX = "SO-";

export const TRIAGE = {
  /** Senders are worked in parallel; one sender's emails run in the order received, so a follow-up sees the first. */
  concurrency: 4,
  summaryMax: 280,
  reasonMax: 400,
  reasonsMax: 8,
  replyMax: 3000,
  linesMax: 40,
  proposalsMax: 6,
  /** Most emails one targeted run may name. */
  runMax: 100,
  emailId: /^E\d{3,}$/,
  noteMax: 500,
  /** One email's agent turn is stopped after this long and marked failed. */
  turnMs: 5 * 60_000,
  /** Cents: a quoted price within this of ours is the same price. */
  priceTolerance: 0.005,
} as const;

/** What one upload may carry. */
export const INGEST = {
  filesMax: 50, fileBytesMax: 2_000_000, databaseBytesMax: 20_000_000, totalBytesMax: 25_000_000, emailsMax: 500,
  /** Every written row goes into the audit log with its old and new values, so one upload stays a reviewable size. */
  rowsMax: 5000,
  idPrefix: "E", idDigits: 3, rejectedShown: 20,
  accept: ".eml,.jsonl,.json,.csv,.sqlite,.db,message/rfc822,text/csv,application/json,application/vnd.sqlite3",
} as const;

/** How often the queue screen refreshes: often while the agent works, rarely when nothing runs. */
export const INBOX_POLL = { runningMs: 2500, idleMs: 20_000, checkDebounceMs: 400 } as const;

/** Queue rows per page: what fits above the composer on a laptop screen. */
export const INBOX_PAGE = 6;

export const AGENT_ACTOR = { userId: "agent", role: "agent" } as const;
