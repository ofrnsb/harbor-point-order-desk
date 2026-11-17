// The Order Desk's records: what the agent proposes for an email, what the checks found, and what a person decided.
import type { AgentFlag, CheckCode, DeskId, RequestKind, Severity, TriageState } from "../../config/orders.ts";

export type DraftLine = {
  sku: string; qty: number;
  /** The words in the email this line came from, so a reviewer can see the match. */
  sourceText: string;
  /** True when the customer wrote the SKU itself rather than a description. */
  skuNamed: boolean;
  /** A unit price the customer quoted, compared against the price the rules give. */
  quotedPrice?: number;
  /** Existing order line to change; omitted for a line the change adds. */
  lineNo?: number;
};

export type Proposal =
  | { action: "create"; customerId: string; shipToId: string | null; customerPo: string | null; requestedDate: string | null; lines: DraftLine[] }
  | { action: "change"; soNumber: string; lines: DraftLine[] }
  | { action: "cancel"; soNumber: string; reason: string };
export type ProposalAction = Proposal["action"];

export type PricedLine = {
  sku: string; name: string; uom: string; qty: number;
  unitPrice: number; priceSource: "contract" | "list" | "order";
  /** Value this line adds to the order: the whole line for a new order, the change in quantity for an edit. */
  value: number;
  available: number;
  nextSupply: { qty: number; date: string } | null;
  lineNo?: number; previousQty?: number; shipped?: number;
};

export type Issue = { code: CheckCode; severity: Severity; message: string; sku?: string };

export type Checked = {
  customerId: string | null; customerName: string | null;
  shipTo: { id: string; name: string; address: string } | null;
  lines: PricedLine[];
  /** The order's value for a new order; the change in value for an edit or a cancellation. */
  total: number;
  credit: { status: string; limit: number; openBalance: number; after: number } | null;
  issues: Issue[];
};

export type Decision = {
  by: string; at: string; outcome: "approved" | "rejected";
  note?: string; edited: boolean; soNumbers: string[]; auditSeq: number;
};

/** One inbound email and everything that happened to it. Its id is the email id. */
export type Triage = {
  id: string; tenantId: string;
  receivedAt: string; fromName: string; fromEmail: string; subject: string;
  state: TriageState;
  kind: RequestKind | null;
  customerId: string | null;
  summary: string; reasons: string[]; nextStep: string;
  flags: AgentFlag[];
  reply: string | null;
  /** One email can need several orders: one per delivery address, or a new order beside a change. */
  proposals: Proposal[];
  /** The checks for each proposal, in the same order. */
  checked: Checked[];
  desk: DeskId;
  related: string[];
  chatId: string | null;
  decision?: Decision;
  /** The orders the agent released on its own. */
  released?: { soNumbers: string[]; auditSeq: number };
  mergedInto?: string;
  error?: string;
  updatedAt: string;
};
