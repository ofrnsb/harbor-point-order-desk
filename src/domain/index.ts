// Simpul's agent tools. They are generic over any company: every read goes through the policy planner,
// every write becomes a work item, and every touch of a system is reported to the access trail and the audit log.
import { recentDrift } from "../platform/profile.ts";
import { z } from "zod";
import { defineTool, type Domain, type ToolCtx } from "../lib/domain.ts";
import { serviceRequests } from "../lib/requests.ts";
import { desksOf } from "./desks.ts";
import { orderTools } from "./orders/tools.ts";
import type { Cell, Column, Field, Item, Row, RowsResult, Step } from "../lib/types.ts";
import { epochToLocal, zoneLabel } from "../lib/time.ts";
import { DATE, formatValue, moneyText, MONEY, statusLabel, toneOf } from "../lib/values.ts";
import { record } from "../platform/audit.ts";
import { connectorFor } from "../platform/connectors/index.ts";
import type { AccessTouch, CatalogColumn, Drift, CatalogObject, CompiledAction, Connection, Effective, Filter, WriteResult } from "../platform/contract.ts";
import { currentTenant } from "../platform/org.ts";
import { deniedTouch, needsApproval, planAggregate, planSelect, PolicyError, scopeOf, shapeRows } from "../platform/policy.ts";
import { get, list } from "../platform/store.ts";
import { confirmWorkItem, createWorkItem, queueFor } from "../platform/work.ts";
import { prepareWrite, rehearseWrite } from "../platform/write-guard.ts";
import { guardDifferencing } from "../platform/disclosure.ts";
import { selectScoped } from "../platform/scoped-read.ts";
import { encodingHint } from "../platform/semantics.ts";

const DECODE_SHOWN = 25;
const CHANGE_SHOWN_MS = 30 * 864e5;
import { bucketAlias } from "../platform/connectors/sql.ts";
import { withNames, type NameColumn } from "../platform/names.ts";
import { roleOf, wireObject } from "../platform/wiring.ts";
import { aliasLabel } from "../platform/classify.ts";
import { PROMPT } from "./prompt.ts";
import { makeToolkit } from "./toolkit/index.ts";
import { CORE as T, SHARED } from "../copy/domain.ts";
import { AGG, CELL_JSON_MAX, COL_PATTERNS, FACT_LINE, FILTER_ARGS, ISO_STAMP, ITEM_FIELDS, ITEM_ID_CHARS, ITEM_ID_SAMPLE, NO_DATE_SORT_KEY, POLICY_SEARCH, PROPOSE, QUERY, RECENT_WORK_DAYS, RELATED_OBJECTS, RELATED_ROWS, ROWS_TEXT, TRACE } from "../config/domain.ts";
import { CURRENCY, LOCALE, TIME_ZONE } from "../config/locale.ts";

const requests = serviceRequests((ctx) => desksOf(ctx.eff.tenant.id));

// ---------- helpers ----------
const NAME = COL_PATTERNS.name;
const KEY = COL_PATTERNS.key;

function connectionByCode(eff: Effective, code: string): Connection {
  const c = list("connection", eff.tenant.id).find((x) => x.code.toLowerCase() === code.trim().toLowerCase() || x.id === code);
  if (!c) throw new PolicyError(T.unknownSystem(code), "bad_request");
  return c;
}

function objectFor(eff: Effective, code: string, object: string): { conn: Connection; obj: CatalogObject } {
  const conn = connectionByCode(eff, code);
  const objs = list("catalog", eff.tenant.id).filter((o) => o.connectionId === conn.id);
  const obj = objs.find((o) => o.name === object) ?? objs.find((o) => o.label.toLowerCase() === object.toLowerCase());
  if (!obj || !obj.exposed) throw new PolicyError(T.unknownObject(object, conn.code), "bad_request");
  return { conn, obj };
}

/** Without a name column the muted line carries the record's own facts, e.g. "Annual leave · Mar 12 – Mar 14, 2026 · 3 days". */
function factLine(row: Record<string, unknown>, skip: Set<string>): { text: string; used: string[] } {
  const cols = Object.keys(row).filter((c) => !skip.has(c) && !KEY.test(c) && !COL_PATTERNS.stamp.test(c) && row[c] !== null && row[c] !== "");
  const start = cols.find((c) => COL_PATTERNS.start.test(c));
  const end = cols.find((c) => COL_PATTERNS.end.test(c));
  const days = cols.find((c) => COL_PATTERNS.days.test(c));
  // A measurement reads with its unit ("231,428 mg/Nm³"); without a unit column, bare numbers stay out of the line.
  const unit = cols.find((c) => COL_PATTERNS.unit.test(c) && typeof row[c] === "string");
  const measure = unit ? cols.find((c) => typeof row[c] === "number" && c !== days) : undefined;
  const parts: string[] = [];
  const used: string[] = [];
  if (measure && unit) { parts.push(T.measure(formatValue(measure, row[measure]), String(row[unit]))); used.push(measure, unit); }
  for (const c of cols) {
    if (c === measure || c === unit) continue;
    if (c === start && end) { parts.push(T.range(formatValue(c, row[c]), formatValue(end, row[end]))); used.push(c, end); }
    else if (c === end && start) continue;
    else if (c === days) { parts.push(T.days(formatValue(c, row[c]))); used.push(c); }
    else if (typeof row[c] === "string" && String(row[c]).length <= FACT_LINE.textMax) { parts.push(formatValue(c, row[c])); used.push(c); }
    if (parts.length === FACT_LINE.parts) break;
  }
  return { text: parts.join(T.factSep), used };
}

const label = (obj: CatalogObject, col: string) => obj.columns.find((c) => c.name === col)?.label ?? col;
const keyColumn = (obj: CatalogObject) => obj.primaryKey[0] ?? obj.columns.find((c) => KEY.test(c.name))?.name ?? obj.columns[0]?.name;

