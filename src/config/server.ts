// Server-side limits, timeouts and names: the agent turn, sessions, connectors, the model gateway.
import { HOUR_MS, MINUTE_MS, SECOND_MS } from "./locale.ts";
import { PASSWORD_MIN } from "./app.ts";

export const AGENT = {
  mcpServer: "app",
  serverVersion: "0.1.0",
  workDir: "agent",
  /** Empty Claude config for turns on a person's own API key: no host login, no account details. */
  keyedConfigDir: "agent-key-config",
  maxTurns: 30,
  maxBudgetUsd: 1.5,
  /** How often a step being written (a large tool call) tells how far along it is. */
  writingMs: 700,
  recapMessages: 6,
  recapChars: 400,
  resultsPerChat: 300,
  fallbackReasonChars: 120,
  /** The model reasons before acting and streams a summary of it, so a waiting user sees what it is working out. */
  thinking: { type: "adaptive", display: "summarized" },
} as const;

/**
 * The Codex backend (OpenAI's agent CLI on a ChatGPT login): its own CODEX_HOME, so none of the developer's own skills,
 * MCP servers or config reach a tenant's agent; every built-in tool off except web search; a read-only sandbox in an
 * empty folder; the app's tools over the MCP bridge, one bearer token per turn.
 */
export const CODEX = {
  bin: "codex",
  homeDir: ".local/share/order-desk-codex",
  mcpServer: "order-desk",
  tokenEnv: "ORDER_DESK_MCP_TOKEN",
  turnMs: 15 * MINUTE_MS,
  featuresOff: ["shell_tool", "apps", "plugins", "browser_use", "browser_use_external", "computer_use", "image_generation", "in_app_browser", "view_image"],
  reasoning: "medium",
  envKeep: ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG"],
  stderrChars: 600,
} as const;

/** Only these variables reach the Claude child process; an ANTHROPIC_API_KEY would switch it to API billing. */
/** Anthropic API keys as issued: the prefix, then the secret. Checked before one is stored. */
export const AGENT_KEY = { pattern: /^sk-ant-[A-Za-z0-9_-]{20,200}$/, maxLength: 220 } as const;

export const SDK_ENV_KEEP = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

export const SESSION = { cookie: "sp_session", ttlS: (8 * HOUR_MS) / SECOND_MS, hkdfInfo: "simpul-session" } as const;

/** Most rows one query or one aggregate may return, whatever the agent asks for. */
export const QUERY = { selectCap: 200, aggregateCap: 500, selectDefault: 50, aggregateDefault: 100 } as const;

/** Cross-system totals: the most rows read from one side into the in-process engine before the question is refused. */

/** How often every connected system is introspected again to catch schema changes (0 turns it off). */
export const CATALOG_REFRESH_MS = Number(process.env.SIMPUL_CATALOG_REFRESH_MS ?? 6 * 60 * 60 * SECOND_MS);

export const CONNECTOR = {
  /** How long a statement waits for a locked SQLite file before it fails. */
  statementTimeoutMs: 8 * SECOND_MS,
  sampleRows: 20,
  /** Handles are reopened this often, so a file swapped on disk or a revoked write stops being served within this window. */
  poolMaxAgeMs: 5 * 60 * SECOND_MS,
  /** A replaced handle keeps serving queries already running on it for this long before it closes. */
  poolDrainMs: 60 * SECOND_MS,
} as const;

export const GATEWAY = {
  keyTimeoutMs: 15 * SECOND_MS,
  probeTimeoutMs: 3 * SECOND_MS,
  idleMs: MINUTE_MS,
  maxIterations: 16,
  historyMessages: 12,
  traceDetailChars: 160,
  errorDetailChars: 200,
  keyBudgetPeriod: "1mo",
} as const;

export const PINS_MAX = 12;
export const ACTION_FIELD_MAX_CHARS = 2000;
/** The local demo databases started by docker-compose. */
export const AUDIT_TARGET_CHARS = 200;
export const USAGE_ROWS_MAX = 5000;

