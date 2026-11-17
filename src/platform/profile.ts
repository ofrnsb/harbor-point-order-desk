// The estate's fingerprints. After each introspection every object gets a small snapshot of what its data looks like:
// row count, the share of empty values per column, averages of numbers, date bounds, and how often each code appears.
// No row is ever kept, so a snapshot can sit in the platform store whatever the data holds. Comparing a snapshot with
// the ones before it shows what a schema diff cannot: a table emptied or swollen, a column nobody fills any more, money
// that changed scale (a unit switched to cents), a code the code table does not know, a feed that stopped arriving.
import type { CatalogColumn, CatalogObject, Connection, DataProfile, Drift, ProfileSnapshot } from "./contract.ts";
import { connectorFor } from "./connectors/index.ts";
import { get, list, put } from "./store.ts";
import { record } from "./audit.ts";
import { PROFILE } from "../config/server.ts";

const quiet = (c: CatalogColumn) => c.sensitivity === "restricted" || c.sensitivity === "confidential";
const p2 = (n: number) => String(n).padStart(2, "0");

/** A legacy encoded date as YYYY-MM-DD (or YYYY-MM), so a numeric TXN_DT shows freshness like a real date column. */
export function decodeEncoded(enc: CatalogColumn["encoding"], raw: unknown): string | null {
  const n = Number(raw);
  if (!enc || !Number.isInteger(n) || n <= 0) return null;
  const julian = (y: number, doy: number) => { const d = new Date(Date.UTC(y, 0, doy)); return d.getUTCFullYear() === y ? d.toISOString().slice(0, 10) : null; };
  switch (enc) {
    case "yyyymmdd": { const y = Math.floor(n / 1e4), m = Math.floor(n / 100) % 100, d = n % 100; return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${p2(m)}-${p2(d)}` : null; }
    case "yyyymm": { const y = Math.floor(n / 100), m = n % 100; return m >= 1 && m <= 12 ? `${y}-${p2(m)}` : null; }
    case "julian_cyyddd": return julian(1900 + Math.floor(n / 1e5) * 100 + (Math.floor(n / 1000) % 100), n % 1000);
    case "julian_yyddd": { const yy = Math.floor(n / 1000); return julian(yy < 50 ? 2000 + yy : 1900 + yy, n % 1000); }
    case "julian_yyyyddd": return julian(Math.floor(n / 1000), n % 1000);
    default: return null;
  }
}

const isDateCol = (c: CatalogColumn) => c.type === "date" || (!!c.encoding && c.encoding !== "hhmmss");
const asDate = (c: CatalogColumn, v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (c.type === "date") { const t = Date.parse(String(v)); return Number.isNaN(t) ? null : new Date(t).toISOString(); }
  return decodeEncoded(c.encoding, v);
};

/** The columns worth a fingerprint, dates and numbers first: what drift is found in. */
function columnsOf(o: CatalogObject): CatalogColumn[] {
  const usable = o.columns.filter((c) => !c.virtual && c.type !== "json");
  const rank = (c: CatalogColumn) => (isDateCol(c) ? 0 : c.type === "number" ? 1 : c.decode ? 2 : 3);
  return [...usable].sort((a, b) => rank(a) - rank(b)).slice(0, PROFILE.columns);
}

/** Takes one snapshot of an object with the connection's read credential. Large tables keep to the database's statistics. */
export async function snapshotOf(conn: Connection, o: CatalogObject, tallied: Set<string> = new Set()): Promise<ProfileSnapshot> {
  const at = new Date().toISOString();
  if (o.rowEstimate > PROFILE.scanRowsMax) return { at, rows: o.rowEstimate, rowsFrom: "estimate", cols: {} };
  const reader = connectorFor(conn, "read");
  const cols = columnsOf(o);
  const metrics: { fn: "count" | "avg" | "min" | "max"; column?: string; as: string }[] = [{ fn: "count", as: "rows" }];
  cols.forEach((c, i) => {
    metrics.push({ fn: "count", column: c.name, as: `n${i}` });
    if (quiet(c)) return;
    if (c.type === "number" && !c.encoding) metrics.push({ fn: "avg", column: c.name, as: `a${i}` });
    if (isDateCol(c)) metrics.push({ fn: "min", column: c.name, as: `lo${i}` }, { fn: "max", column: c.name, as: `hi${i}` });
  });
  const r = (await reader.aggregate({ kind: "aggregate", object: o, metrics, groupBy: [], filters: [], minGroupSize: 1, limit: 1 })).rows[0] ?? {};
  const rows = Number(r.rows ?? 0);
  const out: ProfileSnapshot = { at, rows, rowsFrom: "count", cols: {} };
  cols.forEach((c, i) => {
    const stat: ProfileSnapshot["cols"][string] = { nulls: rows - Number(r[`n${i}`] ?? 0) };
    if (r[`a${i}`] !== undefined && r[`a${i}`] !== null) stat.avg = Number(r[`a${i}`]);
    const lo = asDate(c, r[`lo${i}`]), hi = asDate(c, r[`hi${i}`]);
    if (lo) stat.min = lo;
    if (hi) stat.max = hi;
    out.cols[c.name] = stat;
  });
  // The newest date that is not in the future: a date column of due dates or maturities runs ahead of today.
  const horizon = Date.now() + 864e5;
  const newest = cols.filter((c) => out.cols[c.name]?.max && Date.parse(out.cols[c.name].max!) <= horizon)
    .sort((a, b) => Date.parse(out.cols[b.name].max!) - Date.parse(out.cols[a.name].max!))[0];
  if (newest) out.newest = { column: newest.name, value: out.cols[newest.name].max! };
  // Coded columns, and any column tallied before: a code list that went missing must not hide the code that broke it.
  for (const c of cols.filter((x) => (x.decode || tallied.has(x.name)) && !quiet(x)).slice(0, PROFILE.codeColumns)) {
    const g = await reader.aggregate({ kind: "aggregate", object: o, metrics: [{ fn: "count", as: "n" }], groupBy: [c.name], filters: [{ column: c.name, op: "not_null" }], minGroupSize: 1, sort: { column: "n", dir: "desc" }, limit: PROFILE.codesKept });
    out.cols[c.name] = { ...out.cols[c.name], codes: Object.fromEntries(g.rows.map((x) => [String(x[c.name]).trim(), Number(x.n)])) };
  }
  return out;
}

/** What changed in the data between the snapshots before and this one. Pure, so every rule is tested on its own. */
export function driftOf(before: ProfileSnapshot[], now: ProfileSnapshot, o: CatalogObject): Drift[] {
  const prev = before.at(-1);
  if (!prev) return [];
  const at = now.at;
  const out: Drift[] = [];
  if (prev.rows > 0 && now.rows === 0) out.push({ at, kind: "emptied", before: prev.rows, after: 0 });
  else if (prev.rows >= PROFILE.minRows && now.rows < prev.rows * (1 - PROFILE.shrink)) out.push({ at, kind: "shrank", before: prev.rows, after: now.rows });
  else if (prev.rows >= PROFILE.minRows && now.rows > prev.rows * PROFILE.surge) out.push({ at, kind: "surged", before: prev.rows, after: now.rows });
  if (now.rows >= PROFILE.minRows && prev.rows >= PROFILE.minRows) for (const [name, s] of Object.entries(now.cols)) {
    const p = prev.cols[name];
    if (!p) continue;
    const wasEmpty = (p.nulls ?? 0) / prev.rows, isEmpty = (s.nulls ?? 0) / now.rows;
    if (isEmpty - wasEmpty >= PROFILE.unfilled) out.push({ at, kind: "unfilled", column: name, before: +wasEmpty.toFixed(2), after: +isEmpty.toFixed(2) });
    if (p.avg && s.avg && Math.sign(p.avg) === Math.sign(s.avg)) {
      const ratio = Math.abs(s.avg / p.avg);
      if (ratio >= PROFILE.scale || ratio <= 1 / PROFILE.scale) out.push({ at, kind: "scale", column: name, before: p.avg, after: s.avg });
    }
    if (s.codes) {
      const col = o.columns.find((c) => c.name === name);
      const known = new Set([...(col?.decode?.meanings.map(([k]) => k) ?? []), ...Object.keys(p.codes ?? {})]);
      for (const [code, n] of Object.entries(s.codes)) if (!known.has(code)) out.push({ at, kind: "new_code", column: name, after: code, before: n });
    }
  }
  // A feed has stopped when its newest record moved into its value before and has not moved since; said once, when it
  // first stays still longer than the threshold.
  if (now.newest) {
    let i = before.length;
    while (i > 0 && before[i - 1].newest?.value === now.newest.value) i--;
    const since = before[i]?.at;
    const moved = before.slice(0, i).some((b) => b.newest && b.newest.value < now.newest!.value);
    const stalled = (t: string) => !!since && Date.parse(t) - Date.parse(since) >= PROFILE.stalledMs;
    if (moved && stalled(at) && !stalled(prev.at)) out.push({ at, kind: "stalled", column: now.newest.column, after: now.newest.value });
  }
  return out;
}

/** Profiles every object of one connection that is due, oldest first, within the run's budget. Failures skip the object. */
const running = new Set<string>();
export async function profileConnection(connectionId: string): Promise<{ profiled: number; drift: number }> {
  const conn = get("connection", connectionId);
  if (!conn || conn.status !== "ok" || running.has(connectionId)) return { profiled: 0, drift: 0 };
  running.add(connectionId);
  try { return await profileNow(conn); } finally { running.delete(connectionId); }
}

async function profileNow(conn: Connection): Promise<{ profiled: number; drift: number }> {
  const connectionId = conn.id;
  const objs = list("catalog", conn.tenantId).filter((o) => o.connectionId === connectionId && !o.unionOf);
  const profiles = new Map(list("profile", conn.tenantId).filter((p) => p.connectionId === connectionId).map((p) => [p.object, p]));
  const due = objs.sort((a, b) => (profiles.get(a.name)?.snapshots.at(-1)?.at ?? "").localeCompare(profiles.get(b.name)?.snapshots.at(-1)?.at ?? "")).slice(0, PROFILE.objectsPerRun);
  const found: { object: string; drift: Drift[] }[] = [];
  let profiled = 0;
  for (const o of due) {
    try {
      const before = profiles.get(o.name)?.snapshots.at(-1);
      const snap = await snapshotOf(conn, o, new Set(Object.entries(before?.cols ?? {}).filter(([, s]) => s.codes).map(([k]) => k)));
      const p: DataProfile = profiles.get(o.name) ?? { id: `${connectionId}/${o.name}`, tenantId: conn.tenantId, connectionId, object: o.name, snapshots: [], drift: [] };
      const d = driftOf(p.snapshots, snap, o);
      put("profile", { ...p, snapshots: [...p.snapshots, snap].slice(-PROFILE.snapshotsKept), drift: [...p.drift, ...d].slice(-PROFILE.driftKept) });
      if (d.length) found.push({ object: o.name, drift: d });
      profiled++;
    } catch { /* an object that cannot be read now is tried again next run */ }
  }
  if (found.length) record({ tenantId: conn.tenantId, actor: { userId: "system", unitId: null, role: "profiling" }, kind: "data_change", target: conn.code, detail: { objects: found } });
  return { profiled, drift: found.reduce((n, f) => n + f.drift.length, 0) };
}

/** Recent drift on one object, newest first, for agents and the data map. */
export function recentDrift(connectionId: string, object: string, now = Date.now()): Drift[] {
  const p = get("profile", `${connectionId}/${object}`);
  return (p?.drift ?? []).filter((d) => now - Date.parse(d.at) < PROFILE.driftShownMs).reverse();
}