/** An auto-numbered row (result 413) is named by what it refers to: "LAB-26-08510 · EM-PART". */
function refTitle(obj: CatalogObject, row: Record<string, unknown>, key: string | undefined): string | null {
  if (!key || obj.columns.find((c) => c.name === key)?.type !== "number") return null;
  const refs = obj.columns.filter((c) => c.fk && row[c.name] !== null && row[c.name] !== undefined && row[c.name] !== "").slice(0, 2);
  return refs.length ? refs.map((c) => String(row[c.name])).join(T.factSep) : null;
}

const cell = (v: unknown, type: Column["type"]): Cell => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (type === "number" && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === "object") return JSON.stringify(v).slice(0, CELL_JSON_MAX);
  return v as Cell;
};

/** Records as lego material: columns with business labels and wiring roles, raw (already masked) cells, and the same rows as items. */
function recordsResult(conn: Connection, obj: CatalogObject, rows: Record<string, unknown>[], title: string, note?: string, named: NameColumn[] = []): Omit<RowsResult, "id"> {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const columns: Column[] = names.map((n) => {
    const nm = named.find((x) => x.name === n);
    if (nm) return { name: n, label: nm.label, type: "text", role: "title" };
    const c = obj.columns.find((x) => x.name === n);
    const role = c ? roleOf(c) : undefined;
    return { name: n, label: c?.label ?? n, type: c?.type ?? "text", ...(role && role !== "other" ? { role } : {}), ...((role === "money" || (c?.type === "number" && MONEY.test(n))) ? { money: true } : {}) };
  });
  const key = keyColumn(obj);
  return {
    kind: "rows", title, source: "live", columns,
    rows: rows.map((r): Row => Object.fromEntries(columns.map((c) => [c.name, cell(r[c.name], c.type)]))),
    items: rows.map((r) => toItem(conn, obj, r)),
    ...(key ? { open: { system: conn.code, object: obj.name, key } } : {}),
    ...(note ? { note } : {}),
  };
}

export function toItem(conn: Connection, obj: CatalogObject, row: Record<string, unknown>): Item {
  const key = keyColumn(obj);
  const keyVal = key ? row[key] : undefined;
  const nameCol = Object.keys(row).find((c) => NAME.test(c));
  const statusCol = Object.keys(row).find((c) => COL_PATTERNS.status.test(c));
  const moneyCol = Object.keys(row).find((c) => COL_PATTERNS.money.test(c) && typeof row[c] !== "string") ?? Object.keys(row).find((c) => COL_PATTERNS.money.test(c));
  const facts = nameCol ? null : factLine(row, new Set([statusCol, moneyCol].filter((c): c is string => !!c)));
  // Fields carry what the title and muted line do not already say.
  const shown = new Set([nameCol, statusCol, moneyCol, ...(nameCol ? [] : [key]), ...(facts?.used ?? [])].filter(Boolean));
  const fields: Field[] = Object.keys(row).filter((c) => !shown.has(c)).slice(0, ITEM_FIELDS).map((c) => ({ label: label(obj, c), value: formatValue(c, row[c]) }));
  const money = moneyCol ? Number(row[moneyCol]) : NaN;
  return {
    id: `${conn.code}:${obj.name}:${String(keyVal ?? JSON.stringify(row).slice(0, ITEM_ID_SAMPLE))}`.replace(/\s+/g, "_").slice(0, ITEM_ID_CHARS),
    title: String((nameCol && row[nameCol]) ?? refTitle(obj, row, key) ?? keyVal ?? obj.label),
    subtitle: nameCol ? `${keyVal !== undefined ? T.keySubtitle(String(keyVal)) : ""}${obj.label}` : facts?.text || obj.label,
    ...(statusCol && row[statusCol] ? { status: { label: statusLabel(String(row[statusCol])), tone: toneOf(String(row[statusCol])) } } : {}),
    fields,
    price: Number.isFinite(money) ? { amount: money, currency: CURRENCY } : null,
    ...(keyVal !== undefined && key ? { action: { label: T.openRelated, message: T.openRelatedMsg(obj.name, String(keyVal), conn.code) } } : {}),
  };
}

const actorOf = (ctx: ToolCtx) => ({ userId: ctx.principal.userId, unitId: ctx.principal.unitId, role: ctx.eff.role });

function deny(ctx: ToolCtx, obj: CatalogObject, err: PolicyError): never {
  // A malformed request (unknown column, bad operator) is not a denial; the agent reads the message and retries.
  if (err.code === "bad_request") throw err;
  ctx.touch({ ...deniedTouch(ctx.eff, obj, err.message), rows: 0, ms: 0 });
  record({ tenantId: ctx.eff.tenant.id, actor: actorOf(ctx), kind: "denied", target: `${obj.connectionId}/${obj.name}`, detail: { code: err.code, reason: err.message, chatId: ctx.chatId } });
  throw err;
}

const DRIFT_SHOWN = 5;
function driftLine(d: Drift): string {
  const n = (v: unknown) => Number(v).toLocaleString(LOCALE);
  const L = T.describe.driftLine;
  switch (d.kind) {
    case "emptied": return L.emptied(n(d.before));
    case "shrank": return L.shrank(n(d.before), n(d.after));
    case "surged": return L.surged(n(d.before), n(d.after));
    case "unfilled": return L.unfilled(d.column ?? "", Number(d.before), Number(d.after));
    case "scale": return L.scale(d.column ?? "", `×${(Number(d.after) / Number(d.before)).toFixed(1)}`);
    case "new_code": return L.new_code(d.column ?? "", String(d.after));
    case "stalled": return L.stalled(d.column ?? "", String(d.after));
  }
}

