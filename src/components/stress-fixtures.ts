// Hostile scenarios for every answer block, rendered at /dev/blocks: empty, one, many, very long, right-to-left,
// extreme numbers, missing fields and every action state. The flow check asserts each one still renders.
import type { Action, Block, Item } from "../lib/types.ts";

const LONG = "Duplicate card-not-present charge from an overseas marketplace that settled twice after a network timeout on the acquirer side";
const ID = "REF-2026-11-03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const tones = ["good", "warn", "bad", "info", "neutral"] as const;

const item = (i: number, extra: Partial<Item> = {}): Item => ({
  id: `S-${i}`,
  title: `Record ${i}`,
  subtitle: `S-${i} · Desk ${(i % 4) + 1}`,
  status: { label: ["Settled", "In review", "Failed", "Open", "Closed"][i % 5], tone: tones[i % 5] },
  fields: [{ label: "Amount", value: `$${(i * 8.75).toLocaleString("en-US", { minimumFractionDigits: 2 })}` }],
  price: { amount: i * 8.75, currency: "USD" },
  ...extra,
});

const action = (status: Action["status"], extra: Partial<Action> = {}): Action => ({
  id: `act_stress_${status}`,
  chatId: "stress",
  type: "stress",
  payload: {},
  title: "Block the card ending 4417 and send a replacement to the address on file",
  summary: [
    { label: "Card", value: "Visa Debit ending 4417" },
    { label: "Replacement", value: "By courier in 5 working days" },
    { label: "Fee", value: "$15.00" },
    { label: "Reference", value: ID },
  ],
  consequence: "The card stops working at once, including recurring payments, wallets and every merchant that stored it. This cannot be undone; a new number is issued.",
  danger: true,
  status,
  receipt: null,
  error: null,
  createdAt: "2026-11-03T07:39:00.000Z",
  decidedAt: null,
  ...extra,
});

export type Scenario = { id: string; label: string; block: Block };

