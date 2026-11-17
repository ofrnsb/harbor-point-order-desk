// A company in any country: amounts read in the currency their rows are kept in, never in a default one, and totals
// across currencies are not passed off as one figure.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { applyWorkspace, DEFAULT_WORKSPACE } from "../src/config/locale.ts";
import { currencyOfColumn, MONEY_COLUMN } from "../src/config/data.ts";
import { evalVal, fmt, fmtShort } from "../src/lib/bata/eval.ts";
import { formatValue, moneyCompact, moneyText } from "../src/lib/values.ts";
import { SetupS } from "../src/platform/setup.ts";
import type { Column } from "../src/lib/types.ts";
import type { Dataset } from "../src/lib/bata/eval.ts";

after(() => applyWorkspace(DEFAULT_WORKSPACE));

const cols: Column[] = [{ name: "branch_code", label: "Branch", type: "text" }, { name: "currency", label: "Currency", type: "text" }, { name: "revenue", label: "Revenue", type: "number", money: true }];
const ds = (rows: Record<string, unknown>[]) => ({ id: "r1", kind: "rows", title: "P&L", source: "live", columns: cols, rows } as unknown as Dataset);

test("an amount reads in its row's currency, whatever the workspace currency is", () => {
  applyWorkspace({ locale: "en-GB", currency: "EUR", timezone: "Europe/Rome" });
  const d = ds([{ branch_code: "GB-LON-001", currency: "GBP", revenue: 412_000 }]);
  const s = { data: { r1: d }, ds: d, rows: d.rows, row: d.rows[0] };
  assert.equal(fmt(evalVal({ bind: "revenue" }, s)), "£412,000");
  const e = ds([{ branch_code: "IT-MIL-003", currency: "EUR", revenue: 98_400 }]);
  assert.equal(fmt(evalVal({ bind: "revenue" }, { data: { r1: e }, ds: e, rows: e.rows, row: e.rows[0] })), "€98,400", "the workspace currency keeps its own symbol and the company's locale");
});

test("a total over rows in several currencies is not shown as money in any one of them", () => {
  applyWorkspace({ locale: "en-GB", currency: "EUR" });
  const d = ds([{ currency: "GBP", revenue: 100 }, { currency: "EUR", revenue: 200 }]);
  const g = evalVal({ agg: "sum", of: "revenue" }, { data: { r1: d }, ds: d, rows: d.rows, row: null });
  assert.equal(g.col?.money, false);
  assert.equal(g.col?.mixedCurrency, true);
  assert.doesNotMatch(fmt(g), /[€£$]/);
  const same = ds([{ currency: "CHF", revenue: 2_000_000 }, { currency: "CHF", revenue: 1_500_000 }]);
  assert.match(fmtShort(evalVal({ agg: "sum", of: "revenue" }, { data: { r1: same }, ds: same, rows: same.rows, row: null })), /^CHF\s?3\.5M$/);
});

test("the workspace currency reads in its own locale; other currencies the international way", () => {
  applyWorkspace({ locale: "en-US", currency: "USD" });
  assert.equal(moneyText(1_250_000), "$1,250,000");
  assert.equal(moneyText(39.5), "$39.50");
  assert.equal(moneyCompact(530_000_000), "$530M");
  assert.equal(moneyCompact(530_000_000, "EUR"), "€530M");
  applyWorkspace({ locale: "en-GB", currency: "GBP" });
  assert.equal(moneyText(1_250_000), "£1,250,000");
});

test("money is recognised by its words and its currency suffix; rates and counts are not money", () => {
  for (const n of ["net_sales", "net_profit", "ebitda", "labour_cost", "rent", "royalty_due", "revenue_eur", "base_pay", "unexplained_loss", "total_eur"]) assert.ok(MONEY_COLUMN.test(n), n);
  for (const n of ["royalty_rate", "eur_per_unit", "corporate_tax_rate", "sick_days", "overtime_hours", "transactions", "branch_code"]) assert.ok(!MONEY_COLUMN.test(n), n);
  assert.equal(currencyOfColumn("revenue_eur"), "EUR");
  assert.equal(currencyOfColumn("TOTAL_USD"), "USD");
  assert.equal(currencyOfColumn("net_sales"), undefined);
  applyWorkspace({ locale: "en-GB", currency: "EUR" });
  assert.equal(formatValue("unit_price_usd", 12.5), "$12.50");
  assert.match(formatValue("amount", 1200, { currency: "SEK" }), /^SEK\s1,200$/);
});

test("setup takes the company's currency and locale, and refuses ones that are not real", () => {
  const base = { company: { name: "Orsetta", legalName: "Orsetta Group SE", industry: "F&B", timezone: "Europe/Rome", levels: ["Group", "Team"] }, admin: { name: "Ann Lee", email: "ann@example.com", password: "orsetta-admin-2026" } };
  const ok = SetupS.parse({ ...base, company: { ...base.company, currency: "EUR", locale: "en-GB" } });
  assert.equal(ok.company.currency, "EUR"); assert.equal(ok.company.locale, "en-GB");
  assert.equal(SetupS.parse(base).company.currency, DEFAULT_WORKSPACE.currency, "a company that says nothing keeps the default");
  assert.throws(() => SetupS.parse({ ...base, company: { ...base.company, currency: "euro" } }));
});

test("a share named as one reads as a percent; the earliest and latest of dates are dates", () => {
  applyWorkspace({ locale: "en-GB", currency: "EUR" });
  assert.equal(fmt({ v: 4.35, col: { name: "net_margin_pct", label: "Net margin", type: "number" } }), "4.4%");
  assert.equal(fmt({ v: 4.35, col: { name: "net_margin_pct", label: "Net margin (%)", type: "number" } }), "4.35", "a label that already says % is not doubled");
  const dates = { id: "r2", title: "Royalties", columns: [{ name: "due_date", label: "Due", type: "date" }], rows: [{ due_date: "2026-06-20" }, { due_date: "2026-05-20" }, { due_date: "2026-10-20" }] } as unknown as Dataset;
  const s = { data: { r2: dates }, ds: dates, rows: dates.rows, row: null };
  assert.equal(evalVal({ agg: "min", of: "due_date" }, s).v, "2026-05-20");
  assert.equal(evalVal({ agg: "max", of: "due_date" }, s).v, "2026-10-20");
});