const STAMP = ISO_STAMP;
/** Instants reach the agent in the company's own time ("2026-11-02 07:00 EST"), so it never quotes UTC to a user. */
export const localTimes = (r: Record<string, unknown>, tz: string) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
  const ms = v instanceof Date ? v.getTime() : typeof v === "string" && STAMP.test(v) ? Date.parse(v) : NaN;
  return [k, Number.isNaN(ms) ? v : `${epochToLocal(ms, tz).replace("T", " ")} ${zoneLabel(tz, ms)}`];
}));
const rowsText = (rows: Record<string, unknown>[], tz: string, max: number = ROWS_TEXT.default) =>
  rows.slice(0, max).map((r) => JSON.stringify(localTimes(r, tz))).join("\n") + (rows.length > max ? T.moreRows(rows.length - max) : "");

const FilterShape = z.object({
  column: z.string().min(1).max(FILTER_ARGS.column),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "between", "is_null", "not_null"]),
  value: z.union([z.string().max(FILTER_ARGS.value), z.number(), z.boolean(), z.array(z.union([z.string().max(FILTER_ARGS.value), z.number()])).max(FILTER_ARGS.values)]).optional(),
});

async function readRows(ctx: ToolCtx, conn: Connection, obj: CatalogObject, req: Parameters<typeof planSelect>[2], o: { names?: boolean } = {}) {
  let res;
  try { res = await selectScoped(ctx.eff, obj, req, { external: ctx.external }); }
  catch (e) { if (e instanceof PolicyError) deny(ctx, obj, e); throw e; }
  const plan = res.plan;
  const shaped = shapeRows(res.rows, plan.masks, ctx.eff.tenant.id);
  const touch: AccessTouch = ctx.touch({ ...plan.touch, rows: shaped.length, ms: res.ms });
  record({ tenantId: ctx.eff.tenant.id, actor: actorOf(ctx), kind: "query", target: `${conn.code}/${obj.name}`, detail: { statement: res.statement, filters: plan.query.filters, rows: shaped.length, masked: touch.masked, hashed: touch.hashed, chatId: ctx.chatId } });
  // Codes that point at a named record read as names: each lookup is scoped, touched and audited like this read.
  const named = o.names === false ? { rows: shaped, added: [] } : await withNames(ctx.eff, obj, shaped, ctx.external, (r) => {
    ctx.touch({ ...r.touch, rows: r.rows, ms: r.ms });
    record({ tenantId: ctx.eff.tenant.id, actor: actorOf(ctx), kind: "query", target: `${get("connection", r.target.connectionId)?.code ?? r.target.connectionId}/${r.target.name}`, detail: { statement: r.statement, rows: r.rows, chatId: ctx.chatId } });
  });
  return { rows: named.rows, total: res.total, touch, names: named.added };
}

// ---------- tools ----------
const listSources = defineTool({
  name: "list_sources",
  category: "data",
  description: T.listSources.description,
  shape: {},
  label: () => ({ running: T.listSources.running, done: T.listSources.running }),
  run: async (_args, ctx) => {
    const conns = list("connection", ctx.eff.tenant.id);
    const catalog = list("catalog", ctx.eff.tenant.id);
    const lines: string[] = [];
    for (const c of conns) {
      const objs = ctx.eff.data[c.id];
      if (!objs) continue;
      lines.push(T.listSources.system(c.code, c.kind, c.name) + (c.status === "error" ? T.listSources.unavailable(c.statusNote) : ""));
      for (const name of Object.keys(objs)) {
        const o = catalog.find((x) => x.connectionId === c.id && x.name === name);
        lines.push(T.listSources.object(name, o?.label ?? name, (o?.rowEstimate ?? 0).toLocaleString(LOCALE), o?.description, objs[name].rowFilters.map((r) => T.listSources.filter(r.column, Array.isArray(r.value) ? r.value.join(T.listSources.valueSep) : String(r.value))).join(T.listSources.filterSep))
          + (recentDrift(c.id, name).length ? T.listSources.dataChanged : ""));
      }
    }
    const out = conns.filter((c) => !ctx.eff.data[c.id]).map((c) => T.listSources.out(c.code, c.name) + (c.status === "error" ? T.listSources.unavailable("") : ""));
    return `${lines.join("\n") || T.listSources.none}${out.length ? T.listSources.outOfScope(ctx.eff.unit.name, out.join(T.listSources.outSep)) : ""}`;
  },
});

const VIEW_BLOCK: Record<string, string> = T.viewBlocks;
/** Which lego blocks fit this object, from its column roles, limited to the columns this user may see. */
function viewHint(obj: CatalogObject, visible: Record<string, string>): string {
  const views = wireObject(obj).views.filter((v) => VIEW_BLOCK[v.kind] && Object.values(v.binds).flatMap((b) => b.split(",")).every((c) => visible[c] && visible[c] !== "deny"));
  if (!views.length) return "";
  return T.viewHint(views.map((v) => T.view(VIEW_BLOCK[v.kind], Object.entries(v.binds).map(([k, c]) => T.viewBind(k, c)).join(", "))).join("; "));
}

