// Turns an agent's request into a query the policy allows, and shapes what comes back.
// The agent never writes SQL: it names an object, columns and filters; this module checks each against the
// user's effective scope, adds the row filters, picks masks, and refuses anything else with a reason.
import crypto from "node:crypto";
import type { ScopeSummary } from "./api-types.ts";
import type {
  AccessTouch, AggFn, CatalogObject, ColumnMode, Effective, EffectiveObject, Filter, FilterOp, ModelRoute, ModelUse, ScopedAggregate, ScopedSelect, Sensitivity,
} from "./contract.ts";
import { parentFilter, parentGuards, sameDatabase, type ParentGuard } from "./inherited.ts";
import { masterKey } from "./secrets.ts";
import { get, list, spendByUnit } from "./store.ts";
import { POLICY, QUERY } from "../config/server.ts";
import { ERR } from "../copy/server.ts";

export class PolicyError extends Error {
  readonly code: "out_of_scope" | "column_denied" | "aggregate_only" | "bad_request";
  constructor(message: string, code: PolicyError["code"]) { super(message); this.code = code; }
}

const FILTER_OPS: FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "between", "is_null", "not_null"];
export const MAX_SELECT = QUERY.selectCap;
export const MAX_AGG = QUERY.aggregateCap;

/** `postGuards`: parents in another system whose visibility must be checked row by row after the fetch. */
export type Plan<Q> = { query: Q; masks: Record<string, "mask" | "hash">; touch: Omit<AccessTouch, "id" | "rows" | "ms">; postGuards?: ParentGuard[]; dropColumns?: string[] };

/** Row filters inherited from linked parents: compiled into the query when the parent shares the database. */
function inheritedOf(eff: Effective, obj: CatalogObject): { filters: (Filter & { scope: true })[]; post: ParentGuard[]; text: string[] } {
  const conn = get("connection", obj.connectionId);
  const out = { filters: [] as (Filter & { scope: true })[], post: [] as ParentGuard[], text: [] as string[] };
  for (const g of parentGuards(eff, obj)) {
    const f = conn ? parentFilter(eff, conn, g) : null;
    if (f) out.filters.push({ ...f, scope: true }); else out.post.push(g);
    out.text.push(ERR.inheritedScope(g.column, g.parent.label || g.parent.name));
  }
  return out;
}

export function scopeOf(eff: Effective, connectionId: string, object: string): EffectiveObject | null {
  return eff.data[connectionId]?.[object] ?? null;
}

/** The mode a column reaches this turn with: restricted columns never leave the network unmasked. */
function modeFor(eff: Effective, obj: CatalogObject, scope: EffectiveObject, column: string, external: boolean): ColumnMode {
  const mode = scope.columns[column] ?? "deny";
  const col = obj.columns.find((c) => c.name === column);
  // A column that does not exist is the agent's mistake, not an access decision: name the ones it may use.
  if (!col) {
    const usable = obj.columns.filter((c) => (scope.columns[c.name] ?? "deny") !== "deny").map((c) => c.name);
    throw new PolicyError(ERR.columnNotInObject(column, obj.label, usable.join(", ")), "bad_request");
  }
  if (external && col.sensitivity === "restricted" && mode === "show") return "mask";
  return mode;
}

function requireScope(eff: Effective, obj: CatalogObject): EffectiveObject {
  const scope = obj.exposed ? scopeOf(eff, obj.connectionId, obj.name) : null;
  if (!scope) throw new PolicyError(ERR.outsideScopeOfferRequest(obj.label, eff.unit.name), "out_of_scope");
  return scope;
}

