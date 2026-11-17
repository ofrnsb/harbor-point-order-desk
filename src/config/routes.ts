// Every URL the app serves or calls: pages, API endpoints and dev screens. Nothing else in the codebase spells a path.
const q = encodeURIComponent;
const withQuery = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params)}`;

const ADMIN_API = "/api/admin";

/** Pages the browser is sent to. */
export const PAGES = {
  home: "/",
  signIn: "/login",
  setup: "/setup",
  admin: {
    overview: "/admin",
    org: "/admin/organization",
    users: "/admin/users",
    connections: "/admin/connections",
    catalog: "/admin/catalog",
    policy: "/admin/policies",
    actions: "/admin/actions",
    models: "/admin/models",
    audit: "/admin/audit",
    viewAs: "/admin/view-as",
  },
  dev: {
    home: "/dev/home",
    blocks: "/dev/blocks",
    bricks: "/dev/bricks",
  },
} as const;

/** Platform endpoints. */
export const API = {
  config: "/api/config",
  me: "/api/me",
  setup: "/api/setup",
  panel: "/api/panel",
  panelOf: (unitId: string) => withQuery("/api/panel", { unitId }),
  auth: {
    logout: "/api/auth/logout",
    login: "/api/auth/login",
  },
  chat: "/api/chat",
  chats: "/api/chats",
  chatById: (id: string) => `/api/chats/${q(id)}`,
  projects: (query: string) => `/api/projects?${query}`,
  projectsOf: (unitId: string) => withQuery("/api/projects", { unitId }),
  project: (id: string, query: string) => `/api/projects/${q(id)}?${query}`,
  pins: (query: string) => `/api/pins?${query}`,
  pinsOf: (unitId: string) => withQuery("/api/pins", { unitId }),
  pin: (id: string, unitId: string) => withQuery(`/api/pins/${q(id)}`, { unitId }),
  workspace: (unitId: string) => withQuery("/api/workspace", { unitId }),
  home: "/api/home",
  work: (id: string) => `/api/work/${q(id)}`,
  inbox: "/api/inbox",
  inboxRun: "/api/inbox/run",
  inboxIngest: "/api/inbox/ingest",
  inboxItem: (id: string) => `/api/inbox/${q(id)}`,
  inboxCheck: (id: string) => `/api/inbox/${q(id)}/check`,
  action: (id: string) => `/api/actions/${q(id)}`,
  uiGuard: "/api/ui-guard",
  mcp: "/api/mcp",
  admin: {
    overview: `${ADMIN_API}/overview`,
    tenant: `${ADMIN_API}/tenant`,
    units: `${ADMIN_API}/units`,
    unit: (id: string) => withQuery(`${ADMIN_API}/units`, { id }),
    users: `${ADMIN_API}/users`,
    memberships: `${ADMIN_API}/memberships`,
    connections: `${ADMIN_API}/connections`,
    connection: (id: string) => withQuery(`${ADMIN_API}/connections`, { id }),
    connectionTest: (id: string) => `${ADMIN_API}/connections/${q(id)}/test`,
    connectionIntrospect: (id: string) => `${ADMIN_API}/connections/${q(id)}/introspect`,
    catalogEdit: `${ADMIN_API}/catalog`,
    catalog: (connectionId: string) => withQuery(`${ADMIN_API}/catalog`, { connectionId }),
    actions: `${ADMIN_API}/actions`,
    action: (id: string) => withQuery(`${ADMIN_API}/actions`, { id }),
    routes: `${ADMIN_API}/routes`,
    route: (id: string) => withQuery(`${ADMIN_API}/routes`, { id }),
    usage: (days: number | string) => withQuery(`${ADMIN_API}/usage`, { days: String(days) }),
    simulate: (userId: string, unitId: string) => withQuery(`${ADMIN_API}/simulate`, { userId, unitId }),
    audit: (query: URLSearchParams) => `${ADMIN_API}/audit?${query}`,
    auditVerify: `${ADMIN_API}/audit/verify`,
    auditExport: `${ADMIN_API}/audit/export`,
    auditExportRange: (from: string, to: string) => withQuery(`${ADMIN_API}/audit/export`, { from, to }),
  },
} as const;