const describeObject = defineTool({
  name: "describe_object",
  category: "data",
  description: T.describe.description,
  shape: { system: z.string().min(1).max(QUERY.system).describe(T.describe.system), object: z.string().min(1).max(QUERY.object) },
  label: (i) => ({ running: T.describe.running(String(i.system), String(i.object)), done: T.describe.running(String(i.system), String(i.object)) }),
  run: async ({ system, object }, ctx) => {
    const { conn, obj } = objectFor(ctx.eff, system, object);
    const scope = ctx.eff.data[conn.id]?.[obj.name];
    if (!scope) deny(ctx, obj, new PolicyError(T.describe.outOfScope(obj.label, ctx.eff.unit.name), "out_of_scope"));
    const note = T.describe.modes;
    // Relations and data changes are told only between objects this team may read.
    const visible = (connectionId: string, name: string) => !!ctx.eff.data[connectionId]?.[name];
    const codeOf = (id: string) => get("connection", id)?.code ?? id;
    const catalog = list("catalog", ctx.eff.tenant.id);
    const pointedFrom = catalog.flatMap((o) => (visible(o.connectionId, o.name) ? o.columns.filter((c) => c.link?.connectionId === conn.id && c.link.object === obj.name).map((c) => `${codeOf(o.connectionId)}.${o.name}.${c.name}`) : []));
    const drift = recentDrift(conn.id, obj.name).filter((d) => !d.column || scope.columns[d.column]).slice(0, DRIFT_SHOWN).map((d) => driftLine(d));
    const cols = obj.columns.filter((c) => scope.columns[c.name]).map((c) => {
      let mode = scope.columns[c.name];
      if (ctx.external && c.sensitivity === "restricted" && mode === "show") mode = "mask";
      const notes = [
        ...(c.encoding ? [T.describe.encoding(encodingHint(c.encoding))] : []),
        ...(c.minorUnits ? [T.describe.unit(c.minorUnits)] : c.unitHint ? [T.describe.unitHint(c.unitHint)] : []),
        ...(c.decode && mode === "show" ? [T.describe.decode(c.decode.object, c.decode.meanings.slice(0, DECODE_SHOWN).map(([k, v]) => `${k}=${v}`).join(", "), Math.max(0, c.decode.meanings.length - DECODE_SHOWN))] : []),
        ...(c.link ? [T.describe.link(`${get("connection", c.link.connectionId)?.code ?? c.link.connectionId}.${c.link.object}.${c.link.column}`, c.link.overlap)] : []),
      ];
      return T.describe.column(c.name, c.type, c.label, !!c.pk, c.fk ? `${c.fk.object}.${c.fk.column}` : null, mode !== "show" ? note[mode] : null, c.description, notes);
    });
    const actions = list("action", ctx.eff.tenant.id).filter((a) => a.connectionId === conn.id && a.object === obj.name && ctx.eff.actions.includes(a.id));
    return [
      T.describe.head(conn.code, obj.name, obj.label, obj.kind, obj.rowEstimate.toLocaleString(LOCALE), obj.description),
      obj.unionOf ? T.describe.family(obj.unionOf.join(", ")) : "",
      obj.history ? T.describe.history(obj.history.from, obj.history.to, obj.history.current) : "",
      obj.codeTable ? T.describe.codeTable(obj.codeTable.value, obj.codeTable.desc) : "",
      pointedFrom.length ? T.describe.pointedFrom(pointedFrom.slice(0, DRIFT_SHOWN * 2).join(", ")) : "",
      drift.length ? T.describe.drift(drift.join("; ")) : "",
      obj.changed && Date.now() - Date.parse(obj.changed.at) < CHANGE_SHOWN_MS ? T.describe.changed(formatValue("at", obj.changed.at),
        [...(["added", "removed", "retyped"] as const).filter((k) => obj.changed![k].length).map((k) => `${T.describe.changeParts[k]} ${obj.changed![k].join(", ")}`),
          ...(obj.changed.renamed.length ? [`${T.describe.changeParts.renamed} ${obj.changed.renamed.map(([a, b]) => `${a} → ${b}`).join(", ")}`] : [])].join("; ")) : "",
      ...cols,
      scope.rowFilters.length ? T.describe.filters(scope.rowFilters.map((r) => T.describe.filter(r.column, Array.isArray(r.value) ? r.value.join(T.describe.valueSep) : String(r.value))).join(T.describe.filterSep)) : T.describe.noFilters,
      actions.length ? T.describe.actions(actions.map((a) => T.describe.action(a.id, a.name)).join(T.describe.valueSep)) : "",
      viewHint(obj, scope.columns),
    ].filter(Boolean).join("\n");
  },
});

const queryRecords = defineTool({
  name: "query_records",
  category: "data",
  description: T.query.description(QUERY.limit),
  shape: {
    system: z.string().min(1).max(QUERY.system), object: z.string().min(1).max(QUERY.object),
    columns: z.array(z.string().max(FILTER_ARGS.column)).max(QUERY.columns).optional().describe(T.query.columns),
    filters: z.array(FilterShape).max(QUERY.filters).optional(),
    sort: z.object({ column: z.string().max(FILTER_ARGS.column), dir: z.enum(["asc", "desc"]) }).optional(),
    limit: z.number().int().min(1).max(QUERY.limit).optional(), offset: z.number().int().min(0).max(QUERY.offset).optional(),
    title: z.string().max(QUERY.title).optional().describe(T.query.title),
  },
  label: (i) => ({ running: T.query.running(String(i.system), String(i.object)), done: T.query.running(String(i.system), String(i.object)) }),
  run: async ({ system, object, columns, filters, sort, limit, offset, title }, ctx) => {
    const { conn, obj } = objectFor(ctx.eff, system, object);
    const { rows, total, touch, names } = await readRows(ctx, conn, obj, { columns, filters: filters as Filter[] | undefined, sort, limit, offset });
    const saved = ctx.save(recordsResult(conn, obj, rows, title ?? T.query.blockTitle(obj.label, conn.code), touch.scope.length ? T.query.only(touch.scope.join(T.query.sep)) : undefined, names));
    return `${T.query.result(saved.id, rows.length, total, conn.code, obj.name)}${touch.scope.length ? T.query.scope(touch.scope.join(T.query.sep)) : ""}${touch.masked.length ? T.query.masked(touch.masked.join(T.query.sep)) : ""}${touch.hashed.length ? T.query.hashed(touch.hashed.join(T.query.sep)) : ""}\n${rowsText(rows, ctx.eff.tenant.timezone)}`;
  },
});