function checkFilters(eff: Effective, obj: CatalogObject, scope: EffectiveObject, filters: Filter[], external: boolean): Filter[] {
  return filters.map((f) => {
    if (!FILTER_OPS.includes(f.op)) throw new PolicyError(ERR.unknownOperator(String(f.op)), "bad_request");
    const mode = modeFor(eff, obj, scope, f.column, external);
    if (mode === "deny") throw new PolicyError(ERR.columnNotAvailable(f.column, obj.label), "column_denied");
    if (mode !== "show") throw new PolicyError(ERR.protectedColumnNoFilter(f.column, mode), "column_denied");
    if ((f.op === "in" || f.op === "between") && !Array.isArray(f.value)) throw new PolicyError(ERR.filterNeedsList(f.op, f.column), "bad_request");
    if (f.op === "between" && (f.value as unknown[]).length !== 2) throw new PolicyError(ERR.betweenNeedsTwoValues(f.column), "bad_request");
    if (f.op === "in" && (f.value as unknown[]).length > POLICY.inValuesMax) throw new PolicyError(ERR.inFilterMaxValues(POLICY.inValuesMax), "bad_request");
    return { column: f.column, op: f.op, ...(f.value === undefined ? {} : { value: f.value }) };
  });
}

const scopeFilters = (scope: EffectiveObject) => scope.rowFilters.map((r) => ({ column: r.column, op: r.op as FilterOp, value: r.value, scope: true as const }));
const scopeText = (scope: EffectiveObject) => scope.rowFilters.map((r) => `${r.column} ${r.op === "in" ? "∈" : "="} ${Array.isArray(r.value) ? r.value.join(", ") : r.value}`);

function touchBase(eff: Effective, obj: CatalogObject, op: AccessTouch["op"], scope: EffectiveObject | null) {
  const conn = get("connection", obj.connectionId);
  return { connectionId: obj.connectionId, code: conn?.code ?? obj.connectionId, kind: "sqlite" as const, object: obj.name, objectLabel: obj.label, op, masked: [] as string[], hashed: [] as string[], aggregated: [] as string[], scope: scope ? scopeText(scope) : [] } satisfies Omit<AccessTouch, "id" | "rows" | "ms">;
}

/** A refused read, for the access trail and the audit log. */
export function deniedTouch(eff: Effective, obj: CatalogObject, reason: string): Omit<AccessTouch, "id" | "rows" | "ms"> {
  return { ...touchBase(eff, obj, "denied", null), note: reason };
}

export function planSelect(
  eff: Effective, obj: CatalogObject,
  req: { columns?: string[]; filters?: Filter[]; sort?: { column: string; dir: "asc" | "desc" }; limit?: number; offset?: number },
  opts: { external: boolean },
): Plan<ScopedSelect> {
  const scope = requireScope(eff, obj);
  const visible = obj.columns.map((c) => c.name).filter((c) => ["show", "mask", "hash"].includes(modeFor(eff, obj, scope, c, opts.external)));
  const columns = req.columns?.length ? req.columns : visible;
  for (const c of columns) {
    const mode = modeFor(eff, obj, scope, c, opts.external);
    if (mode === "aggregate") throw new PolicyError(ERR.columnAggregateOnly(c), "aggregate_only");
    if (mode === "deny") throw new PolicyError(ERR.columnNotAvailable(c, obj.label), "column_denied");
  }
  if (req.sort && modeFor(eff, obj, scope, req.sort.column, opts.external) !== "show") throw new PolicyError(ERR.cannotSortBy(req.sort.column), "column_denied");
  const masks: Plan<ScopedSelect>["masks"] = {};
  for (const c of columns) { const m = modeFor(eff, obj, scope, c, opts.external); if (m === "mask" || m === "hash") masks[c] = m; }
  const touch = touchBase(eff, obj, "select", scope);
  touch.masked = Object.keys(masks).filter((c) => masks[c] === "mask");
  touch.hashed = Object.keys(masks).filter((c) => masks[c] === "hash");
  const inherited = inheritedOf(eff, obj);
  touch.scope.push(...inherited.text);
  return {
    ...(inherited.post.length ? { postGuards: inherited.post, dropColumns: inherited.post.map((g) => g.column).filter((c) => !columns.includes(c)) } : {}),
    query: {
      kind: "select", object: obj, columns: [...new Set([...columns, ...inherited.post.map((g) => g.column)])],
      filters: [...checkFilters(eff, obj, scope, req.filters ?? [], opts.external), ...scopeFilters(scope), ...inherited.filters],
      ...(req.sort ? { sort: req.sort } : {}),
      limit: Math.max(1, Math.min(req.limit ?? QUERY.selectDefault, MAX_SELECT)), offset: Math.max(0, req.offset ?? 0),
    },
    masks, touch,
  };
}

