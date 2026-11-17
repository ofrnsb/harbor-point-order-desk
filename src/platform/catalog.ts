// The catalog: what each connected system holds, with business labels and sensitivity, kept in the platform store.
import crypto from "node:crypto";
import type { ActionTemplate, CatalogObject, CompiledAction } from "./contract.ts";
import { humanLabel } from "./classify.ts";
import { connectorFor } from "./connectors/index.ts";
import { learnTenant } from "./learn.ts";
import { profileConnection } from "./profile.ts";
import { record } from "./audit.ts";
import { columnChanges } from "./semantics.ts";
import { get, list, put, remove } from "./store.ts";
import { ACTION_FIELD_MAX_CHARS } from "../config/server.ts";
import { ERR } from "../copy/server.ts";

export { classifyColumn, humanLabel } from "./classify.ts";

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const spellsName = (label: string, name: string) => letters(label) === letters(name);

/** Re-reads a connection's schema. Admin labels, descriptions, exposure and admin-set sensitivity survive; vanished objects are dropped. */
export async function introspectConnection(connectionId: string): Promise<CatalogObject[]> {
  const conn = get("connection", connectionId);
  if (!conn) throw new Error(ERR.connectionNotFound(connectionId));
  try {
    const fresh = await connectorFor(conn, "read").introspect();
    const existing = new Map(list("catalog", conn.tenantId).filter((o) => o.connectionId === connectionId).map((o) => [o.name, o]));
    const merged: CatalogObject[] = fresh.map((o) => {
      const old = existing.get(o.name);
      const columns = o.columns.map((c) => {
        const oc = old?.columns.find((x) => x.name === c.name);
        if (!oc) return c;
        return {
          ...c,
          // A label an admin wrote survives re-introspection; only the old English auto label gives way to a fresh one.
          // An older auto label spells the name back ("Cifno" for CIFNo): it gives way too. Only words a person chose stay.
          label: oc.label && oc.label !== c.label && oc.label !== humanLabel(c.name) && !spellsName(oc.label, c.name) ? oc.label : c.label,
          description: oc.description || c.description,
          ...(oc.sensitivitySource === "admin" ? { sensitivity: oc.sensitivity, sensitivitySource: "admin" as const } : {}),
          ...(oc.semanticsSource === "admin" ? { encoding: oc.encoding, decode: oc.decode, link: oc.link, minorUnits: oc.minorUnits, unitHint: oc.unitHint, semanticsSource: "admin" as const } : { decode: oc.decode, link: oc.link }),
        };
      });
      const diff = old ? columnChanges(old, { ...o, connectionId, exposed: true }) : null;
      // The columns that went away are kept with the change, so a confirmed rename can carry their settings over.
      const change = diff && { ...diff, was: old!.columns.filter((c) => diff.removed.includes(c.name) || diff.renamed.some(([from]) => from === c.name)) };
      return { ...o, connectionId, columns, label: old?.label && old.label !== humanLabel(o.name) && !spellsName(old.label, o.name) ? old.label : o.label, description: old?.description || o.description, exposed: old?.exposed ?? true,
        ...(change ? { changed: { at: new Date().toISOString(), ...change } } : old?.changed && (old.changed.added.length || old.changed.removed.length || old.changed.retyped.length || old.changed.renamed.length) ? { changed: old.changed } : {}) };
    });
    // A system that changed under the company is recorded, so the next answer and the auditor both know.
    const gone = [...existing.keys()].filter((n) => !fresh.some((o) => o.name === n) && !existing.get(n)!.unionOf);
    const appeared = fresh.filter((o) => existing.size && !existing.has(o.name)).map((o) => o.name);
    const altered = merged.filter((o) => o.changed && existing.get(o.name)?.changed?.at !== o.changed.at).map((o) => ({ object: o.name, ...o.changed }));
    if (gone.length || appeared.length || altered.length) record({ tenantId: conn.tenantId, actor: { userId: "system", unitId: null, role: "introspection" }, kind: "schema_change", target: conn.code, detail: { removedObjects: gone, addedObjects: appeared, objects: altered } });
    for (const o of merged) put("catalog", o);
    for (const name of existing.keys()) if (!merged.some((o) => o.name === name)) remove("catalog", `${connectionId}/${name}`);
    put("connection", { ...conn, status: "ok", statusNote: ERR.objectsRead(merged.length), introspectedAt: new Date().toISOString() });
    // Meaning is learned across the whole estate, since codes and ids often live in another system.
    await learnTenant(conn.tenantId).catch(() => {});
    // Fingerprints are taken behind the response: an admin pressing Introspect never waits for a scan.
    void profileConnection(connectionId).catch(() => {});
    return list("catalog", conn.tenantId).filter((o) => o.connectionId === connectionId);
  } catch (err) {
    put("connection", { ...conn, status: "error", statusNote: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function testConnection(connectionId: string): Promise<{ ok: boolean; note: string }> {
  const conn = get("connection", connectionId);
  if (!conn) throw new Error(ERR.connectionNotFound(connectionId));
  const t0 = Date.now();
  try {
    await connectorFor(conn, "read").test();
    const note = ERR.connectedMs(Date.now() - t0);
    put("connection", { ...conn, status: "ok", statusNote: note });
    return { ok: true, note };
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    put("connection", { ...conn, status: "error", statusNote: note });
    return { ok: false, note };
  }
}

/** "1250000", "1,250,000", "$1,250,000.50" and "1250000.5" parse; anything else is NaN. */
export function parseAmount(s: string): number {
  const t = s.trim().replace(/^\$\s*/, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

const TOKEN = /\{(now|today|user\.id|user\.name|unit\.code|rand)\}/g;

/**
 * Turns an agent's proposal into the exact write. Unknown params, missing required fields, values of the wrong kind and
 * attempts to set server-fixed fields are rejected. Fixed values may hold {now}, {today}, {user.id}, {user.name}, {unit.code}
 * and {rand} (six random characters, for references such as "RMD-{rand}").
 */
export function compileAction(t: ActionTemplate, params: Record<string, unknown>, key: unknown, ctx: { userId: string; userName: string; unitCode: string; now: string }): CompiledAction {
  const editable = new Map(t.fields.filter((f) => f.fixed === undefined).map((f) => [f.column, f]));
  const fixed = t.fields.filter((f) => f.fixed !== undefined);
  for (const k of Object.keys(params)) {
    if (fixed.some((f) => f.column === k)) throw new Error(ERR.setBySystemCannot(k));
    if (!editable.has(k)) throw new Error(ERR.unknownField(k, t.name));
  }
  const values: Record<string, unknown> = {};
  for (const f of editable.values()) {
    const raw = params[f.column];
    const empty = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    if (empty) {
      if (f.required) throw new Error(ERR.required(f.label));
      continue;
    }
    if (f.kind === "number") {
      const n = typeof raw === "number" ? raw : parseAmount(String(raw));
      if (!Number.isFinite(n)) throw new Error(ERR.mustNumber(f.label));
      values[f.column] = n;
    } else if (f.kind === "date") {
      const s = String(raw).trim();
      const d = new Date(s);
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || isNaN(d.getTime())) throw new Error(ERR.mustDateYyyyMm(f.label));
      values[f.column] = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : d.toISOString();
    } else if (f.kind === "choice") {
      const s = String(raw).trim();
      if (!f.options?.includes(s)) throw new Error(ERR.mustOne(f.label, (f.options ?? []).join(", ")));
      values[f.column] = s;
    } else {
      const s = String(raw).trim();
      if (s.length > ACTION_FIELD_MAX_CHARS) throw new Error(ERR.tooLong(f.label));
      values[f.column] = s;
    }
  }
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  const sub = (s: string) => s.replace(TOKEN, (_m, k: string) => ({ now: ctx.now, today: ctx.now.slice(0, 10), "user.id": ctx.userId, "user.name": ctx.userName, "unit.code": ctx.unitCode, rand })[k] ?? "");
  for (const f of fixed) values[f.column] = typeof f.fixed === "string" ? sub(f.fixed) : f.fixed;

  if (t.op === "update") {
    if (!t.keyColumn) throw new Error(ERR.hasNoKeyColumn(t.name));
    if (key === undefined || key === null || String(key).trim() === "") throw new Error(ERR.needsRecordKey(t.name, t.keyColumn));
    if (!Object.keys(values).length) throw new Error(ERR.changesNothing(t.name));
    return { object: t.object, op: "update", key: { column: t.keyColumn, value: key }, values };
  }
  return { object: t.object, op: "insert", values };
}

/**
 * An admin's answer to a likely rename. Confirmed: what people decided about the old column (its label and description,
 * a sensitivity set by an admin, corrected meaning and units, its zone) moves to the new name. Either way the question
 * is settled and leaves the change.
 */
export function settleRename(o: CatalogObject, from: string, to: string, same: boolean): CatalogObject {
  const was = o.changed?.was?.find((c) => c.name === from);
  const columns = !same || !was ? o.columns : o.columns.map((c) => c.name !== to ? c : {
    ...c,
    label: was.label || c.label,
    description: was.description || c.description,
    ...(was.sensitivitySource === "admin" ? { sensitivity: was.sensitivity, sensitivitySource: "admin" as const } : {}),
    ...(was.semanticsSource === "admin" ? { encoding: was.encoding, decode: was.decode, link: was.link, minorUnits: was.minorUnits, unitHint: was.unitHint, semanticsSource: "admin" as const } : {}),
  });
  if (!o.changed) return { ...o, columns };
  const renamed = o.changed.renamed.filter(([a, b]) => !(a === from && b === to));
  const changed = { ...o.changed, renamed, ...(same ? {} : { removed: [...o.changed.removed, from], added: [...o.changed.added, to] }), was: o.changed.was?.filter((c) => c.name !== from || !same) };
  // A change that was only this rename, now confirmed, is no change left to report.
  if (!changed.renamed.length && !changed.added.length && !changed.removed.length && !changed.retyped.length) { const { changed: _gone, ...rest } = o; return { ...rest, columns }; }
  return { ...o, columns, changed };
}
