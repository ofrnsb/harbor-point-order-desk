// Shared contract for the Simpul platform. Every module imports its types from here; nobody edits it without the owner.
import type { Field } from "../lib/types.ts";

// ---------- Tenancy and organisation ----------
export type Sensitivity = "public" | "internal" | "confidential" | "restricted";
export const SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
/** How a column reaches the agent. `aggregate` columns can be summed or averaged in groups of at least `minGroupSize`, never read per row. */
export type ColumnMode = "show" | "mask" | "hash" | "aggregate" | "deny";
export const COLUMN_MODES = ["show", "mask", "hash", "aggregate", "deny"] as const;
export type Role = "viewer" | "operator" | "approver" | "unit_admin";
export const ROLES = ["viewer", "operator", "approver", "unit_admin"] as const;
export type PlatformRole = "company_admin" | "security_admin";
export type Attr = string | string[];

export type Tenant = {
  id: string; name: string; legalName: string; industry: string;
  timezone: string; locale: string; currency: string;
  /** Names of the org levels by depth, e.g. ["Company", "Division", "Department", "Team"]. */
  levels: string[];
  /** What happens to restricted columns when the model route is external. */
  restrictedRouting: "mask" | "local_model";
  /** Default mode per sensitivity for units without clearance for it. */
  sensitivityDefaults: Record<Sensitivity, ColumnMode>;
  minGroupSize: number;
};

/** A row filter. `value` may hold templates: "{user.branch}", "{unit.region}" resolve from attributes (user first, then unit chain). */
export type RowFilter = { column: string; op: "eq" | "in"; value: Attr };
export type ObjectGrant = {
  object: string;
  /** Per-column override. Columns not listed take their sensitivity default (or `show` within clearance). */
  columns?: Record<string, ColumnMode>;
  rowFilters?: RowFilter[];
};
export type DataGrant = { connectionId: string; objects: ObjectGrant[] | "*" };

export type PolicyRule = { id: string; text: string; locked: boolean };
export type UnitProfile = {
  description: string;
  glossary: { term: string; meaning: string }[];
  rules: PolicyRule[];
  /** null inherits the parent's grants unchanged; a list narrows them (never widens). */
  grants: DataGrant[] | null;
  /** Action template ids. null inherits. */
  actions: string[] | null;
  /** Model route ids. null inherits. */
  models: string[] | null;
  /** Highest sensitivity this unit may see without the tenant default applying. null inherits. */
  clearance: Sensitivity | null;
  budgetMonthly: number | null;
  /** Proposals with an amount above this need an approver. null inherits. */
  approvalOver: number | null;
  attributes: Record<string, Attr>;
};
export type OrgUnit = { id: string; tenantId: string; parentId: string | null; name: string; code: string; profile: UnitProfile };

export type User = {
  id: string; tenantId: string; email: string; name: string; title: string;
  attributes: Record<string, Attr>;
  platformRoles: PlatformRole[];
  active: boolean;
};
export type Membership = { userId: string; unitId: string; role: Role };

/** What one user may do while acting as one unit. Built by `resolveEffective` in src/platform/org.ts. */
export type EffectiveObject = { columns: Record<string, ColumnMode>; rowFilters: { column: string; op: "eq" | "in"; value: string | string[] }[] };
export type Effective = {
  tenant: Tenant; user: User; unit: OrgUnit; role: Role;
  /** Root first. */
  path: OrgUnit[];
  context: { unit: string; description: string }[];
  glossary: { term: string; meaning: string; unit: string }[];
  rules: (PolicyRule & { unit: string })[];
  /** connectionId -> object name -> scope. Objects absent here are out of scope. Columns absent from `columns` are denied. */
  data: Record<string, Record<string, EffectiveObject>>;
  actions: string[];
  models: string[];
  clearance: Sensitivity;
  budgetMonthly: number;
  approvalOver: number;
  can: { read: boolean; propose: boolean; approve: boolean; administer: boolean };
};

// ---------- Projects ----------
/** A person's working context inside one team: its own goal, instructions and a subset of the team's data. */
export type Project = {
  id: string; tenantId: string; unitId: string; ownerId: string;
  name: string; goal: string; instructions: string;
  /** "connectionId" for a whole system or "connectionId/object" for one object. Empty = the team's whole scope. */
  sources: string[];
  createdAt: string; updatedAt: string;
};

