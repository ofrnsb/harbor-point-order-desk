// Organisation tree and profile inheritance. A unit can only narrow what its parent allows:
// data grants and actions intersect, columns take the strictest mode, row filters accumulate,
// clearance, budget and approval threshold take the lowest value. Context, glossary and rules accumulate.
import type {
  Attr, CatalogObject, ColumnMode, DataGrant, Effective, EffectiveObject, Membership, OrgUnit, Role, RowFilter, Sensitivity, Tenant, UnitProfile, User, WorkItem,
} from "./contract.ts";
import { get, list, listTenants, memberships } from "./store.ts";
import { env } from "../config/env.ts";
import { ERR, WORDS } from "../copy/server.ts";
import { applyWorkspace } from "../config/locale.ts";

/** The tenant this installation serves: SIMPUL_TENANT when set, else the only tenant in the store. */
export function currentTenant(): Tenant {
  const id = env.tenant;
  if (id) {
    const t = get("tenant", id);
    if (!t) throw new Error(ERR.tenantNotSetUp(id));
    applyWorkspace(t);
    return t;
  }
  const all = listTenants();
  if (all.length === 1) { applyWorkspace(all[0]); return all[0]; }
  if (!all.length) throw new Error(ERR.noCompanyOpenSetup);
  throw new Error(ERR.multipleCompanies);
}

export const MODE_RANK: Record<ColumnMode, number> = { show: 0, hash: 1, mask: 2, aggregate: 3, deny: 4 };
export const stricter = (a: ColumnMode, b: ColumnMode): ColumnMode => (MODE_RANK[a] >= MODE_RANK[b] ? a : b);
export const SENS_RANK: Record<Sensitivity, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };
const lowerSens = (a: Sensitivity, b: Sensitivity): Sensitivity => (SENS_RANK[a] <= SENS_RANK[b] ? a : b);

export function unitPath(unitId: string): OrgUnit[] {
  const out: OrgUnit[] = [];
  const seen = new Set<string>();
  for (let id: string | null = unitId; id; ) {
    if (seen.has(id)) throw new Error(ERR.orgTreeCycle(id));
    seen.add(id);
    const u: OrgUnit | null = get("unit", id);
    if (!u) throw new Error(ERR.teamNotFound(id));
    out.unshift(u);
    id = u.parentId;
  }
  return out;
}

export const pathLabel = (path: OrgUnit[]) => path.slice(1).map((u) => u.name).join(" › ") || path[0]?.name || "";

export function isWithin(unitId: string, ancestorId: string): boolean {
  try { return unitPath(unitId).some((u) => u.id === ancestorId); } catch { return false; }
}

export function unitsOf(userId: string): (Membership & { unit: OrgUnit; path: string })[] {
  return memberships({ userId }).flatMap((m) => {
    try { const p = unitPath(m.unitId); return [{ ...m, unit: p[p.length - 1], path: pathLabel(p) }]; } catch { return []; }
  });
}

// ---------- Folding the path ----------
type ObjCeiling = { rowFilters: RowFilter[] };
/** connectionId -> object -> ceiling. A connection mapped to "*" means every exposed object, not narrowed yet. */
type Grants = Map<string, Map<string, ObjCeiling> | "*">;
export type Folded = {
  grants: Grants;
  /** Per level, the clearance in force; column defaults are computed per level so they only ever tighten. */
  levels: { unit: OrgUnit; clearance: Sensitivity; explicit: Map<string, Map<string, Record<string, ColumnMode>>> }[];
  actions: string[] | null;
  models: string[] | null;
  clearance: Sensitivity;
  budgetMonthly: number | null;
  approvalOver: number | null;
  attributes: Record<string, Attr>;
};

const intersect = (a: string[] | null, b: string[] | null) => (a === null ? b : b === null ? a : a.filter((x) => b.includes(x)));
const minOrNull = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

function grantsFrom(list: DataGrant[]): Grants {
  const g: Grants = new Map();
  for (const d of list) {
    if (d.objects === "*") { g.set(d.connectionId, "*"); continue; }
    const m = new Map<string, ObjCeiling>();
    for (const o of d.objects) m.set(o.object, { rowFilters: [...(o.rowFilters ?? [])] });
    g.set(d.connectionId, m);
  }
  return g;
}

function intersectGrants(parent: Grants, child: Grants): Grants {
  const out: Grants = new Map();
  for (const [conn, cObjs] of child) {
    const pObjs = parent.get(conn);
    if (!pObjs) continue;
    if (pObjs === "*") { out.set(conn, cObjs === "*" ? "*" : new Map([...cObjs].map(([k, v]) => [k, { rowFilters: [...v.rowFilters] }]))); continue; }
    const m = new Map<string, ObjCeiling>();
    for (const [name, p] of pObjs) {
      if (cObjs === "*") { m.set(name, { rowFilters: [...p.rowFilters] }); continue; }
      const c = cObjs.get(name);
      if (c) m.set(name, { rowFilters: [...p.rowFilters, ...c.rowFilters.filter((f) => !p.rowFilters.some((x) => JSON.stringify(x) === JSON.stringify(f)))] });
    }
    out.set(conn, m);
  }
  return out;
}

