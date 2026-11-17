// Append-only audit log with a hash chain: each event's hash covers the previous hash, so any edit or deletion breaks the chain.
import crypto from "node:crypto";
import type { AuditVerifyResponse } from "./api-types.ts";
import type { AuditEvent, AuditKind } from "./contract.ts";
import { appendAudit, auditAll } from "./store.ts";
import { AUDIT_TARGET_CHARS } from "../config/server.ts";

export const GENESIS = "0".repeat(64);

export function hashEvent(e: Omit<AuditEvent, "hash">): string {
  const canonical = JSON.stringify([e.seq, e.tenantId, e.at, e.actor.userId, e.actor.unitId, e.actor.role, e.kind, e.target, e.detail, e.prevHash]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function record(e: { tenantId: string; actor: AuditEvent["actor"]; kind: AuditKind; target: string; detail?: Record<string, unknown> }): AuditEvent {
  return appendAudit(e.tenantId, (prev, seq) => {
    const base = { seq, tenantId: e.tenantId, at: new Date().toISOString(), actor: e.actor, kind: e.kind, target: e.target.slice(0, AUDIT_TARGET_CHARS), detail: e.detail ?? {}, prevHash: prev?.hash ?? GENESIS };
    return { ...base, hash: hashEvent(base) };
  });
}

export function verifyEvents(events: AuditEvent[]): AuditVerifyResponse {
  let prev = GENESIS;
  for (const e of events) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || hashEvent(rest) !== hash) return { ok: false, checked: events.indexOf(e), brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, checked: events.length, brokenAt: null };
}

export const verifyChain = (tenantId: string): AuditVerifyResponse => verifyEvents(auditAll(tenantId));