// ---------- Connections and catalog ----------
export type DbKind = (typeof DB_KINDS)[number];
export const DB_KINDS = ["sqlite"] as const;
/** A SQLite file, absolute or relative to the app's working directory. */
export type ConnectionConfig = { file: string };
export type Credentials = { user?: string; password?: string; url?: string; token?: string };
export type Connection = {
  id: string; tenantId: string;
  /** Short code shown in the access trail, e.g. "ERP". */
  code: string;
  name: string; kind: DbKind; config: ConnectionConfig;
  /** Secret ids in the platform store (encrypted). The write credential is only used by the action executor. */
  readSecret: string; writeSecret: string | null;
  status: "ok" | "error" | "untested"; statusNote: string;
  introspectedAt: string | null;
};
export type ColumnType = "text" | "number" | "date" | "bool" | "json";
/** A saved question that opens one view: shown on the empty conversation of its project (or of the team, without a project). */
export type Pin = {
  id: string; tenantId: string; unitId: string; ownerId: string; projectId: string | null;
  title: string; ask: string; view: string;
  createdAt: string;
};

export type CatalogColumn = {
  name: string; type: ColumnType; nativeType: string; nullable: boolean; pk: boolean;
  fk?: { object: string; column: string };
  label: string; description: string;
  sensitivity: Sensitivity; sensitivitySource: "auto" | "admin";
  /** Computed for one aggregate (a lookup or arithmetic), never stored in the catalog. */
  virtual?: boolean;
  /** Document stores: the dotted path of a nested field (order.items.qty), and the array it sits in, unwound to total it. */
  path?: string; unwind?: string;
  /** Learned from the data (semantics.ts): how a legacy value is encoded, what a code means, where an id points. */
  encoding?: "julian_cyyddd" | "julian_yyddd" | "julian_yyyyddd" | "yyyymmdd" | "yyyymm" | "hhmmss";
  decode?: { connectionId: string; object: string; meanings: [string, string][] };
  /** An id that points to another object's key under a different name, verified against the data (share of values found). */
  link?: { connectionId: string; object: string; column: string; overlap: number };
  /**
   * Money stored in minor units (100 = cents): set by an admin, then every read, filter and total shows the major unit.
   * `unitHint` is the learning pass's suggestion (integers, all multiples of 100), shown but never applied by itself.
   */
  minorUnits?: number; unitHint?: number;
  /** "admin" once a person confirmed or corrected encoding/decode/link: learning and re-introspection keep their choice. */
  semanticsSource?: "auto" | "admin";
};
export type CatalogObject = {
  connectionId: string; name: string; kind: "table" | "view" | "collection";
  label: string; description: string; rowEstimate: number;
  columns: CatalogColumn[]; primaryKey: string[];
  /** Hidden objects are never offered to any agent, whatever the grants say. */
  exposed: boolean;
  /** A logical object over same-shaped period tables (TXN_202609, TXN_202610, ...), read as one with UNION ALL. */
  unionOf?: string[];
  /** Effective-dated history: the columns that bound each version, and the flag for the current one when there is one. */
  history?: { from?: string; to?: string; current?: string };
  /** This object is a code table: code value, description, and the code type column when one table holds many lists. */
  codeTable?: { value: string; desc: string; type?: string };
  /**
   * The last structural change seen by introspection, so agents and admins know a system moved under them. `was` keeps
   * the columns that went away, so an admin who confirms a rename carries their labels and decisions to the new name.
   */
  changed?: { at: string; added: string[]; removed: string[]; retyped: string[]; renamed: [string, string][]; was?: CatalogColumn[] };
  /**
   * The same records held in another system, verified on the data: a change stream, an export or an API over this table.
   * Set on the copy; `overlap` is the share of the copy's keys found in the source (null: name and columns only).
   */
};

