// Opening questions built from the shape of the connected data, so a team with no admin-written starters still opens on its own records.
// Pure and schema-only, like wiring: no rows are read.
import type { CatalogObject } from "./contract.ts";
import { wireObject, type ViewKind } from "./wiring.ts";
import { LABEL } from "../copy/server.ts";
import { DATA_STARTERS_MAX } from "../config/server.ts";

export type DataStarter = { title: string; send: string; /** "connectionId/object" */ source: string; kind: "upcoming" | "recent" | "board" | "breakdown" | "trend" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const AHEAD = /(due|deadline|tenggat|jatuh_tempo|expir|kedaluwarsa|schedul|jadwal|hearing|sidang|visit|kunjungan|start|mulai|check_in|next)/i;

function candidates(obj: CatalogObject, all: CatalogObject[]): DataStarter[] {
  const w = wireObject(obj, all);
  // Column labels are written as headings ("Status"); inside a sentence they read lower-case, acronyms kept.
  const label = (col: string) => {
    const l = obj.columns.find((c) => c.name === col)?.label ?? col;
    return /^[A-Z][a-z]/.test(l) ? l[0].toLowerCase() + l.slice(1) : l;
  };
  const view = (k: ViewKind) => w.views.find((v) => v.kind === k);
  const source = `${obj.connectionId}/${obj.name}`;
  const out: DataStarter[] = [];
  const cal = view("calendar");
  const ahead = cal && AHEAD.test(cal.binds.start);
  if (cal && ahead) out.push({ kind: "upcoming", source, title: LABEL.inNext14Days(obj.label), send: LABEL.showUpcomingWithin14Days(obj.label, label(cal.binds.start)) });
  const board = view("board");
  if (board) out.push({ kind: "board", source, title: LABEL.per(obj.label, label(board.binds.lane)), send: LABEL.groupByNeedsFollowUp(obj.label, label(board.binds.lane)) });
  const br = view("breakdown");
  if (br) out.push({ kind: "breakdown", source, title: LABEL.per(cap(label(br.binds.measure)), label(br.binds.group)), send: LABEL.hitungTotalPerTerbesar(label(br.binds.measure), obj.label, label(br.binds.group)) });
  const trend = view("trend");
  if (trend) out.push({ kind: "trend", source, title: LABEL.trend(label(trend.binds.measure)), send: LABEL.showMonthlyTrend(label(trend.binds.measure), obj.label) });
  // The latest records are the least telling question, so they come last.
  if (cal && !ahead) out.push({ kind: "recent", source, title: LABEL.terbaru(obj.label), send: LABEL.tampilkanTerbaruMenurut(obj.label, label(cal.binds.start)) });
  return out;
}

/** One question per object: what is coming up first, then the most-referenced objects, spreading the kinds so the set is not six tables of the same shape. */
export function dataStarters(objs: CatalogObject[], max = DATA_STARTERS_MAX): DataStarter[] {
  const info = new Map(objs.map((o) => [o, { inbound: wireObject(o, objs).links.filter((l) => l.dir === "in").length, options: candidates(o, objs) }]));
  const soon = (o: CatalogObject) => (info.get(o)!.options.some((c) => c.kind === "upcoming") ? 0 : 1);
  const ranked = [...objs].sort((a, b) => soon(a) - soon(b) || info.get(b)!.inbound - info.get(a)!.inbound || b.rowEstimate - a.rowEstimate || a.name.localeCompare(b.name));
  const used = new Map<string, number>();
  const out: DataStarter[] = [];
  for (const o of ranked) {
    if (out.length >= max) break;
    const pick = [...info.get(o)!.options].sort((a, b) => (used.get(a.kind) ?? 0) - (used.get(b.kind) ?? 0))[0];
    if (!pick) continue;
    used.set(pick.kind, (used.get(pick.kind) ?? 0) + 1);
    out.push(pick);
  }
  return out;
}
