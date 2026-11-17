import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, when } from "../src/components/format.ts";

test("relative and absolute times read in the product locale whatever the browser locale", () => {
  const now = Date.parse("2026-11-10T14:00:00Z");
  assert.equal(ago("2026-11-10T13:59:40Z", now), "now");
  assert.equal(ago("2026-11-10T13:15:00Z", now), "45 min");
  assert.equal(ago("2026-11-10T10:00:00Z", now), "4 h");
  assert.equal(ago("2026-11-08T14:00:00Z", now), "2 d");
  assert.doesNotMatch(when("2026-11-10T14:08:00Z"), /\bat\b|AM|PM/);
  assert.match(when("2026-11-10T14:08:00Z"), /Nov/);
});

test("computed column names read as headings with acronyms kept", async () => {
  const { aliasLabel } = await import("../src/platform/classify.ts");
  assert.equal(aliasLabel("total_po"), "Total PO");
  assert.equal(aliasLabel("cases_per_sku"), "Cases per SKU");
  assert.equal(aliasLabel("avg_days_late"), "Avg days late");
  assert.equal(aliasLabel("SO_count"), "SO count");
});