/** Column names and sample values that suggest a sensitivity label. */
export const CLASSIFY = {
  RESTRICTED: /(^|_)(ssn|social_security_no|tax_id|account_no|bank_account|bank_account_no|salary|base_salary|birth_date|dob|date_of_birth|medical|diagnosis|religion|passport)(_|$)/i,
  CONFIDENTIAL: /(^|_)(email|e_mail|phone|mobile|whatsapp|address|full_name|home_address)(_|$)/i,
  MONEY: /(^|_)(amount|price|credit_limit|limit|cost|total|paid|unit_cost|unit_price|margin)(_|$)/i,
  LOOKUP: /(^|_)(category|segment|brand|uom|channel|city|warehouse|branch|status|priority|type|department|section|position|leave_type)(_|$)/i,
  ID: /(^|_)(id|no|code|ref|number)$/i,
  /** A US Social Security number. */
  SSN: /^\d{3}-\d{2}-\d{4}$/,
  /** A North American phone number, with or without +1 and separators. */
  PHONE: /^(\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  /** Share of samples that must match a pattern before the column takes its label. */
  sampleShare: 0.6,
} as const;

/** Claude routes of the seeded tenant: list prices per million tokens, in the tenant currency (USD). */
export const CLAUDE_ROUTES = [
  { id: "claude-sonnet", label: "Claude Sonnet", model: "sonnet", fallbacks: ["claude-haiku"], inputPer1M: 3, outputPer1M: 15 },
  { id: "claude-haiku", label: "Claude Haiku", model: "haiku", fallbacks: [], inputPer1M: 1, outputPer1M: 5 },
  { id: "claude-opus", label: "Claude Opus", model: "opus", fallbacks: ["claude-sonnet"], inputPer1M: 5, outputPer1M: 25 },
] as const;

export const POLICY = { inValuesMax: 200, groupByMax: 3, aliasChars: 40, maskTail: 4, minGroupSize: 5 } as const;
export const QUEUE = { awaitingMax: 50, mineMax: 50, recentMax: 10 } as const;
/** Share of the monthly AI budget at which the team figure turns amber, then red. */
export const BUDGET_TONE = { warn: 0.6, bad: 0.85 } as const;
export const AUDIT_PAGE = { overfetch: 5, rowsMax: 2000 } as const;
export const ERROR_DETAIL_CHARS = 300;
export const SLUG_CHARS = 32;
export const DATA_STARTERS_MAX = 6;

/** AES-256 key and HKDF output length in bytes. */
export const KEY_BYTES = 32;
/** Password hashing (scrypt) and the passwords accepted. */
export const PASSWORD = { keyBytes: 64, saltBytes: 16, cost: 16_384, blockSize: 8, parallel: 1, minLength: PASSWORD_MIN, maxLength: 200 } as const;
/** Failed sign-ins one email may have in the window before sign-in pauses for it. */
export const SIGN_IN_LIMIT = { failures: 5, windowMs: 15 * MINUTE_MS } as const;

/** The start screen the agent builds when someone opens Simpul: kept until it ages out or their decisions change. */
/**
 * Data fingerprints (profile.ts). A table above scanRowsMax keeps to the database's own row statistics, so a 30-year
 * ledger is never scanned on a schedule. Drift thresholds: a table that loses a fifth of its rows or more than triples,
 * a column whose empty share rises by 30 points, an average that moves 50x (a unit switched), a newest record that
 * has not moved for two days after moving before.
 */
export const PROFILE = {
  columns: 40, codeColumns: 6, codesKept: 40, objectsPerRun: 200, scanRowsMax: 5_000_000,
  snapshotsKept: 30, driftKept: 60, driftShownMs: 30 * 24 * HOUR_MS,
  minRows: 20, shrink: 0.2, surge: 3, unfilled: 0.3, scale: 50, stalledMs: 2 * 24 * HOUR_MS,
} as const;
export const HOME_BRIEF = { ttlMs: 2 * HOUR_MS, idPrefix: "home_", pinsShown: 6, dir: "cache/home" } as const;
