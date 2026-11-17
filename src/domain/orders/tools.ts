// The Order Desk's two agent tools: check a draft against the ERP, and file the decision on one email.
import { z } from "zod";
import { defineTool, type ToolCtx } from "../../lib/domain.ts";
import { AGENT_FLAGS, REQUEST_KINDS, TRIAGE } from "../../config/orders.ts";
import { ORDER_TOOLS as T, STATE_LABEL } from "../../copy/orders.ts";
import { erpDb, erpView } from "./erp.ts";
import { fileTriage, openEarlier } from "./desk.ts";
import { checkProposal } from "./rules.ts";
import type { Checked, Proposal } from "./types.ts";

const S = T.shape;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const LineShape = z.object({
  sku: z.string().trim().min(1).max(40).describe(S.sku),
  qty: z.number().describe(S.qty),
  source_text: z.string().max(TRIAGE.reasonMax).describe(S.sourceText),
  sku_named: z.boolean().describe(S.skuNamed),
  quoted_price: z.number().nonnegative().optional().describe(S.quotedPrice),
  line_no: z.number().int().positive().optional().describe(S.lineNo),
});
const Lines = z.array(LineShape).min(1).max(TRIAGE.linesMax).describe(S.lines);

const ProposalShape = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"), customer_id: z.string().min(1).describe(S.customerId),
    ship_to_id: z.string().optional().describe(S.shipToId), customer_po: z.string().max(60).optional().describe(S.customerPo),
    requested_date: z.string().regex(DATE).optional().describe(S.requestedDate), lines: Lines,
  }),
  z.object({ action: z.literal("change"), so_number: z.string().min(1).describe(S.soNumber), lines: Lines }),
  z.object({ action: z.literal("cancel"), so_number: z.string().min(1).describe(S.soNumber), reason: z.string().max(TRIAGE.reasonMax).describe(S.reason) }),
]).describe(S.proposal);
type ProposalIn = z.infer<typeof ProposalShape>;

const toLines = (lines: z.infer<typeof Lines>) => lines.map((l) => ({
  sku: l.sku.toUpperCase(), qty: l.qty, sourceText: l.source_text, skuNamed: l.sku_named,
  ...(l.quoted_price !== undefined ? { quotedPrice: l.quoted_price } : {}), ...(l.line_no !== undefined ? { lineNo: l.line_no } : {}),
}));

export function toProposal(p: ProposalIn): Proposal {
  if (p.action === "create") return { action: "create", customerId: p.customer_id.toUpperCase(), shipToId: p.ship_to_id ?? null, customerPo: p.customer_po ?? null, requestedDate: p.requested_date ?? null, lines: toLines(p.lines) };
  if (p.action === "change") return { action: "change", soNumber: p.so_number.toUpperCase(), lines: toLines(p.lines) };
  return { action: "cancel", soNumber: p.so_number.toUpperCase(), reason: p.reason };
}

/** What the model reads back: the numbers and issues, without the fields it sent. */
const brief = (c: Checked) => JSON.stringify({
  customer: c.customerName, ship_to: c.shipTo?.name ?? null, total: c.total, credit: c.credit,
  lines: c.lines.map((l) => ({ sku: l.sku, name: l.name, uom: l.uom, qty: l.qty, unit_price: l.unitPrice, price: l.priceSource, value: l.value, available: l.available, next_supply: l.nextSupply, ...(l.previousQty !== undefined ? { was: l.previousQty, shipped: l.shipped } : {}) })),
  issues: c.issues.map((i) => `${i.severity}: ${i.message}`),
});

const checkOrder = defineTool({
  name: "check_order",
  category: "data",
  description: T.check.description,
  shape: { proposal: ProposalShape, order_date: z.string().regex(DATE).describe(S.orderDate), from_email: z.string().min(3).max(200).describe(S.fromEmail) },
  label: () => ({ running: T.check.running, done: T.check.done }),
  run: async ({ proposal, order_date, from_email }) =>
    T.checked(brief(checkProposal(erpView(erpDb()), toProposal(proposal), { orderDate: order_date, fromEmail: from_email, pendingPos: [] }))),
});

const fileTriageTool = defineTool({
  name: "file_triage",
  category: "actions",
  description: T.file.description,
  shape: {
    email_id: z.string().regex(TRIAGE.emailId).describe(S.emailId),
    kind: z.enum(REQUEST_KINDS).describe(S.kind),
    customer_id: z.string().optional().describe(S.customerId),
    summary: z.string().min(1).max(TRIAGE.summaryMax).describe(S.summary),
    reasons: z.array(z.string().max(TRIAGE.reasonMax)).max(TRIAGE.reasonsMax).describe(S.reasons),
    next_step: z.string().min(1).max(TRIAGE.reasonMax).describe(S.nextStep),
    flags: z.array(z.enum(AGENT_FLAGS)).max(AGENT_FLAGS.length).default([]).describe(S.flags),
    related_email_ids: z.array(z.string().regex(TRIAGE.emailId)).max(10).default([]).describe(S.related),
    reply: z.string().max(TRIAGE.replyMax).optional().describe(S.reply),
    proposals: z.array(ProposalShape).max(TRIAGE.proposalsMax).default([]).describe(S.proposals),
    supersedes: z.string().regex(TRIAGE.emailId).optional().describe(S.supersedes),
  },
  label: (i) => ({ running: T.file.running(String(i.email_id ?? "")), done: T.file.done(String(i.email_id ?? "")) }),
  run: async (a, ctx: ToolCtx) => {
    const t = fileTriage({
      emailId: a.email_id, kind: a.kind, customerId: a.customer_id?.toUpperCase() ?? null, summary: a.summary, reasons: a.reasons,
      nextStep: a.next_step, flags: [...new Set(a.flags)], related: a.related_email_ids, reply: a.reply ?? null,
      proposals: a.proposals.map(toProposal), supersedes: a.supersedes ?? null,
    }, { tenantId: ctx.eff.tenant.id, userId: ctx.principal.userId, unitId: ctx.principal.unitId, chatId: ctx.chatId });
    const loose = t.state === "needs_review" ? openEarlier(t).map((x) => x.id) : [];
    return T.filed(t.id, STATE_LABEL[t.state], `[${t.checked.map(brief).join(",")}]`) + (loose.length ? T.foldHint(loose) : "");
  },
});

export const orderTools = [checkOrder, fileTriageTool];