/** One fingerprint of an object: no rows are kept, only counts, shares, averages, date bounds and code tallies. */
export type ProfileSnapshot = {
  at: string;
  rows: number;
  /** "count": counted now; "estimate": a table too large to scan, taken from the database's statistics. */
  rowsFrom: "count" | "estimate";
  cols: Record<string, { nulls?: number; avg?: number; min?: string; max?: string; codes?: Record<string, number> }>;
  /** The newest date-time in the object (the date column that is furthest ahead), to see a feed that stopped. */
  newest?: { column: string; value: string };
};
/** A change in the data itself that a schema diff cannot see. */
export type Drift = {
  at: string;
  kind: "emptied" | "shrank" | "surged" | "unfilled" | "scale" | "new_code" | "stalled";
  column?: string; before?: number | string; after?: number | string;
};
export type DataProfile = {
  /** "<connectionId>/<object>", as catalog ids. */
  id: string; tenantId: string; connectionId: string; object: string;
  snapshots: ProfileSnapshot[];
  drift: Drift[];
};

// ---------- Queries (policy already applied) ----------
/** `in_parent` is added by the policy only (inherited row filters, see inherited.ts); agents cannot send it. */
export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "between" | "is_null" | "not_null" | "in_parent";
export type Filter = { column: string; op: FilterOp; value?: unknown };
/** Built by src/platform/policy.ts; connectors compile it as-is and never widen it. Column names are validated against the catalog. */
export type ScopedSelect = {
  kind: "select"; object: CatalogObject;
  /** Columns to fetch (show, mask and hash ones; masking happens after the fetch in policy.ts). */
  columns: string[];
  /** User filters plus row filters; `scope: true` marks the ones the policy added. */
  filters: (Filter & { scope?: boolean })[];
  sort?: { column: string; dir: "asc" | "desc" };
  limit: number; offset: number;
};
export type AggFn = "count" | "sum" | "avg" | "min" | "max";
export type ScopedAggregate = {
  kind: "aggregate"; object: CatalogObject;
  metrics: { fn: AggFn; column?: string; as: string }[];
  groupBy: string[];
  bucket?: { column: string; unit: "day" | "week" | "month" };
  filters: (Filter & { scope?: boolean })[];
  /** Groups with fewer rows are dropped (connectors add a row count `__n` and filter on it). 1 = no suppression. */
  minGroupSize: number;
  /**
   * Per-row totals from a related object in the same database (payments per invoice), joined on
   * child.childColumn = base.parentColumn. Each becomes a virtual number column named `as`.
   */
  lookups?: { as: string; object: CatalogObject; childColumn: string; parentColumn: string; fn: AggFn; column?: string; filters: Filter[] }[];
  /** Row-level arithmetic over number columns and lookups (balance = total - paid), also virtual columns. */
  computed?: { as: string; left: string; op: "+" | "-" | "*" | "/"; right: string }[];
  sort?: { column: string; dir: "asc" | "desc" };
  limit: number;
};
export type QueryResult = { rows: Record<string, unknown>[]; total: number | null; ms: number; statement: string };

export type ActionField = {
  column: string; label: string; kind: "text" | "number" | "date" | "choice";
  required: boolean; options?: string[];
  /** Server-set value; the agent cannot change it. "{now}", "{user.id}", "{user.name}", "{unit.code}" resolve at execution. */
  fixed?: string | number | boolean;
};
export type ActionTemplate = {
  id: string; tenantId: string; name: string; description: string;
  connectionId: string; object: string; op: WriteOp;
  /** For update: the key column; the proposal carries its value as `key`. Updates touch exactly one row. */
  keyColumn?: string;
  fields: ActionField[];
  /** Param name whose value is the amount, in the tenant currency, for the approval threshold. */
  amountField?: string;
  risk: "low" | "high";
  /** Department that owns the step, shown on the timeline and receipt. */
  owner: string;
  receiptPrefix: string;
};
/**
 * One write, never a delete. `expect` holds column values the row must still have when the write runs (compare-and-set),
 * so an approved change is applied only to the row the people involved actually saw.
 */
export type CompiledAction = {
  object: string; op: WriteOp; key?: { column: string; value: unknown }; values: Record<string, unknown>; expect?: Record<string, unknown>; pk?: string;
};
/** A new row or a change to one row. There is no delete. */
export type WriteOp = "insert" | "update";
/** `before`/`after` are the row as stored, read inside the same transaction as the write. */
export type WriteResult = { affected: number; ms: number; id?: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; rehearsed: boolean };