export type LookupReq = { as: string; system?: string; object: string; child_column: string; parent_column?: string; fn: AggFn; column?: string; filters?: Filter[] };
export type ComputedReq = { as: string; left: string; op: "+" | "-" | "*" | "/"; right: string };
const ALIAS = /^[a-z][a-z0-9_]{0,39}$/;
const strict = (a: ColumnMode, b: ColumnMode): ColumnMode => (a === "aggregate" || b === "aggregate" ? "aggregate" : "show");

/**
 * Adds lookup and computed columns to the object for one aggregate. Each virtual column gets the strictest mode of what
 * it is made of, so a total built on an aggregate-only column stays aggregate-only, and the related object is read
 * through its own scope, row filters and inherited filters.
 */
function withVirtuals(eff: Effective, obj: CatalogObject, scope: EffectiveObject, lookups: LookupReq[], computed: ComputedReq[], external: boolean) {
  if (!lookups.length && !computed.length) return { obj, scope, lookups: undefined, computed: undefined };
  const conn = get("connection", obj.connectionId);
  if (!conn) throw new PolicyError(ERR.connectionNotFoundForObject(obj.connectionId), "bad_request");
  const modes: Record<string, ColumnMode> = {};
  const fresh = (as: string) => {
    if (!ALIAS.test(as) || obj.columns.some((c) => c.name === as) || modes[as]) throw new PolicyError(ERR.badVirtualName(as), "bad_request");
  };
  const outLookups = lookups.map((l) => {
    fresh(l.as);
    const cconn = l.system ? list("connection", eff.tenant.id).find((c) => c.code === l.system) : conn;
    const child = cconn ? get("catalog", `${cconn.id}/${l.object}`) : null;
    if (!cconn || !child) throw new PolicyError(ERR.unknownLookup(l.system ?? conn.code, l.object), "bad_request");
    if (!sameDatabase(conn, cconn)) throw new PolicyError(ERR.lookupOtherSystem(cconn.code, conn.code), "bad_request");
    const cs = requireScope(eff, child);
    const parentColumn = l.parent_column ?? (obj.primaryKey.length === 1 ? obj.primaryKey[0] : "");
    if (!parentColumn || modeFor(eff, obj, scope, parentColumn, external) !== "show") throw new PolicyError(ERR.cannotGroupBy(parentColumn || l.as), "column_denied");
    if (modeFor(eff, child, cs, l.child_column, external) !== "show") throw new PolicyError(ERR.cannotGroupBy(l.child_column), "column_denied");
    let mode: ColumnMode = "show";
    if (l.fn !== "count") {
      if (!l.column) throw new PolicyError(ERR.needsColumn(l.fn), "bad_request");
      const m = modeFor(eff, child, cs, l.column, false);
      const restricted = child.columns.find((c) => c.name === l.column)?.sensitivity === "restricted";
      if (m === "mask" || m === "hash" || m === "deny") throw new PolicyError(ERR.protectedColumnCountOnly(l.column), "column_denied");
      if (m === "aggregate" || (external && restricted)) { if (l.fn === "min" || l.fn === "max") throw new PolicyError(ERR.minMaxRevealsIndividual(l.column), "aggregate_only"); mode = "aggregate"; }
    }
    const inherited = inheritedOf(eff, child);
    // A child seen only through this very object, on the column it is joined by, is limited by the join itself.
    const post = inherited.post.filter((g) => !(g.parent.connectionId === obj.connectionId && g.parent.name === obj.name && g.column === l.child_column && g.key === parentColumn));
    if (post.length) throw new PolicyError(ERR.totalNeedsParentScope(child.label, post.map((g) => g.parent.label || g.parent.name).join(", ")), "out_of_scope");
    modes[l.as] = mode;
    return { as: l.as, object: child, childColumn: l.child_column, parentColumn, fn: l.fn, ...(l.column ? { column: l.column } : {}), filters: [...checkFilters(eff, child, cs, l.filters ?? [], external), ...scopeFilters(cs), ...inherited.filters] };
  });
  const operandMode = (name: string): ColumnMode => {
    if (modes[name]) return modes[name];
    const col = obj.columns.find((c) => c.name === name);
    if (!col || col.type !== "number") throw new PolicyError(ERR.computedNeedsNumber(name), "bad_request");
    const m = modeFor(eff, obj, scope, name, false);
    if (m !== "show" && m !== "aggregate") throw new PolicyError(ERR.protectedColumnCountOnly(name), "column_denied");
    return external && col.sensitivity === "restricted" ? "aggregate" : m;
  };
  for (const c of computed) { const mode = strict(operandMode(c.left), operandMode(c.right)); fresh(c.as); modes[c.as] = mode; }
  const virtual = Object.entries(modes).map(([name, mode]) => ({ name, type: "number" as const, nativeType: "virtual", nullable: true, pk: false, label: name, description: "", sensitivity: (mode === "aggregate" ? "restricted" : "internal") as Sensitivity, sensitivitySource: "auto" as const, virtual: true }));
  return { obj: { ...obj, columns: [...obj.columns, ...virtual] }, scope: { ...scope, columns: { ...scope.columns, ...modes } }, lookups: outLookups, computed: computed.map((c) => ({ ...c })) };
}