const emptyFold = (): Folded => ({ grants: new Map(), levels: [], actions: null, models: null, clearance: "restricted", budgetMonthly: null, approvalOver: null, attributes: {} });

export function fold(path: OrgUnit[]): Folded {
  const f = emptyFold();
  path.forEach((u, i) => {
    const p: UnitProfile = u.profile;
    if (i === 0) f.grants = grantsFrom(p.grants ?? []);
    else if (p.grants !== null) f.grants = intersectGrants(f.grants, grantsFrom(p.grants));
    f.actions = intersect(f.actions, p.actions);
    f.models = intersect(f.models, p.models);
    f.clearance = i === 0 ? (p.clearance ?? "internal") : p.clearance ? lowerSens(f.clearance, p.clearance) : f.clearance;
    f.budgetMonthly = minOrNull(f.budgetMonthly, p.budgetMonthly);
    f.approvalOver = minOrNull(f.approvalOver, p.approvalOver);
    f.attributes = { ...f.attributes, ...p.attributes };
    const explicit = new Map<string, Map<string, Record<string, ColumnMode>>>();
    for (const d of p.grants ?? []) {
      if (d.objects === "*") continue;
      explicit.set(d.connectionId, new Map(d.objects.map((o) => [o.object, o.columns ?? {}])));
    }
    f.levels.push({ unit: u, clearance: f.clearance, explicit });
  });
  return f;
}

/** Column modes for one object after every level: each level's explicit mode (or its sensitivity default) can only tighten. */
export function columnModes(f: Folded, tenant: Tenant, obj: CatalogObject): Record<string, ColumnMode> {
  const out: Record<string, ColumnMode> = {};
  for (const col of obj.columns) {
    let mode: ColumnMode = "show";
    for (const lvl of f.levels) {
      const explicit = lvl.explicit.get(obj.connectionId)?.get(obj.name)?.[col.name];
      const dflt: ColumnMode = SENS_RANK[col.sensitivity] > SENS_RANK[lvl.clearance] ? tenant.sensitivityDefaults[col.sensitivity] : "show";
      mode = stricter(mode, explicit ?? dflt);
    }
    out[col.name] = mode;
  }
  return out;
}

const TEMPLATE = /^\{(user|unit)\.([a-z0-9_]+)\}$/i;
/** Resolves "{user.branch}" / "{unit.region}". Returns null when an attribute is missing so the caller fails closed. */
export function resolveValue(v: Attr, user: Record<string, Attr>, unit: Record<string, Attr>): string | string[] | null {
  const one = (s: string): string | string[] | null => {
    const m = s.match(TEMPLATE);
    if (!m) return s;
    const src = m[1].toLowerCase() === "user" ? user : unit;
    const val = src[m[2]];
    return val === undefined || (Array.isArray(val) && val.length === 0) || val === "" ? null : val;
  };
  if (Array.isArray(v)) {
    const parts = v.map(one);
    if (parts.some((p) => p === null)) return null;
    return parts.flat() as string[];
  }
  return one(v);
}

const ROLE_CAN: Record<Role, Effective["can"]> = {
  viewer: { read: true, propose: false, approve: false, administer: false },
  operator: { read: true, propose: true, approve: false, administer: false },
  approver: { read: true, propose: true, approve: true, administer: false },
  unit_admin: { read: true, propose: true, approve: true, administer: true },
};

export function materialize(f: Folded, tenant: Tenant, user: Pick<User, "attributes">, catalog: CatalogObject[]): Effective["data"] {
  const data: Effective["data"] = {};
  for (const [conn, objs] of f.grants) {
    const cat = catalog.filter((o) => o.connectionId === conn && o.exposed);
    const scoped: Record<string, EffectiveObject> = {};
    for (const obj of cat) {
      const ceiling = objs === "*" ? { rowFilters: [] } : objs.get(obj.name);
      if (!ceiling) continue;
      const rowFilters: EffectiveObject["rowFilters"] = [];
      let closed = false;
      for (const rf of ceiling.rowFilters) {
        if (!obj.columns.some((c) => c.name === rf.column)) { closed = true; break; }
        const value = resolveValue(rf.value, user.attributes, f.attributes);
        if (value === null) { closed = true; break; }
        rowFilters.push({ column: rf.column, op: Array.isArray(value) ? "in" : rf.op, value });
      }
      if (closed) continue;
      const modes = columnModes(f, tenant, obj);
      const columns = Object.fromEntries(Object.entries(modes).filter(([, m]) => m !== "deny"));
      if (!Object.keys(columns).length) continue;
      scoped[obj.name] = { columns, rowFilters };
    }
    if (Object.keys(scoped).length) data[conn] = scoped;
  }
  return data;
}