const getRecord = defineTool({
  name: "get_record",
  category: "data",
  description: T.get.description,
  shape: { system: z.string().min(1).max(QUERY.system), object: z.string().min(1).max(QUERY.object), key: z.union([z.string().min(1).max(QUERY.key), z.number()]) },
  label: (i) => ({ running: T.get.running(String(i.key)), done: T.get.running(String(i.key)) }),
  run: async ({ system, object, key }, ctx) => {
    const { conn, obj } = objectFor(ctx.eff, system, object);
    const kc = keyColumn(obj);
    if (!kc) throw new PolicyError(T.get.noKey(obj.label), "bad_request");
    const main = await readRows(ctx, conn, obj, { filters: [{ column: kc, op: "eq", value: key }], limit: 1 });
    if (!main.rows.length) return T.get.none(obj.label, kc, String(key), ctx.eff.unit.name);
    const out = [T.get.main(ctx.save(recordsResult(conn, obj, main.rows, T.get.title(obj.label, String(key)), undefined, main.names)).id, conn.code, obj.name, rowsText(main.rows, ctx.eff.tenant.timezone))];
    const conns = list("connection", ctx.eff.tenant.id);
    // Related records: same-named ids, declared foreign keys, and ids learned to point here under another name.
    const pointsHere = (c: CatalogColumn) => c.name === kc || (c.fk?.object === obj.name && c.fk.column === kc) || (c.link?.connectionId === obj.connectionId && c.link.object === obj.name && c.link.column === kc);
    const catalog = list("catalog", ctx.eff.tenant.id);
    // A period family stands for its member tables, so a record's history is read once, across all periods.
    const members = new Set(catalog.flatMap((o) => (o.unionOf ?? []).map((m) => `${o.connectionId}/${m}`)));
    const related = catalog.filter((o) => o.exposed && !members.has(`${o.connectionId}/${o.name}`) && !(o.connectionId === obj.connectionId && o.name === obj.name) && o.columns.some(pointsHere)).slice(0, RELATED_OBJECTS);
    for (const r of related) {
      const rc = conns.find((c) => c.id === r.connectionId);
      if (!rc) continue;
      const col = r.columns.find(pointsHere)!.name;
      try {
        const res = await readRows(ctx, rc, r, { filters: [{ column: col, op: "eq", value: key }], limit: RELATED_ROWS }, { names: false });
        if (res.rows.length) out.push(T.get.related(ctx.save(recordsResult(rc, r, res.rows, T.get.relatedTitle(r.label, String(key)))).id, rc.code, r.name, res.rows.length, rowsText(res.rows, ctx.eff.tenant.timezone, ROWS_TEXT.related)));
      } catch (e) {
        if (e instanceof PolicyError) out.push(T.get.denied(rc.code, r.name, e.message));
        else throw e;
      }
    }
    return out.join("\n\n");
  },
});