export function planAggregate(
  eff: Effective, base: CatalogObject,
  req: { metrics: { fn: AggFn; column?: string; as?: string }[]; groupBy?: string[]; bucket?: ScopedAggregate["bucket"]; filters?: Filter[]; sort?: { column: string; dir: "asc" | "desc" }; limit?: number; lookups?: LookupReq[]; computed?: ComputedReq[] },
  opts: { external: boolean },
): Plan<ScopedAggregate> {
  const v = withVirtuals(eff, base, requireScope(eff, base), req.lookups ?? [], req.computed ?? [], opts.external);
  const obj = v.obj, scope = v.scope;
  if (!req.metrics.length) throw new PolicyError(ERR.atLeastOneMetric, "bad_request");
  let protectedMetric = false;
  const aggregated: string[] = [];
  const metrics = req.metrics.map((m, i) => {
    if (m.fn !== "count" && !m.column) throw new PolicyError(ERR.needsColumn(m.fn), "bad_request");
    if (m.column && m.fn !== "count") {
      const base = modeFor(eff, obj, scope, m.column, false);
      const restricted = obj.columns.find((c) => c.name === m.column)?.sensitivity === "restricted";
      if (base === "deny") throw new PolicyError(ERR.columnNotAvailable(m.column, obj.label), "column_denied");
      if (base === "mask" || base === "hash") throw new PolicyError(ERR.protectedColumnCountOnly(m.column), "column_denied");
      if (base === "aggregate" || (opts.external && restricted)) {
        if (m.fn === "min" || m.fn === "max") throw new PolicyError(ERR.minMaxRevealsIndividual(m.column), "aggregate_only");
        protectedMetric = true;
        aggregated.push(m.column);
      }
    } else if (m.column && modeFor(eff, obj, scope, m.column, false) === "deny") {
      throw new PolicyError(ERR.columnNotAvailable(m.column, obj.label), "column_denied");
    }
    return { fn: m.fn, ...(m.column ? { column: m.column } : {}), as: (m.as ?? `${m.fn}_${m.column ?? "rows"}`).replace(/[^a-z0-9_]/gi, "_").slice(0, POLICY.aliasChars) || `m${i}` };
  });
  const groupBy = req.groupBy ?? [];
  for (const g of [...groupBy, ...(req.bucket ? [req.bucket.column] : [])]) {
    if (modeFor(eff, obj, scope, g, opts.external) !== "show") throw new PolicyError(ERR.cannotGroupBy(g), "column_denied");
  }
  if (groupBy.length > POLICY.groupByMax) throw new PolicyError(ERR.atMostThreeGroupColumns, "bad_request");
  const outCols = new Set([...groupBy, ...(req.bucket ? ["bucket"] : []), ...metrics.map((m) => m.as)]);
  if (req.sort && !outCols.has(req.sort.column)) throw new PolicyError(ERR.urutkanBerdasarkanSalahSatu([...outCols].join(", ")), "bad_request");
  const touch = touchBase(eff, obj, "aggregate", scope);
  touch.aggregated = [...new Set(aggregated)];
  const inherited = inheritedOf(eff, obj);
  // A total cannot be checked row by row afterwards, so a parent filter that cannot go into the query refuses it.
  if (inherited.post.length) throw new PolicyError(ERR.totalNeedsParentScope(obj.label, inherited.post.map((g) => g.parent.label || g.parent.name).join(", ")), "out_of_scope");
  touch.scope.push(...inherited.text);
  return {
    query: {
      kind: "aggregate", object: obj, metrics, groupBy,
      ...(req.bucket ? { bucket: req.bucket } : {}),
      filters: [...checkFilters(eff, obj, scope, req.filters ?? [], opts.external), ...scopeFilters(scope), ...inherited.filters],
      minGroupSize: protectedMetric ? Math.max(2, eff.tenant.minGroupSize) : 1,
      ...(v.lookups ? { lookups: v.lookups } : {}), ...(v.computed?.length ? { computed: v.computed } : {}),
      ...(req.sort ? { sort: req.sort } : {}),
      limit: Math.max(1, Math.min(req.limit ?? QUERY.aggregateDefault, MAX_AGG)),
    },
    masks: {}, touch,
  };
}