export function resolveEffective(userId: string, unitId: string): Effective {
  const tenant = currentTenant();
  const user = get("user", userId);
  if (!user || user.tenantId !== tenant.id) throw new Error(ERR.userNotFound);
  if (!user.active) throw new Error(ERR.akunDinonaktifkan);
  const m = memberships({ userId }).find((x) => x.unitId === unitId);
  if (!m) throw new Error(ERR.andaBukanAnggotaUnit);
  const path = unitPath(unitId);
  const f = fold(path);
  const actions = list("action", tenant.id).map((a) => a.id);
  const models = list("route", tenant.id).filter((r) => r.active).map((r) => r.id);
  const glossary = new Map<string, Effective["glossary"][number]>();
  for (const u of path) for (const g of u.profile.glossary) glossary.set(g.term.toLowerCase(), { ...g, unit: u.name });
  return {
    tenant, user, unit: path[path.length - 1], role: m.role, path,
    context: path.filter((u) => u.profile.description.trim()).map((u) => ({ unit: u.name, description: u.profile.description })),
    glossary: [...glossary.values()],
    rules: path.flatMap((u) => u.profile.rules.map((r) => ({ ...r, unit: u.name }))),
    data: materialize(f, tenant, user, list("catalog", tenant.id)),
    actions: (f.actions ?? actions).filter((a) => actions.includes(a)),
    models: (f.models ?? models).filter((x) => models.includes(x)),
    clearance: f.clearance,
    budgetMonthly: f.budgetMonthly ?? 0,
    approvalOver: f.approvalOver ?? 0,
    can: ROLE_CAN[m.role],
  };
}

/** Problems with a proposed profile for a unit: anything that would widen what its parent allows. Empty means valid. */
export function validateProfile(unitId: string, profile: UnitProfile): string[] {
  const unit = get("unit", unitId);
  if (!unit) return [ERR.teamNotFoundPlain];
  const problems: string[] = [];
  if (!unit.parentId) {
    if (profile.grants === null) problems.push(ERR.rootTeamMustSetAccess);
    return problems;
  }
  const tenant = currentTenant();
  const parent = fold(unitPath(unit.parentId));
  const catalog = list("catalog", tenant.id);
  if (profile.grants) {
    for (const d of profile.grants) {
      const pObjs = parent.grants.get(d.connectionId);
      if (!pObjs) { problems.push(ERR.connectionNotAllowedByParent(d.connectionId)); continue; }
      if (d.objects === "*") { if (pObjs !== "*") problems.push(ERR.allObjectsExceedParent(d.connectionId)); continue; }
      for (const o of d.objects) {
        const obj = catalog.find((c) => c.connectionId === d.connectionId && c.name === o.object);
        if (!obj) { problems.push(ERR.objectNotInCatalog(o.object, d.connectionId)); continue; }
        if (pObjs !== "*" && !pObjs.has(o.object)) { problems.push(ERR.objectNotAllowedByParent(o.object)); continue; }
        const parentModes = columnModes(parent, tenant, obj);
        for (const [col, mode] of Object.entries(o.columns ?? {})) {
          if (!(col in parentModes)) problems.push(ERR.columnDoesNotExist(o.object, col));
          else if (MODE_RANK[mode] < MODE_RANK[parentModes[col]]) problems.push(ERR.columnLooserThanParent(o.object, col, mode, parentModes[col]));
        }
        for (const rf of o.rowFilters ?? []) if (!obj.columns.some((c) => c.name === rf.column)) problems.push(ERR.rowFilterUnknownColumn(o.object, rf.column));
      }
    }
  }
  const widen = (label: string, child: string[] | null, par: string[] | null) => {
    if (child && par) for (const x of child) if (!par.includes(x)) problems.push(ERR.notAllowedByParentTeam(label, x));
  };
  widen(WORDS.actions, profile.actions, parent.actions);
  widen(WORDS.model, profile.models, parent.models);
  if (profile.clearance && SENS_RANK[profile.clearance] > SENS_RANK[parent.clearance]) problems.push(ERR.clearanceAboveParent(profile.clearance, parent.clearance));
  if (profile.budgetMonthly !== null && parent.budgetMonthly !== null && profile.budgetMonthly > parent.budgetMonthly) problems.push(ERR.aiBudgetAboveParent);
  if (profile.budgetMonthly !== null && profile.budgetMonthly < 0) problems.push(ERR.aiBudgetNegative);
  if (profile.approvalOver !== null && parent.approvalOver !== null && profile.approvalOver > parent.approvalOver) problems.push(ERR.approvalThresholdLooser);
  return problems;
}

/** Approvers act on items from their unit or any unit below it, never on their own request. */
export function canApprove(userId: string, item: WorkItem): boolean {
  if (item.state !== "awaiting_approval" || item.requestedBy === userId) return false;
  const user = get("user", userId);
  if (!user?.active || user.tenantId !== item.tenantId) return false;
  return memberships({ userId }).some((m) => (m.role === "approver" || m.role === "unit_admin") && isWithin(item.unitId, m.unitId));
}

export function approversFor(unitId: string, exceptUserId?: string): User[] {
  const path = unitPath(unitId).map((u) => u.id);
  const ids = new Set(memberships({}).filter((m) => (m.role === "approver" || m.role === "unit_admin") && path.includes(m.unitId) && m.userId !== exceptUserId).map((m) => m.userId));
  return [...ids].map((id) => get("user", id)).filter((u): u is User => !!u?.active);
}
