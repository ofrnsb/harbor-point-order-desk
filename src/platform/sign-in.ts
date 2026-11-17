// Email and password sign-in, with a pause after repeated failures for one email. The same answer is given for an
// unknown email and a wrong password, so the form never tells which emails have accounts.
import type { Tenant, User } from "./contract.ts";
import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { list, passwordHashOf } from "./store.ts";
import { SIGN_IN_LIMIT } from "../config/server.ts";

type Failures = { count: number; firstAt: number };
const g = globalThis as unknown as { signInFailures?: Map<string, Failures> };
const failures = (g.signInFailures ??= new Map());

const key = (email: string) => email.trim().toLowerCase();

/** Milliseconds until sign-in reopens for this email, or 0 when it is open. */
export function pausedFor(email: string, now = Date.now()): number {
  const f = failures.get(key(email));
  if (!f || now - f.firstAt > SIGN_IN_LIMIT.windowMs) return 0;
  return f.count >= SIGN_IN_LIMIT.failures ? f.firstAt + SIGN_IN_LIMIT.windowMs - now : 0;
}

function noteFailure(email: string, now: number): void {
  const k = key(email);
  const f = failures.get(k);
  failures.set(k, f && now - f.firstAt <= SIGN_IN_LIMIT.windowMs ? { count: f.count + 1, firstAt: f.firstAt } : { count: 1, firstAt: now });
}

/** The active user with this email and password in the tenant, or null. Records the failure for the pause. */
// An unknown email is checked against a stand-in hash, so it takes as long as a wrong password and timing reveals nothing.
let standIn: string | null = null;
const standInHash = () => (standIn ??= hashPassword(crypto.randomUUID()));

export function signIn(tenant: Tenant, email: string, password: string, now = Date.now()): User | null {
  const user = list("user", tenant.id).find((u) => u.active && u.email.toLowerCase() === key(email)) ?? null;
  const hash = (user && passwordHashOf(user.id)) ?? standInHash();
  if (verifyPassword(password, hash) && user) { failures.delete(key(email)); return user; }
  noteFailure(email, now);
  return null;
}
