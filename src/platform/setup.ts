// First run of an installation creates an empty company shell and its first admin.
import { z } from "zod";
import { record } from "./audit.ts";
import type { Tenant, User } from "./contract.ts";
import { emptyProfile, slug } from "./route-kit.ts";
import { db, listTenants, put, setMembership, setPasswordHash } from "./store.ts";
import { hashPassword } from "./passwords.ts";
import { COUNT, LEN } from "../config/data.ts";
import { WORDS } from "../copy/server.ts";
import { DEFAULT_WORKSPACE } from "../config/locale.ts";
import { PASSWORD, POLICY } from "../config/server.ts";

export const SetupS = z.object({
  company: z.object({
    name: z.string().trim().min(2).max(LEN.name), legalName: z.string().trim().min(2).max(LEN.title), industry: z.string().trim().min(2).max(LEN.message),
    timezone: z.string().trim().min(3).max(LEN.name).default(DEFAULT_WORKSPACE.timezone),
    /** ISO 4217 code money is kept in, and the locale numbers and dates are written in (en-GB, de-DE, id-ID...). */
    currency: z.string().trim().regex(/^[A-Z]{3}$/).default(DEFAULT_WORKSPACE.currency),
    locale: z.string().trim().min(2).max(LEN.tag).refine((l) => { try { return Intl.NumberFormat.supportedLocalesOf([l]).length > 0; } catch { return false; } }).default(DEFAULT_WORKSPACE.locale),
    levels: z.array(z.string().trim().min(2).max(LEN.tag)).min(2).max(COUNT.ms),
  }),
  admin: z.object({
    name: z.string().trim().min(2).max(LEN.label), email: z.email().max(COUNT.max), title: z.string().trim().max(LEN.label).default(WORDS.admin),
    password: z.string().min(PASSWORD.minLength).max(PASSWORD.maxLength),
  }),
  token: z.string().max(LEN.line).optional(),
});

/** Creates the company once. Returns null when this installation already has one. */
export function setupCompany(input: z.input<typeof SetupS>): { tenant: Tenant; admin: User } | null {
  const b = SetupS.parse(input);
  const hash = hashPassword(b.admin.password);
  const tenantId = slug(b.company.name);
  const created = db().transaction(() => {
    if (listTenants().length) return null;
    const tenant: Tenant = {
      id: tenantId, name: b.company.name, legalName: b.company.legalName, industry: b.company.industry,
      timezone: b.company.timezone, locale: b.company.locale, currency: b.company.currency, levels: b.company.levels,
      restrictedRouting: "mask", sensitivityDefaults: { public: "show", internal: "show", confidential: "mask", restricted: "deny" }, minGroupSize: POLICY.minGroupSize,
    };
    put("tenant", tenant);
    const root = put("unit", { id: `${tenantId}-root`, tenantId, parentId: null, name: b.company.legalName, code: tenantId.toUpperCase().replace(/-/g, "").slice(0, 12), profile: { ...emptyProfile(), grants: [], clearance: "internal" } });
    const admin = put("user", { id: `u-${slug(b.admin.email.split("@")[0])}`, tenantId, email: b.admin.email.toLowerCase(), name: b.admin.name, title: b.admin.title, attributes: {}, platformRoles: ["company_admin", "security_admin"], active: true });
    setMembership({ userId: admin.id, unitId: root.id, role: "unit_admin" });
    setPasswordHash(admin.id, hash);
    return { tenant, admin };
  }).immediate();
  if (created) record({ tenantId, actor: { userId: created.admin.id, unitId: null, role: "company_admin" }, kind: "admin", target: "setup", detail: { company: created.tenant.legalName, admin: created.admin.email } });
  return created;
}
