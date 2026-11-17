import { test } from "node:test";
import assert from "node:assert/strict";
import { formatValue } from "../src/lib/values.ts";

test("dollars only for money columns, never for regulatory limits or measurements", () => {
  assert.equal(formatValue("amount", 1250000), "$1,250,000");
  assert.equal(formatValue("credit_limit", 20000), "$20,000");
  assert.equal(formatValue("unit_price", 39.5), "$39.50", "an amount with cents keeps them");
  assert.equal(formatValue("fee", 7500), "$7,500");
  assert.equal(formatValue("limit_value", 150), "150");
  assert.equal(formatValue("limit_max", 3000), "3,000");
  assert.equal(formatValue("value", 231.428), "231.428");
});

test("status reads as words even when the company's value is not in the dictionary", async () => {
  const { statusLabel } = await import("../src/lib/values.ts");
  assert.equal(statusLabel("approved"), "Approved");
  assert.equal(statusLabel("CREDIT_HOLD"), "Credit hold");
  assert.equal(statusLabel("partially_shipped"), "Partly shipped");
  assert.equal(statusLabel("awaiting_pickup"), "Awaiting pickup");
  assert.equal(statusLabel("Bluefin Bistro"), "Bluefin Bistro", "anything that is not a code stays as stored");
});

test("status tones: a partial state is not mistaken for the finished state its name contains", async () => {
  const { toneOf } = await import("../src/lib/values.ts");
  assert.equal(toneOf("SHIPPED"), "good");
  assert.equal(toneOf("PARTIALLY_SHIPPED"), "warn");
  assert.equal(toneOf("OPEN"), "warn");
  assert.equal(toneOf("CREDIT_HOLD"), "bad");
  assert.equal(toneOf("DISCONTINUED"), "bad");
  assert.equal(toneOf("ACTIVE"), "good");
  assert.equal(toneOf("inactive"), "bad");
  assert.equal(toneOf("unknown"), "neutral");
});

test("years read as years", () => {
  assert.equal(formatValue("tax_year", 2025), "2025");
  assert.equal(formatValue("days", 2025), "2,025", "other numbers keep their grouping");
});

test("a stage or status column reads in words wherever it is shown", () => {
  assert.equal(formatValue("stage", "partially_shipped"), "Partly shipped");
  assert.equal(formatValue("status", "approved"), "Approved");
});

test("a legacy schema's money reads as money too: camelCase and bank abbreviations are words", async () => {
  for (const n of ["NewLimit", "CreditLimit", "BAL_AMT", "ReqAmt", "ApprAmt", "ACCTBal"]) assert.equal(formatValue(n, 750000), "$750,000", n);
  for (const n of ["AppID", "TXN_ID", "CIFNo", "RateLimit", "subtotal_qty"]) assert.equal(formatValue(n, 1500), "1,500", n);
  const { roleOf } = await import("../src/platform/wiring.ts");
  const c = (name: string, extra = {}) => ({ name, label: name, type: "number" as const, nativeType: "number", nullable: true, sensitivity: "internal" as const, sensitivitySource: "auto" as const, ...extra });
  assert.equal(roleOf(c("NewLimit") as never), "money");
  assert.equal(roleOf(c("TRX_VAL", { minorUnits: 100 }) as never), "money", "a column stored in cents is money whatever its name");
  assert.equal(roleOf(c("ReqDate", { type: "date" }) as never), "date");
});