const aggregateRecords = defineTool({
  name: "aggregate_records",
  category: "data",
  description: T.aggregate.description,
  shape: {
    system: z.string().min(1).max(QUERY.system), object: z.string().min(1).max(QUERY.object),
    metrics: z.array(z.object({ fn: z.enum(["count", "sum", "avg", "min", "max"]), column: z.string().max(FILTER_ARGS.column).optional(), as: z.string().max(AGG.as).optional() })).min(1).max(AGG.metrics),
    group_by: z.array(z.string().max(FILTER_ARGS.column)).max(AGG.groupBy).optional(),
    bucket: z.object({ column: z.string().max(FILTER_ARGS.column), unit: z.enum(["day", "week", "month"]) }).optional(),
    filters: z.array(FilterShape).max(QUERY.filters).optional(),
    sort: z.object({ column: z.string().max(FILTER_ARGS.column), dir: z.enum(["asc", "desc"]) }).optional(),
    limit: z.number().int().min(1).max(AGG.limit).optional(),
    lookups: z.array(z.object({
      as: z.string().max(AGG.as), system: z.string().max(QUERY.system).optional(), object: z.string().max(QUERY.object),
      child_column: z.string().max(FILTER_ARGS.column), parent_column: z.string().max(FILTER_ARGS.column).optional(),
      fn: z.enum(["count", "sum", "avg", "min", "max"]), column: z.string().max(FILTER_ARGS.column).optional(),
      filters: z.array(FilterShape).max(QUERY.filters).optional(),
    })).max(AGG.lookups).optional().describe(T.aggregate.lookups),
    computed: z.array(z.object({ as: z.string().max(AGG.as), left: z.string().max(FILTER_ARGS.column), op: z.enum(["+", "-", "*", "/"]), right: z.string().max(FILTER_ARGS.column) })).max(AGG.computed).optional().describe(T.aggregate.computed),
    title: z.string().max(QUERY.title).optional(),
  },
  label: (i) => ({ running: T.aggregate.running(String(i.system), String(i.object)), done: T.aggregate.running(String(i.system), String(i.object)) }),
  run: async ({ system, object, metrics, group_by, bucket, filters, sort, limit, lookups, computed, title }, ctx) => {
    const { conn, obj } = objectFor(ctx.eff, system, object);
    let plan;
    try { plan = planAggregate(ctx.eff, obj, { metrics, groupBy: group_by, bucket, filters: filters as Filter[] | undefined, sort, limit, lookups: lookups?.map((l) => ({ ...l, filters: l.filters as Filter[] | undefined })), computed }, { external: ctx.external }); }
    catch (e) { if (e instanceof PolicyError) deny(ctx, obj, e); throw e; }
    const res = await connectorFor(conn, "read").aggregate(plan.query);
    const rows = shapeRows(res.rows, {}, ctx.eff.tenant.id);
    const b = plan.query.bucket;
    try { guardDifferencing(ctx.eff, obj, plan.touch.aggregated ?? [], plan.query.filters, plan.query.groupBy, b ? { ...b, alias: bucketAlias(b) } : undefined, res.rows, plan.query.minGroupSize); }
    catch (e) { if (e instanceof PolicyError) deny(ctx, obj, e); throw e; }
    const touch = ctx.touch({ ...plan.touch, rows: rows.length, ms: res.ms });
    record({ tenantId: ctx.eff.tenant.id, actor: actorOf(ctx), kind: "aggregate", target: `${conn.code}/${obj.name}`, detail: { statement: res.statement, filters: plan.query.filters, groups: rows.length, aggregated: touch.aggregated, chatId: ctx.chatId } });
    const ms = plan.query.metrics;
    const fmt = (m: (typeof ms)[number], v: unknown) => (v === null || v === undefined ? SHARED.empty : m.column && MONEY.test(m.column) && m.fn !== "count" ? moneyText(Number(v)) : Number(v).toLocaleString(LOCALE, { maximumFractionDigits: AGG.decimals }));
    const heading = title ?? T.query.blockTitle(obj.label, conn.code);
    // Totals, groups and periods are all rows, so the agent composes them into figures, a chart or a table.
    const groupCols = [...plan.query.groupBy, ...(plan.query.bucket ? [bucketAlias(plan.query.bucket)] : [])];
    const columns: Column[] = [
      ...plan.query.groupBy.map((g): Column => {
        const c = obj.columns.find((x) => x.name === g);
        const role = c ? roleOf(c) : undefined;
        return { name: g, label: label(obj, g), type: c?.type ?? "text", ...(role && role !== "other" ? { role } : {}) };
      }),
      ...(plan.query.bucket ? [{ name: bucketAlias(plan.query.bucket), label: T.aggregate.per[plan.query.bucket.unit], type: "date" as const, role: "date" }] : []),
      ...ms.map((m): Column => ({ name: m.as, label: aliasLabel(m.as), type: "number", ...(m.column && MONEY.test(m.column) && m.fn !== "count" ? { money: true } : {}) })),
    ];
    const sorted = plan.query.bucket ? [...rows].sort((a, b) => String(a[bucketAlias(plan.query.bucket!)]).localeCompare(String(b[bucketAlias(plan.query.bucket!)]))) : rows;
    const ref = ctx.save({
      kind: "rows", title: heading, source: "live", columns,
      rows: sorted.map((r): Row => Object.fromEntries(columns.map((c) => [c.name, cell(r[c.name], c.type)]))),
      items: sorted.map((r, i) => ({
        id: `${conn.code}:${obj.name}:g${i}:${groupCols.map((g) => String(r[g])).join("|")}`.slice(0, ITEM_ID_CHARS),
        title: groupCols.map((g) => formatValue(g, r[g])).join(T.factSep) || T.aggregate.all,
        fields: ms.map((m) => ({ label: aliasLabel(m.as), value: fmt(m, r[m.as]) })),
        price: null,
      })),
      ...(plan.query.minGroupSize > 1 ? { note: T.aggregate.hiddenNote(plan.query.minGroupSize) } : {}),
    }).id;
    return `${T.aggregate.result(ref, rows.length, conn.code, obj.name)}${touch.scope.length ? T.query.scope(touch.scope.join(T.query.sep)) : ""}${plan.query.minGroupSize > 1 ? T.aggregate.hidden(plan.query.minGroupSize) : ""}\n${rowsText(rows, ctx.eff.tenant.timezone, ROWS_TEXT.aggregate)}`;
  },
});