/** One database adapter. Implemented per kind in src/platform/connectors/. */
export interface Connector {
  readonly kind: DbKind;
  test(): Promise<void>;
  introspect(): Promise<Omit<CatalogObject, "connectionId" | "exposed">[]>;
  select(q: ScopedSelect): Promise<QueryResult>;
  aggregate(q: ScopedAggregate): Promise<QueryResult>;
  /** Runs the write in one transaction. With `rehearse` the transaction is rolled back, so nothing is kept. */
  execute(a: CompiledAction, opts?: { rehearse?: boolean }): Promise<WriteResult>;
  close(): Promise<void>;
}

// ---------- Work items (proposals and approvals) ----------
/** `executing` is claimed before the write starts, so one proposal can never be written twice. */
export type WorkState = "awaiting_confirm" | "awaiting_approval" | "executing" | "executed" | "rejected" | "cancelled" | "failed";
export type WorkItem = {
  id: string; tenantId: string; ref: string; templateId: string; title: string;
  chatId: string; actionId: string;
  requestedBy: string; unitId: string;
  params: Record<string, unknown>; key?: unknown;
  amount: number | null; needsApproval: boolean;
  state: WorkState;
  createdAt: string; updatedAt: string;
  decidedBy?: string; decidedAt?: string; note?: string;
  receipt?: Field[]; error?: string;
  auditSeq?: number;
  /** What the requester saw and confirmed (fields, linked records, rehearsal), shown unchanged to the approver. */
  summary?: Field[];
  /** The rehearsal shown on the proposal card: the row before and after, from a rolled-back transaction. */
  preview?: { before: Record<string, unknown> | null; after: Record<string, unknown> | null };
  /** The row before and after the real write, for audit and for a correcting proposal. */
  images?: { before: Record<string, unknown> | null; after: Record<string, unknown> | null };
};
/** The one agent every person works with. What it may read or write is the person's effective scope, checked on every call. */
export type Agent = {
  name: string;
  /** The end-to-end process it owns. */
  process: string;
  description: string;
  /** Departments the process crosses, in order. */
  owners: string[];
  /** Operator briefing appended to the system prompt. */
  instructions: string;
};

// ---------- Model gateway ----------
export type Provider = "anthropic" | "openai" | "gemini" | "azure" | "bedrock" | "vertex" | "ollama" | "vllm" | "claude-login" | "codex-login";
export type ModelRoute = {
  id: string; tenantId: string; label: string; provider: Provider;
  /** LiteLLM model name (e.g. "claude-sonnet", "gpt-4.1"), the Claude login alias ("sonnet" | "haiku" | "opus"), or the
   *  Codex model ("default" leaves it to the Codex login). */
  model: string;
  backend: "litellm" | "claude-sdk" | "codex-sdk";
  /** Data sent here leaves the company network. */
  external: boolean;
  fallbacks: string[];
  inputPer1M: number; outputPer1M: number;
  active: boolean;
};
export type UsageRow = {
  id: string; tenantId: string; unitId: string; userId: string; chatId: string;
  routeId: string; inputTokens: number; outputTokens: number; cost: number; at: string;
};

// ---------- Audit ----------
export type AuditKind =
  | "login" | "query" | "aggregate" | "denied" | "propose" | "confirm" | "approve" | "reject" | "execute" | "fail"
  | "model_call" | "admin" | "introspect" | "schema_change" | "data_change" | "export" | "triage" | "release" | "ingest";
export type AuditEvent = {
  seq: number; tenantId: string; at: string;
  actor: { userId: string; unitId: string | null; role: string };
  kind: AuditKind; target: string; detail: Record<string, unknown>;
  prevHash: string; hash: string;
};

// ---------- Access trail (the signature) ----------
export type AccessTouch = {
  id: string; connectionId: string; code: string; kind: DbKind; object: string; objectLabel: string;
  op: "select" | "aggregate" | "write" | "denied";
  rows: number; ms: number;
  masked: string[]; hashed: string[]; aggregated: string[];
  /** Human-readable row filters, e.g. "branch = SBY". */
  scope: string[];
  note?: string;
};
export type ModelUse = { routeId: string; label: string; external: boolean; rerouted: boolean; reason?: string };
export type AccessTrail = { touches: AccessTouch[]; model: ModelUse | null };

/** Who is acting in a turn. Validated by the chat route against memberships and agent units. */
export type Principal = { tenantId: string; userId: string; unitId: string };
