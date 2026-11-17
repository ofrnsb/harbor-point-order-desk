// Sessions. Production sits behind the company's SSO proxy (oauth2-proxy, Azure App Proxy, Cloudflare Access...) which
// passes the verified email in SIMPUL_TRUSTED_EMAIL_HEADER. Otherwise sign-in with email and password sets a signed cookie.
import crypto from "node:crypto";
import type { PlatformRole, Tenant, User } from "./contract.ts";
import { currentTenant } from "./org.ts";
import { masterKey } from "./secrets.ts";
import { get, list } from "./store.ts";
import { KEY_BYTES, SESSION } from "../config/server.ts";
import { SECOND_MS } from "../config/locale.ts";
import { env } from "../config/env.ts";
import { ERR } from "../copy/server.ts";

const COOKIE = SESSION.cookie;
const TTL_S = SESSION.ttlS;

const sessionKey = () => Buffer.from(crypto.hkdfSync("sha256", masterKey(), Buffer.alloc(0), SESSION.hkdfInfo, KEY_BYTES));
const sign = (payload: string) => crypto.createHmac("sha256", sessionKey()).update(payload).digest("base64url");

export function sessionToken(userId: string, now = Date.now()): string {
  const payload = `${userId}.${Math.floor(now / SECOND_MS) + TTL_S}`;
  return `${payload}.${sign(payload)}`;
}

/** The user id in a valid, unexpired token, else null. */
export function readToken(token: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = sign(`${userId}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) * SECOND_MS < now) return null;
  return userId;
}

// A local demo install served over plain http on 127.0.0.1 opts out of Secure cookies; real deployments never set this.
const secure = () => (env.production && !env.insecureCookies ? "; Secure" : "");
export const sessionCookie = (userId: string) => `${COOKIE}=${sessionToken(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_S}${secure()}`;
export const logoutCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function getSession(req: Request): { user: User; tenant: Tenant } | null {
  let tenant: Tenant;
  try { tenant = currentTenant(); } catch { return null; }
  const header = env.trustedEmailHeader;
  let user: User | null = null;
  if (header) {
    const email = req.headers.get(header)?.trim().toLowerCase();
    user = email ? list("user", tenant.id).find((u) => u.email.toLowerCase() === email) ?? null : null;
  } else {
    const token = cookieValue(req, COOKIE);
    const id = token ? readToken(token) : null;
    user = id ? get("user", id) : null;
  }
  if (!user || !user.active || user.tenantId !== tenant.id) return null;
  return { user, tenant };
}

const deny = (status: number, error: string) => Response.json({ error }, { status });

export function requireUser(req: Request): { user: User; tenant: Tenant } {
  const s = getSession(req);
  if (!s) throw deny(401, ERR.pleaseSignIn);
  return s;
}

export function requireAdmin(req: Request, role?: PlatformRole): { user: User; tenant: Tenant } {
  const s = requireUser(req);
  const ok = role ? s.user.platformRoles.includes(role) : s.user.platformRoles.length > 0;
  if (!ok) throw deny(403, role === "security_admin" ? ERR.onlySecurityAdmin : ERR.onlyCompanyAdmin);
  return s;
}