const traceProcess = defineTool({
  name: "trace_process",
  category: "data",
  description: T.trace.description,
  shape: { value: z.string().min(TRACE.value.min).max(TRACE.value.max).describe(T.trace.value), title: z.string().max(QUERY.title).optional() },
  label: (i) => ({ running: T.trace.running(String(i.value)), done: T.trace.running(String(i.value)) }),
  run: async ({ value, title }, ctx) => {
    const conns = list("connection", ctx.eff.tenant.id);
    const catalog = list("catalog", ctx.eff.tenant.id).filter((o) => o.exposed);
    const freq = new Map<string, number>();
    for (const o of catalog) for (const c of o.columns) if (KEY.test(c.name)) freq.set(c.name, (freq.get(c.name) ?? 0) + 1);
    const joinCols = new Set([...freq].filter(([, n]) => n >= TRACE.joinMin).map(([k]) => k));
    type Hit = { conn: Connection; obj: CatalogObject; row: Record<string, unknown> };
    const hits: Hit[] = [];
    const lines: string[] = [];
    const seen = new Set<string>();
    let budget: number = TRACE.budget;
    const probe = async (val: unknown, onlyCols?: Set<string>) => {
      for (const o of catalog) {
        for (const c of o.columns) {
          if (budget <= 0) return;
          if (!(c.pk || joinCols.has(c.name)) || (onlyCols && !onlyCols.has(c.name)) || c.type !== "text") continue;
          const k = `${o.connectionId}/${o.name}/${c.name}/${String(val)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const conn = conns.find((x) => x.id === o.connectionId);
          if (!conn) continue;
          if (!ctx.eff.data[conn.id]?.[o.name]) {
            if (c.pk) continue;
            ctx.touch({ ...deniedTouch(ctx.eff, o, T.trace.denied(o.label, ctx.eff.unit.name)), rows: 0, ms: 0 });
            lines.push(T.trace.outLine(conn.code, o.name));
            continue;
          }
          budget--;
          try {
            const r = await readRows(ctx, conn, o, { filters: [{ column: c.name, op: "eq", value: val }], limit: TRACE.rowsPerProbe }, { names: false });
            for (const row of r.rows) hits.push({ conn, obj: o, row });
          } catch (e) { if (!(e instanceof PolicyError)) throw e; }
        }
      }
    };
    await probe(value);
    const firstHop = [...hits];
    for (const h of firstHop) for (const col of joinCols) {
      const v = h.row[col];
      if (typeof v === "string" && v !== value && !T.trace.protectedPrefixes.some((p) => v.startsWith(p))) await probe(v, new Set([col]));
    }
    if (!hits.length) return T.trace.none(value, ctx.eff.unit.name, lines.join(T.trace.lineSep));
    const dateOf = (h: Hit) => { const c = Object.keys(h.row).find((k) => DATE.test(k) && h.row[k]); return c ? String(h.row[c]) : null; };
    const unique = hits.filter((h, i) => hits.findIndex((x) => x.obj.name === h.obj.name && x.conn.id === h.conn.id && JSON.stringify(x.row) === JSON.stringify(h.row)) === i);
    unique.sort((a, b) => (dateOf(a) ?? NO_DATE_SORT_KEY).localeCompare(dateOf(b) ?? NO_DATE_SORT_KEY));
    const steps: Step[] = unique.map((h, i) => {
      const status = String(h.row.status ?? "");
      const tone = toneOf(status);
      const kc = keyColumn(h.obj);
      return {
        label: T.trace.stepLabel(h.obj.label, kc && h.row[kc] ? String(h.row[kc]) : null),
        at: dateOf(h),
        state: tone === "bad" ? "failed" : i === unique.length - 1 && tone !== "good" ? "current" : "done",
        owner: h.conn.name,
        note: status || undefined,
      };
    });
    const C = T.trace.columns;
    const columns: Column[] = [
      { name: "step", label: C.step, type: "text", role: "title" }, { name: "at", label: C.at, type: "date", role: "date" },
      { name: "state", label: C.state, type: "text", role: "status" }, { name: "system", label: C.system, type: "text", role: "category" }, { name: "note", label: C.note, type: "text" },
    ];
    const rows: Row[] = steps.map((st) => ({ step: st.label, at: st.at, state: st.state, system: st.owner ?? null, note: st.note ?? null }));
    const ref = ctx.save<RowsResult>({ kind: "rows", title: title ?? T.trace.title(value), columns, rows, items: [], source: "live" }).id;
    return `${T.trace.result(ref, unique.length, [...new Set(unique.map((h) => h.conn.code))].join(T.trace.systemSep), lines.join(T.trace.lineSep))}\n${unique.map((h) => T.trace.hitLine(h.conn.code, h.obj.name, JSON.stringify(h.row))).join("\n").slice(0, TRACE.outChars)}`;
  },
});

/** A column as people name it: its catalog label, else its own name. */
const columnLabel = (connectionId: string, object: string, column: string) => get("catalog", `${connectionId}/${object}`)?.columns.find((c) => c.name === column)?.label || column;

function previewFields(eff: Effective, connectionId: string, object: string, r: WriteResult, a: CompiledAction): Field[] {
  const rehearsed = { label: T.propose.rehearsal, value: T.propose.rehearsed };
  if (!r.before) return [rehearsed];
  // The old value is shown only where this user may read the column; otherwise only the new value they chose.
  const readable = scopeOf(eff, connectionId, object)?.columns ?? {};
  const changed = Object.keys(a.values).filter((c) => JSON.stringify(r.before?.[c] ?? null) !== JSON.stringify(r.after?.[c] ?? null));
  return [rehearsed, ...changed.map((c) => ({ label: columnLabel(connectionId, object, c), value: T.propose.change(readable[c] === "show" ? formatValue(c, r.before?.[c], { full: true }) : SHARED.empty, formatValue(c, a.values[c], { full: true })) }))];
}

const proposeAction = defineTool({
  name: "propose_action",
  category: "actions",
  description: T.propose.description,
  shape: {
    template_id: z.string().min(1).max(PROPOSE.templateId),
    params: z.record(z.string(), z.union([z.string().max(PROPOSE.param), z.number(), z.boolean()])),
    key: z.union([z.string().max(PROPOSE.key), z.number()]).optional().describe(T.propose.key),
  },
  label: (i) => ({ running: T.propose.running(String(i.template_id)), done: T.propose.running(String(i.template_id)) }),
  run: async ({ template_id, params, key }, ctx) => {
    const eff = ctx.eff;
    const t = get("action", template_id);
    if (!t || t.tenantId !== eff.tenant.id || !eff.actions.includes(t.id)) throw new PolicyError(T.propose.notAllowed(template_id, eff.unit.name), "out_of_scope");
    if (!eff.can.propose) throw new PolicyError(T.propose.readOnly(eff.role, eff.unit.name), "out_of_scope");
    const conn = get("connection", t.connectionId);
    if (!conn?.writeSecret) throw new Error(T.propose.noWrite(conn?.code ?? t.connectionId));
    if (t.op === "update" && (key === undefined || key === "")) throw new PolicyError(T.propose.needKey(t.name, t.keyColumn), "bad_request");
    const { compiled, facts } = await prepareWrite(eff, t, params, key);
    const rehearsal = await rehearseWrite(eff, t, conn, compiled);
    const amount = t.amountField && params[t.amountField] !== undefined ? Number(params[t.amountField]) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new PolicyError(T.propose.badAmount(t.amountField), "bad_request");
    const approval = needsApproval(eff, t.risk, amount);
    const summary: Field[] = [
      ...(key !== undefined ? [{ label: t.keyColumn ? columnLabel(conn.id, t.object, t.keyColumn) : T.propose.keyLabel, value: String(key) }] : []),
      ...t.fields.filter((f) => f.fixed === undefined && compiled.values[f.column] !== undefined).map((f) => ({ label: f.label, value: formatValue(f.column, compiled.values[f.column], { full: true }) })),
      ...facts.map((f) => ({ label: T.propose.linked(f.label, f.value), value: f.fields.map((x) => `${x.label} ${x.value}`).join(T.factSep) || f.value })),
      ...previewFields(eff, conn.id, t.object, rehearsal, compiled),
      { label: T.propose.system, value: T.propose.systemValue(conn.code, t.object) },
      { label: T.propose.approval, value: approval ? (t.risk === "high" ? T.propose.highRisk : T.propose.overLimit(moneyText(eff.approvalOver))) : T.propose.direct },
    ];
    const action = await ctx.propose({
      type: "governed_action", payload: { templateId: t.id }, title: t.name, summary,
      consequence: T.propose.consequence(conn.code, t.object, t.op, eff.user.name, eff.unit.name, approval),
      danger: t.risk === "high",
    });
    const work = createWorkItem({ tenantId: eff.tenant.id, templateId: t.id, title: t.name, chatId: ctx.chatId, actionId: action.id, requestedBy: eff.user.id, unitId: eff.unit.id, params, key, amount: amount, needsApproval: approval, summary, preview: { before: rehearsal.before, after: rehearsal.after } }, t.receiptPrefix);
    record({ tenantId: eff.tenant.id, actor: actorOf(ctx), kind: "propose", target: work.ref, detail: { templateId: t.id, amount: amount, needsApproval: approval, chatId: ctx.chatId } });
    return T.propose.result(action.id, work.ref, approval);
  },
});

const myWork = defineTool({
  name: "my_work",
  category: "work",
  description: T.myWork.description(RECENT_WORK_DAYS),
  shape: {},
  label: () => ({ running: T.myWork.running, done: T.myWork.running }),
  run: async (_args, ctx) => {
    const q = queueFor(ctx.principal.userId, ctx.principal.unitId);
    const all = [...q.awaitingMe.map((w) => ({ w, why: T.myWork.awaitingMe as string })), ...q.mine.map((w) => ({ w, why: T.myWork.mine as string })), ...q.recent.map((w) => ({ w, why: T.myWork.recent as string }))];
    // The queue as rows: the decide brick reads work_id, so an approver decides in place.
    const C = T.myWork.columns;
    const columns: Column[] = [
      { name: "work_id", label: C.workId, type: "text", role: "key" }, { name: "ref", label: C.ref, type: "text" },
      { name: "title", label: C.title, type: "text", role: "title" }, { name: "why", label: C.why, type: "text", role: "category" },
      { name: "state", label: C.state, type: "text", role: "status" }, { name: "amount", label: C.amount, type: "number", money: true },
      { name: "requested_by", label: T.myWork.fields.by, type: "text" }, { name: "system", label: T.myWork.fields.system, type: "text" },
      { name: "updated_at", label: C.updated, type: "date" },
      { name: "details", label: C.details, type: "text" },
    ];
    // The state is the stable code (awaiting_approval), the same one the text lines carry, so a view filtering on it
    // finds the rows; the screen turns codes into words when it shows them.
    const rows: Row[] = all.map(({ w, why }) => ({ work_id: w.id, ref: w.ref, title: w.title, why, state: w.state, amount: w.amount, requested_by: w.requestedByName, system: w.system, updated_at: w.updatedAt,
      details: (w.summary ?? []).filter((f) => f.label !== T.propose.system && f.label !== T.propose.approval).map((f) => `${f.label}: ${f.value}`).join(" · ") }));
    const ref = ctx.save<RowsResult>({ kind: "rows", title: T.myWork.title, columns, rows, items: [], source: "live" }).id;
    return `${T.myWork.result(ref, q.awaitingMe.length, q.mine.length, q.recent.length)}\n${all.map(({ w, why }) => `work_id=${w.id} ${T.myWork.line(w.ref, w.title, w.state, why, w.amount !== null ? moneyText(w.amount) : null)}${w.summary?.length ? ` [${w.summary.map((f) => `${f.label}: ${f.value}`).join("; ")}]` : ""}`).join("\n")}`;
  },
});

const searchPolicies = defineTool({
  name: "search_policies",
  category: "policy",
  description: T.policies.description,
  shape: { query: z.string().min(POLICY_SEARCH.query.min).max(POLICY_SEARCH.query.max) },
  label: (i) => ({ running: T.policies.running(String(i.query)), done: T.policies.running(String(i.query)) }),
  run: async ({ query }, ctx) => {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= POLICY_SEARCH.wordMin);
    const hit = (s: string) => words.some((w) => s.toLowerCase().includes(w));
    const actions = list("action", ctx.eff.tenant.id).filter((a) => ctx.eff.actions.includes(a.id));
    const lines = [
      ...ctx.eff.rules.filter((r) => hit(r.text)).map((r) => T.policies.rule(r.unit, r.locked, r.text)),
      ...ctx.eff.glossary.filter((g) => hit(`${g.term} ${g.meaning}`)).map((g) => T.policies.term(g.unit, g.term, g.meaning)),
      ...ctx.eff.context.filter((c) => hit(c.description)).map((c) => T.policies.context(c.unit, c.description)),
      ...actions.filter((a) => hit(`${a.name} ${a.description}`)).map((a) => T.policies.action(a.id, a.name, a.description, a.owner, a.risk)),
    ];
    return lines.length ? lines.slice(0, POLICY_SEARCH.lines).join("\n") : T.policies.none(query, ctx.eff.unit.name);
  },
});

const toolkit = makeToolkit({
  objectFor: (ctx, system, object) => objectFor(ctx.eff, system, object),
  readRows: async (ctx, conn, obj, req) => { const r = await readRows(ctx, conn, obj, req, { names: false }); return { rows: r.rows, total: r.total }; },
  recordsResult, toItem, rowsText,
});

export const domain: Domain = {
  agentName: T.agentName,
  timezone: TIME_ZONE,
  prompt: PROMPT,
  tools: [listSources, describeObject, queryRecords, getRecord, aggregateRecords, traceProcess, ...orderTools, proposeAction, myWork, searchPolicies, requests.tool, ...toolkit.tools],
  actions: {
    ...toolkit.actions,
    governed_action: (a) => confirmWorkItem(currentTenant().id, a.id),
    service_request: requests.action,
  },
  panel: async () => ({ ...T.panel, items: [] }),
};

