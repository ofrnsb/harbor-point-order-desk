// HTTP response shapes shared by the API routes (server) and the UI (client). Types only.
import type { Metric } from "../lib/types.ts";
import type { ActionTemplate, AuditEvent, CatalogObject, Connection, DbKind, Membership, ModelRoute, OrgUnit, Role, Sensitivity, Tenant, User, WorkItem } from "./contract.ts";
import type { DataStarter } from "./starters.ts";

export type UnitRef = { id: string; name: string; code: string; path: string };
export type MeResponse = {
  user: Pick<User, "id" | "name" | "email" | "title" | "platformRoles">;
  tenant: Pick<Tenant, "id" | "name" | "levels" | "currency" | "locale" | "timezone">;
  memberships: (UnitRef & { role: Role })[];
};

export type ScopeObject = { name: string; label: string; columns: number; masked: string[]; hashed: string[]; aggregated: string[]; denied: number; rowFilters: string[] };
export type ScopeSystem = { connectionId: string; code: string; name: string; kind: DbKind; status: Connection["status"]; objects: ScopeObject[] };
export type ScopeSummary = {
  systems: ScopeSystem[];
  outOfScope: { code: string; name: string; kind: DbKind }[];
  clearance: Sensitivity;
  approvalOver: number;
  budget: { limit: number; used: number };
  models: { id: string; label: string; external: boolean }[];
  actions: { id: string; name: string; owner: string }[];
  rules: { text: string; unit: string; locked: boolean }[];
};

/** Row images stay on the server: they can hold columns the viewer may not read. */
export type WorkItemView = Omit<WorkItem, "preview" | "images"> & { requestedByName: string; unitName: string; templateName: string; owner: string; system: string };
export type WorkspaceResponse = {
  unit: UnitRef; role: Role;
  scope: ScopeSummary;
  queue: { awaitingMe: WorkItemView[]; mine: WorkItemView[]; recent: WorkItemView[] };
  metrics: Metric[];
  /** Opening questions built from the data in this team's scope. */
  starters: DataStarter[];
};

// ---------- Admin ----------
export type AdminOverview = {
  tenant: Tenant;
  counts: { units: number; users: number; connections: number; objects: number; restrictedColumns: number; actions: number; routes: number; pendingApprovals: number };
  spendThisMonth: number;
  /** The company's monthly AI budget (root team), when one is set. */
  budgetMonthly: number | null;
  auditHead: { seq: number; hash: string } | null;
  audit: AuditVerifyResponse;
  /** What waits on an admin, oldest first where it has an age. */
  attention: {
    approvals: { count: number; oldestAt: string | null };
    failing: { connectionId: string; code: string; name: string; note: string }[];
  };
};
export type UnitNode = OrgUnit & { depth: number; levelName: string; members: number; children: string[] };
export type UnitsResponse = { units: UnitNode[] };
export type UserRow = User & { memberships: (Membership & { unitName: string })[] };
export type UsersResponse = { users: UserRow[] };
export type ConnectionRow = Omit<Connection, "readSecret" | "writeSecret"> & { hasWrite: boolean; objects: number };
export type ConnectionsResponse = { connections: ConnectionRow[] };
/** Credentials go in, never out. */
export type ConnectionInput = { code: string; name: string; kind: DbKind; config: Connection["config"]; read: { user?: string; password?: string; url?: string; token?: string }; write?: { user?: string; password?: string; url?: string; token?: string } | null };
export type CatalogResponse = { connection: ConnectionRow; objects: CatalogObject[] };
export type CatalogPatch = { connectionId: string; object: string; exposed?: boolean; label?: string; description?: string; rename?: { from: string; to: string; same: boolean };
  column?: { name: string; label?: string; description?: string; sensitivity?: Sensitivity } };
export type ActionsResponse = { actions: ActionTemplate[] };
export type RoutesResponse = { routes: ModelRoute[]; gateway: { litellmUrl: string | null; reachable: boolean; claudeLogin: boolean } };
export type UsageResponse = {
  sinceIso: string;
  byUnit: { unitId: string; unitName: string; cost: number; limit: number; calls: number }[];
  byRoute: { routeId: string; label: string; cost: number; inputTokens: number; outputTokens: number; calls: number }[];
  byUser: { userId: string; name: string; cost: number; calls: number }[];
};
export type AuditResponse = { events: (AuditEvent & { actorName: string; targetName: string })[]; next: number | null };
export type AuditVerifyResponse = { ok: boolean; checked: number; brokenAt: number | null };
export type SimulateResponse = { user: UnitRef & { userName: string; role: Role }; scope: ScopeSummary; can: { read: boolean; propose: boolean; approve: boolean; administer: boolean } };
