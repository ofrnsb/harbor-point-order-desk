// Pure helpers shared by the connectors' introspection and the catalog: type mapping, labels and sensitivity suggestions.
import type { CatalogColumn, CatalogObject, ColumnType, Sensitivity } from "./contract.ts";
import { ACRONYMS, UPPER_WORDS, LEGACY_WORDS, LABEL_ACRONYMS, TABLE_PREFIXES } from "../copy/vocab.ts";
import { CLASSIFY } from "../config/server.ts";
import { detectEncoding, detectMinorUnits } from "./semantics.ts";



/** Suggests a sensitivity label from the column name first, then from sample values. Admins confirm or override it. */
export function classifyColumn(name: string, nativeType: string, samples: unknown[]): Sensitivity {
  if (CLASSIFY.RESTRICTED.test(name)) return "restricted";
  if (CLASSIFY.CONFIDENTIAL.test(name)) return "confidential";
  const texts = samples.filter((v): v is string | number => typeof v === "string" || typeof v === "number").map((v) => String(v).trim()).filter(Boolean);
  if (texts.length) {
    const share = (re: RegExp) => texts.filter((t) => re.test(t)).length / texts.length;
    if (share(CLASSIFY.SSN) >= CLASSIFY.sampleShare) return "restricted";
    if (share(CLASSIFY.EMAIL) >= CLASSIFY.sampleShare || share(CLASSIFY.PHONE) >= CLASSIFY.sampleShare) return "confidential";
  }
  if (CLASSIFY.MONEY.test(name)) return "internal";
  if (CLASSIFY.LOOKUP.test(name)) return "public";
  if (CLASSIFY.ID.test(name)) return "internal";
  if (/bool/i.test(nativeType)) return "public";
  return "internal";
}

/** A name the agent made up for a computed column ("total_spt", "jumlah_ppn") as a heading: first word capitalised, acronyms upper-case. */
export function aliasLabel(alias: string): string {
  const words = alias.replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  return words.length ? words.join(" ").replace(/^./, (x) => x.toUpperCase()) : alias;
}

/** "credit_limit" -> "Credit limit", "customerCode" -> "Customer code", "_id" -> "Id". */
export function humanLabel(name: string): string {
  // Acronyms inside a mixed-case name stay acronyms (CIFNo is "CIF no", ReqID "Req ID"); an all-caps name is lowered.
  // Legacy abbreviations are read out (CUST_NM is "Customer name", tblLoanApp "Loan application"), bank acronyms stay.
  let tokens = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && TABLE_PREFIXES.has(tokens[0].toLowerCase())) tokens = tokens.slice(1);
  const words = tokens.map((w) => {
    const l = w.toLowerCase();
    return LABEL_ACRONYMS.has(l) ? l.toUpperCase() : LEGACY_WORDS[l] ?? l;
  }).join(" ");
  const fixed = UPPER_WORDS.reduce((t, [w, up]) => t.replace(new RegExp(`\\b${w}\\b`, "g"), up), words);
  return fixed ? fixed[0].toUpperCase() + fixed.slice(1) : name;
}



/** Maps a native database type to the catalog's portable type. */
export function columnType(nativeType: string): ColumnType {
  const t = nativeType.toLowerCase();
  if (/bool|bit\(1\)|tinyint\(1\)/.test(t)) return "bool";
  if (/int|numeric|decimal|real|double|float|money|number|serial/.test(t)) return "number";
  if (/date|time/.test(t)) return "date";
  if (/json|array|object|\[\]/.test(t)) return "json";
  return "text";
}

export type RawColumn = { name: string; nativeType: string; nullable: boolean; fk?: { object: string; column: string }; path?: string; unwind?: string };

/** Builds a catalog object (without connectionId and exposed) from introspected parts, suggesting labels and sensitivity. */
export function buildObject(o: { name: string; kind: CatalogObject["kind"]; columns: RawColumn[]; primaryKey: string[]; rowEstimate: number; samples: Record<string, unknown[]> }): Omit<CatalogObject, "connectionId" | "exposed"> {
  const columns: CatalogColumn[] = o.columns.map((c) => ({
    name: c.name, type: columnType(c.nativeType), nativeType: c.nativeType, nullable: c.nullable, pk: o.primaryKey.includes(c.name),
    ...(c.fk ? { fk: c.fk } : {}), ...(c.path ? { path: c.path } : {}), ...(c.unwind ? { unwind: c.unwind } : {}),
    label: humanLabel(c.name), description: "",
    sensitivity: classifyColumn(c.name, c.nativeType, o.samples[c.name] ?? []), sensitivitySource: "auto",
    ...((e) => (e ? { encoding: e } : {}))(detectEncoding(c.name, c.nativeType, o.samples[c.name] ?? [])),
    ...((u) => (u ? { unitHint: u } : {}))(detectMinorUnits(c.name, c.nativeType, o.samples[c.name] ?? [])),
  }));
  return { name: o.name, kind: o.kind, label: humanLabel(o.name), description: "", rowEstimate: Math.max(0, Math.round(o.rowEstimate)), columns, primaryKey: o.primaryKey };
}
