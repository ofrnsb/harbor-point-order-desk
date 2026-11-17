// Differencing guard for aggregate-only columns. Two totals whose groups may be nested and differ by fewer than
// minGroupSize rows reveal those rows' values by subtraction, however the filters are worded. Every protected result
// a user receives is kept for a while; a new one that would complete such a pair is refused.
import type { CatalogObject, Effective, Filter } from "./contract.ts";
import { PolicyError } from "./policy.ts";
import { db } from "./store.ts";
import { ERR } from "../copy/server.ts";

const KEEP_DAYS = 30;
const KEEP_ROWS = 5000;
type Cond = { column: string; op: string; value?: unknown };

let ready = false;
function table() {
  if (!ready) {
    db().exec(`CREATE TABLE IF NOT EXISTS disclosure (tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, target TEXT NOT NULL, conds TEXT NOT NULL, n INTEGER NOT NULL, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS disclosure_user ON disclosure (tenant_id, user_id, target, at);`);
    ready = true;
  }
  return db();
}

const valuesOf = (c: Cond): string[] | null =>
  c.op === "eq" ? [String(c.value)] : c.op === "in" && Array.isArray(c.value) ? c.value.map(String) : c.op.startsWith("bucket:") ? [`${c.op}|${String(c.value)}`] : null;

/** Provably disjoint only when both pin the same column to value sets that share nothing; anything else may nest. */
function disjoint(a: Cond[], b: Cond[]): boolean {
  return a.some((x) => b.some((y) => {
    if (x.column !== y.column) return false;
    const vx = valuesOf(x), vy = valuesOf(y);
    if (!vx || !vy) return false;
    if (x.op.startsWith("bucket:") !== y.op.startsWith("bucket:")) return false;
    return !vx.some((v) => vy.includes(v));
  }));
}

/**
 * Checks one protected aggregate result against what this user already received for the same object and columns,
 * then records it. `rows` are the connector's raw rows: the group size in `__n` is stripped before rows reach the agent.
 */
export function guardDifferencing(eff: Effective, obj: CatalogObject, columns: string[], filters: Filter[], groupBy: string[], bucket: { column: string; unit: string; alias: string } | undefined, rows: Record<string, unknown>[], k: number): void {
  if (!columns.length || k <= 1) return;
  const base: Cond[] = filters.map((f) => ({ column: f.column, op: f.op, value: f.value }));
  if (rows.some((r) => !Number.isFinite(Number(r.__n)))) throw new PolicyError(ERR.revealsByDifference(k), "aggregate_only");
  const fresh = rows.map((r) => ({
    n: Number(r.__n),
    conds: [...base, ...groupBy.map((g) => ({ column: g, op: "eq", value: r[g] })), ...(bucket ? [{ column: bucket.column, op: `bucket:${bucket.unit}`, value: r[bucket.alias] }] : [])],
  }));
  const d = table();
  const since = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  const targets = columns.map((c) => `${obj.connectionId}/${obj.name}#${c}`);
  for (const target of targets) {
    const past = (d.prepare("SELECT conds, n FROM disclosure WHERE tenant_id = ? AND user_id = ? AND target = ? AND at >= ? ORDER BY at DESC LIMIT ?")
      .all(eff.tenant.id, eff.user.id, target, since, KEEP_ROWS) as { conds: string; n: number }[]).map((p) => ({ n: p.n, conds: JSON.parse(p.conds) as Cond[] }));
    for (const f of fresh) for (const p of past) {
      const gap = Math.abs(f.n - p.n);
      if (gap > 0 && gap < k && !disjoint(f.conds, p.conds)) throw new PolicyError(ERR.revealsByDifference(k), "aggregate_only");
    }
  }
  const at = new Date().toISOString();
  const ins = d.prepare("INSERT INTO disclosure (tenant_id, user_id, target, conds, n, at) VALUES (?, ?, ?, ?, ?, ?)");
  d.transaction(() => { for (const target of targets) for (const f of fresh) ins.run(eff.tenant.id, eff.user.id, target, JSON.stringify(f.conds), f.n, at); })();
}