export function maskValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (/^[^@\s]+@[^@\s]+$/.test(s)) return `${s[0]}•••@${s.split("@")[1]}`;
  if (typeof v === "number") return "•••";
  const tail = s.replace(/\s/g, "").slice(-POLICY.maskTail);
  return s.length <= POLICY.maskTail ? "••••" : `••••${tail}`;
}

/** Keyed by tenant so the same value hashes the same within a tenant (joins and grouping still work) and differently across tenants. */
export function hashValue(v: unknown, tenantId: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  return `#${crypto.createHmac("sha256", masterKey()).update(`${tenantId}:${String(v)}`).digest("hex").slice(0, 12)}`;
}

export function shapeRows(rows: Record<string, unknown>[], masks: Record<string, "mask" | "hash">, tenantId: string): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (k === "__n") continue;
      const m = masks[k];
      out[k] = m === "mask" ? maskValue(v) : m === "hash" ? hashValue(v, tenantId) : v instanceof Date ? v.toISOString() : v;
    }
    return out;
  });
}

export function needsApproval(eff: Effective, risk: "low" | "high", amount: number | null): boolean {
  return risk === "high" || (amount !== null && amount > eff.approvalOver);
}

/** Restricted columns this user could read in clear: the reason to keep the turn on an internal model. */
export function seesRestricted(eff: Effective): boolean {
  const catalog = list("catalog", eff.tenant.id);
  return Object.entries(eff.data).some(([conn, objs]) => Object.entries(objs).some(([name, o]) => {
    const obj = catalog.find((c) => c.connectionId === conn && c.name === name);
    return !!obj && Object.entries(o.columns).some(([col, mode]) => mode === "show" && obj.columns.find((c) => c.name === col)?.sensitivity === "restricted");
  }));
}

