// Tunable numbers for the pages and API routes under src/app.

export const FIELD_MAX = {
  connectionCode: 12,
  unitCode: 16,
  name: 80,
} as const;

/** Characters of the audit head hash shown on the overview. */
export const AUDIT_HASH_CHARS = 12;

export const ROUTE_FALLBACKS_MAX = 5;
export const USAGE_DAYS = ["7", "30", "90"] as const;
export const USAGE_DAYS_DEFAULT = "30";
export const USAGE_TOP_USERS = 10;
export const FIELD_MAX_ROUTE = { label: 60, model: 120 } as const;

/** Bounds of the company minimum group size for aggregates. */
export const MIN_GROUP_SIZE = { min: 2, max: 50 } as const;
export const CATALOG_LABEL_MAX = 80;

export const ACTION_FIELD_MAX = { name: 80, prefix: 6 } as const;
export const ACTION_PREFIX_MIN = 2;
export const ACTION_DESCRIPTION_ROWS = 3;

/** How user attributes are written in the admin textarea: one key=value per line, list values comma separated. */
export const ATTR_FORMAT = { line: "\n", pair: "=", list: "," } as const;
export const USER_FIELD_MAX = { name: 80, title: 80 } as const;
export const USER_ATTR_ROWS = 3;

export const AUDIT_PAGE = 60;
export const AUDIT_PERIODS = ["7", "30", "90"] as const;
export const AUDIT_PERIOD_DEFAULT = "30";
/** How far past now the export window reaches, so events written while downloading are included. */
export const AUDIT_EXPORT_SLACK_MS = 60_000;
export const AUDIT_HASH_SHOWN = 10;

export const SETUP_LEVELS = { min: 2, max: 8 } as const;
export const SETUP_FIELD_MAX = { name: 80, legalName: 120, industry: 80, timezone: 60, level: 40, adminName: 80, adminTitle: 80 } as const;
export const SETUP_SKELETON_ROWS = 4;
export const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export const SIGN_IN_SKELETON_ROWS = 5;
export const AVATAR_INITIALS = 2;

export const FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] as const;
export const FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap";

/** API input limits and paging, enforced by the routes under src/app/api. */
export const API_LIMITS = {
  chatTitle: { min: 1, max: 80 },
  message: 2000,
  idMax: 64,
  workNote: 500,
  name: { min: 2, max: 80 },
  title: 80,
  email: 200,
  attrKey: 40,
  attrValue: 200,
  attrValues: 100,
  platformRoles: 2,
  unitCode: { min: 2, max: 16 },
  catalogName: 128,
  catalogLabel: 80,
  catalogDescription: 600,
  auditPage: { default: 50, min: 1, max: 200 },
  usageDays: { default: 30, min: 1, max: 366 },
} as const;
/** A chat is titled after its first message, cut at a word boundary when longer than this. */
export const CHAT_TITLE_CHARS = 60;
/** Runtime errors the dev guard keeps. */
export const GUARD_ERRORS_KEPT = 20;
/** Cents precision for money sums returned by the admin API. */
export const MONEY_DECIMALS_FACTOR = 100;
/** Upper bound for an open-ended audit export window (ISO strings compare lexically). */
export const AUDIT_EXPORT_MAX_TO = "9999";
export const AUDIT_EXPORT_COLUMNS = ["seq", "at", "actor_id", "actor_name", "unit_id", "role", "kind", "target", "detail", "prev_hash", "hash"] as const;
export const AUDIT_KINDS = ["login", "query", "aggregate", "denied", "propose", "confirm", "approve", "reject", "execute", "fail", "model_call", "admin", "introspect"] as const;
/** The actor id the platform writes its own audit events as. */
export const SYSTEM_ACTOR = "system";
/** Prefix of connection ids, followed by the lowercased connection code. */
export const CONNECTION_ID_PREFIX = "cn_";
export const ACTION_ID_PATTERN = /^act_[a-f0-9-]{4,12}$/;

/** The shortest password accepted, checked in the browser and again on the server. */
export const PASSWORD_MIN = 12;

/** How long the API key note stays on screen after the field is entered. */
export const SIGN_IN_HINT_MS = 2000;
