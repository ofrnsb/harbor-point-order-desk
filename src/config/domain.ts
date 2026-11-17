// Tunable numbers and keywords of the domain layer under src/domain.

/** A desk's "handles" line is the first sentence of its unit description, cut at this length. */
export const DESK_HANDLES_CHARS = 160;
/** Working days a desk answers within when its unit sets no `sla_days` attribute. */
export const DESK_DEFAULT_SLA_DAYS = 3;
export const DESK_SLA_ATTR = "sla_days";

/** Ids: prefix_ plus this many hex characters. References: PREFIX-YYMM- plus this many characters. */
export const ID_HEX_CHARS = 12;
export const REF_RAND_CHARS = 4;
/** Item ids built from a title and row index are cut at this length. */
export const ITEM_ID_CHARS = 120;
/** Fields shown per item when a tool builds its own rows. */
export const ITEM_FIELDS = 8;

export const TOOL_ARG = { ref: 40, name: 64 } as const;

export const MESSAGE = { to: 200, toName: 120, subject: 160, body: { min: 5, max: 4_000 }, recipients: 200, summaryBody: 400, dangerAbove: 20, subjectPreview: 60 } as const;
export const TASK = { title: { min: 3, max: 160 }, detail: 2_000, recordKey: 120, note: 500, listed: 300 } as const;
export const NOTE = { text: { min: 3, max: 2_000 }, lines: 20 } as const;
export const REMINDER_TEXT = { min: 3, max: 300 } as const;
export const OUTBOX_LISTED = 200;
export const TIME_ARG_MAX = 40;
/** Sorts tasks without a due date after every dated one. */
export const NO_DUE_SORT_KEY = "9";
export const REF_PREFIX = { message: "MSG", task: "TSK", reminder: "RMD" } as const;
export const ID_PREFIX = { message: "msg", task: "task", reminder: "rem", note: "note" } as const;

/** Column-name patterns the core tools read records by. */
export const COL_PATTERNS = {
  name: /^(name|full_name|title|customer_name|product_name)$/i,
  key: /(_no|_code|_id|^id)$/i,
  stamp: /_at$/i,
  start: /^(start|from)_?(date)?$|_start$/i,
  end: /^(end|to|until)_?(date)?$|_end$/i,
  days: /^days$/i,
  unit: /^(unit|uom|sell_uom)$/i,
  status: /^status$/i,
  money: /(^|_)(total|amount)$/i,
} as const;
/** An instant inside a row (ISO date and time), shown to the agent in the company's own zone. */
export const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** Short text values that fit an item's muted line, and how many facts it holds. */
export const FACT_LINE = { textMax: 40, parts: 3 } as const;
export const ITEM_ID_SAMPLE = 24;
export const CELL_JSON_MAX = 200;
export const ROWS_TEXT = { default: 60, related: 10, aggregate: 40 } as const;
export const FILTER_ARGS = { column: 64, value: 200, values: 200 } as const;
export const QUERY = { system: 40, object: 80, columns: 30, filters: 12, limit: 200, offset: 100_000, title: 80, key: 120 } as const;
export const AGG = { metrics: 6, as: 40, groupBy: 3, limit: 500, decimals: 1, lookups: 3, computed: 4 } as const;
export const RELATED_OBJECTS = 6;
export const RELATED_ROWS = 10;
/** Reads trace_process may spend following one identifier, and the minimum objects a column must appear in to be a join key. */
export const TRACE = { budget: 14, rowsPerProbe: 10, joinMin: 2, value: { min: 2, max: 80 }, outChars: 6_000 } as const;
/** Sorts steps without a date after every dated one. */
export const NO_DATE_SORT_KEY = "9999";
export const PROPOSE = { templateId: 60, param: 1_000, key: 120 } as const;
export const RECENT_WORK_DAYS = 7;
export const POLICY_SEARCH = { query: { min: 2, max: 120 }, wordMin: 3, lines: 30 } as const;
