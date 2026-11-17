// Learns what a company's data means from the data itself, so a 30-year-old estate works without per-client setup:
// legacy date encodings, code tables and what each code means, period tables that are one logical table, effective-
// dated history, and ids that point into other systems. Everything here is a suggestion shown to the agent and the
// admin; nothing changes a stored value.
import type { CatalogColumn, CatalogObject } from "./contract.ts";

const share = (vals: string[], ok: (v: string) => boolean) => (vals.length ? vals.filter(ok).length / vals.length : 0);
const MIN_SHARE = 0.9;
const MIN_SAMPLES = 5;

const dayOfYear = (v: number) => v >= 1 && v <= 366;
const isDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100;

/** How a number or string column stores a date or time, judged from its name and values. */
export function detectEncoding(name: string, nativeType: string, samples: unknown[]): CatalogColumn["encoding"] {
  if (/date|time|timestamp/i.test(nativeType)) return undefined;
  const vals = samples.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map((v) => String(v).trim());
  if (vals.length < MIN_SAMPLES || !vals.every((v) => /^\d+$/.test(v))) return undefined;
  const dateName = /(dt|date|tgl|tanggal|jul|dob|lahir|_d$)/i.test(name);
  const timeName = /(tm|time|jam|waktu)$/i.test(name);
  if (timeName && share(vals, (v) => v.length === 6 && +v.slice(0, 2) < 24 && +v.slice(2, 4) < 60 && +v.slice(4) < 60) >= MIN_SHARE) return "hhmmss";
  if (share(vals, (v) => v.length === 8 && isDate(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6))) >= MIN_SHARE) return "yyyymmdd";
  if (!dateName) return undefined;
  if (share(vals, (v) => v.length === 6 && +v.slice(0, 4) >= 1900 && +v.slice(4) >= 1 && +v.slice(4) <= 12) >= MIN_SHARE) return "yyyymm";
  if (share(vals, (v) => v.length === 7 && +v.slice(0, 4) >= 1900 && dayOfYear(+v.slice(4))) >= MIN_SHARE) return "julian_yyyyddd";
  // CYYDDD stored as a number loses its leading 0: 19xx dates have 5 digits, 20xx dates 6 digits starting with 1.
  const cyy = (v: string) => ((v.length === 5 || (v.length === 6 && /^[012]/.test(v)) || (v.length === 7 && v[0] === "0")) && dayOfYear(+v.slice(-3)));
  if (share(vals, cyy) >= MIN_SHARE && vals.some((v) => v.length >= 6)) return "julian_cyyddd";
  if (share(vals, (v) => v.length <= 5 && dayOfYear(+v.slice(-3))) >= MIN_SHARE) return "julian_yyddd";
  return undefined;
}

const MONEYISH = /(amt|amount|bal|balance|nominal|saldo|jumlah|limit|price|harga|fee|biaya|plafon|outstanding|tagihan)/i;
/** A money column that may hold minor units: integers only, nearly all multiples of 100, and large. Only a suggestion. */
export function detectMinorUnits(name: string, nativeType: string, samples: unknown[]): number | undefined {
  if (!MONEYISH.test(name) || /char|text|date|time/i.test(nativeType)) return undefined;
  const vals = samples.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v !== 0);
  if (vals.length < MIN_SAMPLES || !vals.every(Number.isInteger)) return undefined;
  const hundreds = vals.filter((v) => v % 100 === 0).length / vals.length;
  const median = [...vals].map(Math.abs).sort((a, b) => a - b)[Math.floor(vals.length / 2)];
  return hundreds >= 0.95 && median >= 1_000_000 ? 100 : undefined;
}

/** How to read and filter an encoded column, with today's value as a worked example. */
export function encodingHint(e: NonNullable<CatalogColumn["encoding"]>, now = new Date()): string {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1, d = now.getUTCDate();
  const doy = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  const today = `${y}-${p(m, 2)}-${p(d, 2)}`;
  return {
    julian_cyyddd: `date stored as CYYDDD (C = century: 0 for 19xx, 1 for 20xx; DDD = day of year). ${today} is ${y >= 2000 ? 1 : 0}${p(y % 100, 2)}${p(doy, 3)}; filter with numbers in that form`,
    julian_yyddd: `date stored as YYDDD (two-digit year, day of year). ${today} is ${p(y % 100, 2)}${p(doy, 3)}`,
    julian_yyyyddd: `date stored as YYYYDDD (year, day of year). ${today} is ${y}${p(doy, 3)}`,
    yyyymmdd: `date stored as the number YYYYMMDD. ${today} is ${y}${p(m, 2)}${p(d, 2)}; filter with numbers in that form`,
    yyyymm: `month stored as the number YYYYMM. This month is ${y}${p(m, 2)}`,
    hhmmss: "time of day stored as HHMMSS",
  }[e];
}