export const SCENARIOS: Scenario[] = [
  { id: "list-empty", label: "List with no items", block: { type: "list", title: "Matching transactions", items: [], source: "seeded" } },
  { id: "list-one-bare", label: "One item with no optional fields", block: { type: "list", title: "Result", items: [{ id: "bare", title: "Bare record", fields: [] }], source: "seeded" } },
  {
    id: "list-long",
    label: "Very long title, unbroken id, huge amount, many fields",
    block: {
      type: "list",
      title: LONG,
      source: "seeded",
      items: [
        item(1, { title: LONG, subtitle: ID, price: { amount: 1_234_567_890_123, currency: "USD" }, tags: ["Card not present", "Overseas", "Duplicate", "Network timeout", "Acquirer"], fields: Array.from({ length: 6 }, (_, i) => ({ label: `Field label that runs long ${i + 1}`, value: i === 2 ? ID : `Value ${i + 1}` })) }),
        item(2, { fields: [{ label: "Interest", value: "1.75% a month" }, { label: "Annual fee", value: "$95.00" }, { label: "Interest", value: "0% for 6 months" }] }),
        item(3, { status: undefined, price: null }),
      ],
    },
  },
  {
    id: "list-rtl",
    label: "Right-to-left titles mixed with numbers",
    block: {
      type: "list",
      title: "طلبات الاسترداد",
      source: "seeded",
      items: [item(4, { title: "طلب استرداد للمبلغ المخصوم مرتين 2.849.000" }), item(5, { title: "החזר כספי עבור חיוב כפול בכרטיס 4417" }), item(6)],
    },
  },
  { id: "list-150", label: "150 rows", block: { type: "list", title: "All transactions this year", source: "seeded", items: Array.from({ length: 150 }, (_, i) => item(i + 10)) } },
  { id: "list-sample", label: "Sample data with a long note", block: { type: "list", title: "Illustrative fares", source: "sample", note: `${LONG}. ${LONG}.`, items: [item(7), item(8)] } },
  {
    id: "compare-4",
    label: "Four options, uneven fields, long best-for labels",
    block: {
      type: "compare",
      title: "Savings accounts",
      items: [item(20), item(21, { fields: [] }), item(22, { title: LONG }), item(23, { price: null })],
      bestFor: { "S-20": "Best for people who move money every day and never want a monthly fee", "S-22": "Highest rate", "S-23": "Students" },
    },
  },
  {
    id: "timeline-12",
    label: "Twelve steps, a failure, no dates, long owners",
    block: {
      type: "timeline",
      title: "Dispute CS-2610-03317",
      subject: item(30, { title: LONG }),
      steps: Array.from({ length: 12 }, (_, i) => ({
        label: i === 6 ? `${LONG} (step ${i + 1})` : `Step ${i + 1}`,
        at: i < 6 ? new Date(Date.UTC(2026, 9, 20 + i, 9)).toISOString() : null,
        state: i < 6 ? "done" : i === 6 ? "failed" : i === 7 ? "current" : "pending",
        owner: i % 3 === 0 ? "Fraud and Disputes Operations, Regional Office" : "Card Operations",
        note: i === 6 ? "Acquirer did not answer within 10 working days" : undefined,
      })),
    },
  },
  {
    id: "metrics-extreme",
    label: "Huge, negative and zero figures with long labels",
    block: {
      type: "metrics",
      title: "This month",
      note: LONG,
      metrics: [
        { label: "Total outflow across every account and card this month", value: "$1,234,567,890,123", delta: "-12.4% vs last month", tone: "bad", series: [0, 0, 3, 120, 4, 0, 9, 1200] },
        { label: "Refunds", value: "$0.00", delta: "0%" },
        { label: "Open cases", value: "17", delta: "+4 (new)", tone: "warn" },
        { label: "A", value: "1" },
        { label: "Average resolution time in working days", value: "6.2 days", tone: "good", series: [9, 8, 8, 7, 6] },
        { label: "Fees", value: "$15.00" },
        { label: "Chargebacks", value: "2" },
      ],
    },
  },
  { id: "metrics-empty", label: "No figures", block: { type: "metrics", title: "Nothing measured yet", metrics: [] } },
  { id: "confirm-pending", label: "Pending, dangerous, long consequence", block: { type: "confirm", action: action("pending") } },
  {
    id: "confirm-confirmed",
    label: "Confirmed with an eight-line receipt",
    block: { type: "confirm", action: action("confirmed", { decidedAt: "2026-11-03T07:40:00.000Z", receipt: Array.from({ length: 8 }, (_, i) => ({ label: i === 0 ? "Block ref" : `Receipt line ${i + 1}`, value: i === 0 ? "BLK-D11V" : i === 3 ? ID : `Value ${i + 1}` })) }) },
  },
  { id: "confirm-failed", label: "Failed with a long error", block: { type: "confirm", action: action("failed", { error: `${LONG}. Nothing was changed; try again or ask for Card Operations.` }) } },
  { id: "confirm-cancelled", label: "Cancelled", block: { type: "confirm", action: action("cancelled", { decidedAt: "2026-11-03T07:41:00.000Z" }) } },
  {
    id: "form-all",
    label: "Every field kind, long labels, many choices",
    block: {
      type: "form",
      id: "stress-form",
      title: "Tell us about the charge",
      submitLabel: "Open the dispute",
      fields: [
        { name: "merchant", label: "Merchant name exactly as it appears on your statement, including any reference", kind: "text", required: true, value: "GADGETHUB*ONLINE BOSTON MA" },
        { name: "amount", label: "Amount", kind: "number", required: true },
        { name: "date", label: "Date of the charge", kind: "date" },
        { name: "reason", label: "Reason", kind: "choice", options: Array.from({ length: 12 }, (_, i) => (i === 3 ? LONG : `Reason ${i + 1}`)) },
      ],
    },
  },
  { id: "choices-long", label: "Six long options", block: { type: "choices", id: "stress-choices", question: `${LONG}?`, options: Array.from({ length: 6 }, (_, i) => (i % 2 ? LONG : `Option ${i + 1}`)) } },
];
