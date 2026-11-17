// Data limits shared by the agent's tools, the answer blocks and the platform's input checks.

/** Longest text accepted per kind of field. */
export const LEN = {
  prefix: 6, short: 12, tag: 30, id: 40, name: 60, key: 64, label: 80, title: 120, ident: 128, line: 200, host: 255,
  message: 300, note: 400, para: 500, detail: 600, text: 1000, long: 2000, doc: 4000, instructions: 12000,
} as const;

/** Rows per page the agent may ask a block for. */
export const PAGE = { min: 3, max: 100 } as const;
/** Top-N cut on a brick's rows; paging handles long lists. */
export const TOP_N_MAX = 500;
/** Most entries accepted in a list field, by how long that list may reasonably be. */
export const COUNT = { xxs: 3, xs: 4, s: 5, sm: 6, ms: 8, m: 10, ml: 12, l: 20, xl: 30, wide: 40, xxl: 50, long: 60, huge: 100, max: 200, bulk: 500, points: 4000 } as const;
/** Highest TCP port. */
export const NAMES = { columns: 3, values: 200 } as const;
export const BATA = { maxDepth: 9, maxNodes: 400, gridColumns: 6, eachColumns: 4, children: 24, rowChildren: 12, tabs: 8, marks: 4, where: 8, tableColumns: 10, filterValues: 50 } as const;

export const LEGO = {
  bins: { min: 3, max: 30, default: 10 }, periods: { max: 12, default: 3 }, topN: { min: 3, max: 50, default: 10 }, wipLimit: 9999, atRiskHoursMax: 24 * 60,
  atRiskHoursDefault: 48, agendaDays: { max: 14 }, feedLimit: { max: 200 },
  /** Series and categories a chart draws before folding the rest into "Lainnya". */
  maxSeries: 3, maxCategories: 60, maxPoints: 500, projectionMinPeriods: 3, shareParts: 3,
  /** Most rows each catalog part draws. */
  rows: { gantt: 150, checklist: 200, map: 500, orgChart: 400, roster: 300, timeline: 200, tree: 500, targets: 100, alerts: 200, sla: 200, waterfall: 30, relatedRows: 20 },
  headerFacts: 6, tableColumns: 8, chartRows: 60, groups: 40, files: 300, contacts: 60, approvers: 30, feedDefault: 100,
  related: { columns: 5 }, listIds: 12,
  /** Days to the due date at which an alert turns critical, high and medium. */
  alertDays: { critical: 1, high: 2, medium: 4 },
} as const;

// Money by word, not substring: "limit_value" (a regulatory limit) is not money. Legacy names are read as words too:
// NewLimit is new_limit and BAL_AMT is bal_amt, so a 30-year-old schema's money is shown as money like a new one's.
const MONEY_WORDS = /(^|_)(amount|amt|price|total|(credit|new|card|approved|appr|requested|req|current|cur|cr)_limit|cost|costs|salary|paid|fee|bal|balance|nominal|outstanding|sales|revenue|profit|ebitda|ebit|rent|wage|wages|pay|payroll|royalty|budget|commission|discount|discounts|vat|tax|income|expense|expenses|spend|due|cogs|opex|capex|depreciation|interest|utilities|marketing|social|loss|(waste|stock|inventory|order|invoice|contract|sales|gross|net)_value)(_|$)|_(eur|usd|gbp|chf|jpy|aud|cad|sgd|aed|sar|qar|try|pln|sek|dkk|nok|myr|thb|php|vnd|inr|cny|hkd|krw|brl|mxn|zar)$/i;
// A rate, share or count is never an amount even when its name carries a money word ("royalty_rate", "eur_per_unit").
const NOT_MONEY = /(^|_)(rate|rates|pct|percent|percentage|ratio|share|per|days|count|qty|quantity|hours|score|rating|index|code|id|no|year)(_|$)/i;
/** A legacy name as snake words: NewLimit is New_Limit, ACCTBal is ACCT_Bal; snake and upper names are unchanged. */
export const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2");
export const MONEY_COLUMN = { test: (name: string): boolean => { const w = words(name); return MONEY_WORDS.test(w) && !NOT_MONEY.test(w); } };
/** The currency a column's name states ("revenue_eur", "TOTAL_USD"), when it states one. */
const ISO_CODES = new Set(["IDR", "EUR", "USD", "GBP", "CHF", "JPY", "AUD", "CAD", "SGD", "AED", "SAR", "QAR", "TRY", "PLN", "SEK", "DKK", "NOK", "MYR", "THB", "PHP", "VND", "INR", "CNY", "HKD", "KRW", "BRL", "MXN", "ZAR"]);
export const currencyOfColumn = (name: string): string | undefined => { const c = /_([a-z]{3})$/i.exec(words(name))?.[1].toUpperCase(); return c && ISO_CODES.has(c) ? c : undefined; };
export const DATE_COLUMN = /(_at|_date|date)$/i;
/** A year is a label, not a quantity: 2025, never "2.025". */
export const YEAR_COLUMN = /(^|_)(year|fiscal_year|tax_year|tahun_pajak)$/i;

/** Language for case-insensitive matching and sorting of record text. */
export const LANGUAGE = "id";

/** Longest record text a tool shows the agent per value. */
export const VALUE_CHARS = { text: 160, json: 120 } as const;
/** Default reply time of a service desk, in working days. */
export const REQUEST_DAYS_DEFAULT = 3;

/** Headline money: shortened from a billion (M) and a trillion (T), with two decimals below a hundred. */
export const MONEY_SHORT = { million: 1e6 } as const;
/** Percent shown with one decimal below ten. */
export const PCT_DECIMALS_BELOW = 10;