/** "CIF_NO", "CifNo", "cif_no", "CIFNO" all normalise to "cifno". */
export const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");

const PERIOD = /^(.*?)[_-]?((?:19|20)\d{2}(?:0[1-9]|1[0-2])?(?:[0-3]\d)?)$/i;
const colKey = (o: CatalogObject) => o.columns.map((c) => c.name).sort().join(",");

/** Same-shaped tables that differ only by a period suffix become one logical object named after their stem. */
export function periodFamilies(objs: CatalogObject[]): CatalogObject[] {
  const groups = new Map<string, CatalogObject[]>();
  for (const o of objs) {
    if (o.unionOf || o.kind === "collection") continue;
    const m = PERIOD.exec(o.name);
    if (!m || !m[1]) continue;
    const key = `${o.connectionId}|${m[1].replace(/[_-]+$/, "")}|${colKey(o)}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const out: CatalogObject[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const stem = key.split("|")[1];
    const name = objs.some((o) => o.connectionId === members[0].connectionId && o.name === stem) ? `${stem}_ALL` : stem;
    const upper = members[0].name === members[0].name.toUpperCase();
    const src = upper ? "SOURCE_TABLE" : "source_table";
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
    out.push({
      ...sorted[0], name, kind: "view", label: stem, description: "",
      rowEstimate: members.reduce((s, o) => s + o.rowEstimate, 0), primaryKey: [], unionOf: sorted.map((o) => o.name),
      columns: [...sorted[0].columns.map((c) => ({ ...c, pk: false })), { name: src, type: "text", nativeType: "text", nullable: false, pk: false, label: src, description: "", sensitivity: "public", sensitivitySource: "auto" }],
    });
  }
  return out;
}

const FROM = /^(valid_?from|eff(ective)?_?(dt|date|from)|start_?(dt|date)|berlaku_?(dari|mulai)|tgl_?mulai)$/i;
const TO = /^(valid_?to|valid_?until|exp(iry|ire)?_?(dt|date)|end_?(dt|date)|eff(ective)?_?to|berlaku_?(sampai|hingga)|tgl_?akhir)$/i;
const CURRENT = /^(is_?current|curr(ent)?_?(flag|flg|ind)|is_?active_?version|aktif_?terakhir|latest_?flag)$/i;

/** Effective-dated history (slowly changing records): where each version starts, ends, or is flagged current. */
export function historyOf(o: CatalogObject): CatalogObject["history"] {
  const from = o.columns.find((c) => FROM.test(normalize(c.name)))?.name;
  const to = o.columns.find((c) => TO.test(normalize(c.name)))?.name;
  const current = o.columns.find((c) => CURRENT.test(normalize(c.name)))?.name;
  return from && (to || current) ? { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(current ? { current } : {}) } : undefined;
}
const normalize = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, "$1_$2");

const CODE_VALUE = /^(cd_?val(ue)?|code_?val(ue)?|kode|code|cd|value)$/i;
const CODE_DESC = /^(cd_?desc|desc(ription)?|code_?desc|keterangan|ket|uraian|nama|name|label|meaning)$/i;
const CODE_TYPE = /^(cd_?typ(e)?|code_?typ(e)?|type|jenis|kategori|category|group|grp|list)$/i;
const CODE_TABLE_MAX_ROWS = 5000;

/** A small table of code values and their descriptions, optionally many lists keyed by a type column. */
export function codeTableShape(o: CatalogObject): CatalogObject["codeTable"] {
  if (o.rowEstimate > CODE_TABLE_MAX_ROWS || o.unionOf) return undefined;
  const value = o.columns.find((c) => CODE_VALUE.test(normalize(c.name)) && c.type === "text")?.name;
  const desc = o.columns.find((c) => CODE_DESC.test(normalize(c.name)) && c.type === "text" && c.name !== value)?.name;
  const type = o.columns.find((c) => CODE_TYPE.test(normalize(c.name)) && c.type === "text" && c.name !== value && c.name !== desc)?.name;
  return value && desc ? { value, desc, ...(type ? { type } : {}) } : undefined;
}

const CODED = /(cd|code|kode|sts|status|typ|type|jenis|seg|flag|flg|ind|kd)$/i;

/**
 * Which code list a coded column uses. With a type column the list whose type matches the column's stem wins
 * (SEG_CD uses type "SEG"); otherwise the table whose values cover the column's sampled values.
 */
/**
 * `counts`, when given, weighs each sampled value by its rows: one new code on a handful of rows does not hide a code
 * list that explains the other 99.9% (and the new code is then reported as drift, see profile.ts).
 */
export function matchCodes(column: string, sampled: string[], tables: { obj: CatalogObject; rows: { type?: string; value: string; desc: string }[] }[], counts?: number[]): CatalogColumn["decode"] | undefined {
  if (!CODED.test(column) || !sampled.length) return undefined;
  const stem = normName(column).replace(/(cd|code|kode|sts|status|typ|type|kd)$/, "");
  let best: { obj: CatalogObject; rows: { value: string; desc: string }[]; cover: number } | null = null;
  for (const t of tables) {
    const lists = t.obj.codeTable?.type ? [...new Set(t.rows.map((r) => r.type ?? ""))].map((ty) => t.rows.filter((r) => r.type === ty)) : [t.rows];
    for (const list of lists) {
      const values = new Set(list.map((r) => r.value));
      const total = counts ? counts.reduce((a, b) => a + b, 0) : 0;
      const cover = counts && total > 0 ? sampled.reduce((n, v, i) => n + (values.has(v) ? counts[i] : 0), 0) / total : share(sampled, (v) => values.has(v));
      const named = t.obj.codeTable?.type && stem && normName(list[0]?.type ?? "") === stem;
      const score = cover + (named ? 1 : 0);
      if (cover >= 0.8 && (!best || score > best.cover)) best = { obj: t.obj, rows: list, cover: score };
    }
  }
  return best ? { connectionId: best.obj.connectionId, object: best.obj.name, meanings: best.rows.slice(0, 60).map((r) => [r.value, r.desc]) } : undefined;
}

/**
 * Column pairs worth checking as links: a child column whose normalised name equals another object's single-column key
 * (CIFNo in the loan system and CIF_NO in core banking), or ends with it (CUST_CIF_NO). The caller verifies each pair
 * against the data before recording it.
 */
export function linkCandidates(objs: CatalogObject[]): { child: CatalogObject; column: string; parent: CatalogObject; key: string }[] {
  const parents = objs.filter((o) => o.primaryKey.length === 1 && !o.unionOf && !o.codeTable);
  // Tables of one period family never point at each other: their keys only look alike.
  const stem = (o: CatalogObject) => o.name.replace(/[_-]?(?:19|20)\d{2}(?:0[1-9]|1[0-2])?(?:[0-3]\d)?$/i, "");
  const out: { child: CatalogObject; column: string; parent: CatalogObject; key: string }[] = [];
  for (const child of objs) for (const c of child.columns) {
    if (c.fk || c.virtual) continue;
    const n = normName(c.name);
    const ownKey = child.primaryKey.length === 1 && child.primaryKey[0] === c.name;
    for (const parent of parents) {
      if (parent.connectionId === child.connectionId && parent.name === child.name) continue;
      if (parent.connectionId === child.connectionId && stem(parent) === stem(child) && stem(child) !== child.name) continue;
      const k = normName(parent.primaryKey[0]);
      // Same-named non-key ids already link by the name rule; same-named keys (peers) and renamed ids need the data check.
      if (k.length >= 3 && (n === k || n.endsWith(k)) && (c.name !== parent.primaryKey[0] || ownKey)) out.push({ child, column: c.name, parent, key: parent.primaryKey[0] });
    }
  }
  return out;
}

/**
 * What changed in one object between two introspections. A column that disappears while one of the same type appears
 * in its place is reported as a likely rename, for a person to confirm.
 */
export function columnChanges(before: CatalogObject, after: CatalogObject): Omit<NonNullable<CatalogObject["changed"]>, "at"> | null {
  const was = new Map(before.columns.filter((c) => !c.virtual).map((c) => [c.name, c]));
  const now = new Map(after.columns.filter((c) => !c.virtual).map((c) => [c.name, c]));
  let added = [...now.keys()].filter((n) => !was.has(n));
  let removed = [...was.keys()].filter((n) => !now.has(n));
  const retyped = [...now.keys()].filter((n) => was.has(n) && was.get(n)!.nativeType !== now.get(n)!.nativeType);
  const renamed: [string, string][] = [];
  for (const r of [...removed]) {
    const same = added.filter((a) => now.get(a)!.nativeType === was.get(r)!.nativeType);
    if (same.length === 1) { renamed.push([r, same[0]]); added = added.filter((a) => a !== same[0]); removed = removed.filter((x) => x !== r); }
  }
  return added.length || removed.length || retyped.length || renamed.length ? { added, removed, retyped, renamed } : null;
}