/** The first active route this person may use; a restricted-data reader on an external route is moved to an internal one. */
export function chooseRoute(eff: Effective, routes: ModelRoute[]): { route: ModelRoute; use: ModelUse; external: boolean } {
  const allowed = routes.filter((r) => r.active && eff.models.includes(r.id));
  const preferred = allowed[0];
  if (!preferred) throw new PolicyError(ERR.noAiModelYet(eff.unit.name), "out_of_scope");
  if (preferred.external && eff.tenant.restrictedRouting === "local_model" && seesRestricted(eff)) {
    const local = allowed.find((r) => !r.external);
    if (local) return { route: local, external: false, use: { routeId: local.id, label: local.label, external: false, rerouted: true, reason: ERR.restrictedDataRoutedInternal } };
    return { route: preferred, external: true, use: { routeId: preferred.id, label: preferred.label, external: true, rerouted: false, reason: ERR.noInternalModel } };
  }
  return { route: preferred, external: preferred.external, use: { routeId: preferred.id, label: preferred.label, external: preferred.external, rerouted: false } };
}

export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** The unit whose budget binds this user (the nearest level that set the lowest limit) and the spend under it. */
export function budgetStatus(eff: Effective, now = new Date()): { limit: number; used: number; bindingUnitId: string | null } {
  const limit = eff.budgetMonthly;
  if (!limit) return { limit: 0, used: 0, bindingUnitId: null };
  const binding = [...eff.path].reverse().find((u) => u.profile.budgetMonthly === limit) ?? eff.unit;
  const spend = spendByUnit(eff.tenant.id, monthStartIso(now));
  const units = list("unit", eff.tenant.id);
  const under = (id: string): boolean => id === binding.id || (() => { const u = units.find((x) => x.id === id); return !!u?.parentId && under(u.parentId); })();
  const used = Object.entries(spend).filter(([id]) => under(id)).reduce((s, [, v]) => s + v, 0);
  return { limit: limit, used: Math.round(used), bindingUnitId: binding.id };
}

export function scopeSummary(eff: Effective): ScopeSummary {
  const connections = list("connection", eff.tenant.id);
  const catalog = list("catalog", eff.tenant.id);
  const routes = list("route", eff.tenant.id);
  const actions = list("action", eff.tenant.id);
  return {
    systems: connections.filter((c) => eff.data[c.id]).map((c) => ({
      connectionId: c.id, code: c.code, name: c.name, kind: c.kind, status: c.status,
      objects: Object.entries(eff.data[c.id]).map(([name, o]) => {
        const obj = catalog.find((x) => x.connectionId === c.id && x.name === name);
        const modes = Object.entries(o.columns);
        return {
          name, label: obj?.label ?? name, columns: modes.length,
          masked: modes.filter(([, m]) => m === "mask").map(([k]) => k),
          hashed: modes.filter(([, m]) => m === "hash").map(([k]) => k),
          aggregated: modes.filter(([, m]) => m === "aggregate").map(([k]) => k),
          denied: (obj?.columns.length ?? modes.length) - modes.length,
          rowFilters: scopeText(o),
        };
      }),
    })),
    outOfScope: connections.filter((c) => !eff.data[c.id]).map((c) => ({ code: c.code, name: c.name, kind: c.kind })),
    clearance: eff.clearance,
    approvalOver: eff.approvalOver,
    budget: (({ limit, used }) => ({ limit, used }))(budgetStatus(eff)),
    models: routes.filter((r) => eff.models.includes(r.id)).map((r) => ({ id: r.id, label: r.label, external: r.external })),
    actions: actions.filter((a) => eff.actions.includes(a.id)).map((a) => ({ id: a.id, name: a.name, owner: a.owner })),
    rules: eff.rules.map((r) => ({ text: r.text, unit: r.unit, locked: r.locked })),
  };
}
