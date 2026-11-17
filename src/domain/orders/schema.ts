// The proposal a reviewer sends back after editing it, validated at the API boundary.
import { z } from "zod";
import { TRIAGE } from "../../config/orders.ts";
import type { Proposal } from "./types.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const Line = z.object({
  sku: z.string().trim().min(1).max(40).transform((s) => s.toUpperCase()),
  qty: z.number().finite(),
  sourceText: z.string().max(TRIAGE.reasonMax),
  skuNamed: z.boolean(),
  quotedPrice: z.number().nonnegative().optional(),
  lineNo: z.number().int().positive().optional(),
});
const Lines = z.array(Line).min(1).max(TRIAGE.linesMax);

export const ProposalSchema: z.ZodType<Proposal> = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), customerId: z.string().min(1).max(20), shipToId: z.string().max(20).nullable(), customerPo: z.string().max(60).nullable(), requestedDate: z.string().regex(DATE).nullable(), lines: Lines }),
  z.object({ action: z.literal("change"), soNumber: z.string().min(1).max(20), lines: Lines }),
  z.object({ action: z.literal("cancel"), soNumber: z.string().min(1).max(20), reason: z.string().max(TRIAGE.reasonMax) }),
]);

export const DecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  proposals: z.array(ProposalSchema).max(TRIAGE.proposalsMax).optional(),
  reply: z.string().max(TRIAGE.replyMax).optional(),
  note: z.string().trim().max(TRIAGE.noteMax).optional(),
});
