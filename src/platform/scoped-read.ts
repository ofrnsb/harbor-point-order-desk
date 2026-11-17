// One policy-scoped read, including parents in other systems whose row filters must be checked row by row.
import type { CatalogObject, Effective } from "./contract.ts";
import { connectorFor } from "./connectors/index.ts";
import { type Plan, planSelect, PolicyError } from "./policy.ts";
import { get } from "./store.ts";
import type { ScopedSelect } from "./contract.ts";
import { POLICY } from "../config/server.ts";
import { ERR } from "../copy/server.ts";

type Req = Parameters<typeof planSelect>[2];
export type ScopedRows = { plan: Plan<ScopedSelect>; rows: Record<string, unknown>[]; total: number | null; ms: number; statement: string };

/** Rows are the connector's (unmasked); callers shape them with plan.masks before anything leaves the server. */
export async function selectScoped(eff: Effective, obj: CatalogObject, req: Req, opts: { external: boolean }): Promise<ScopedRows> {
  const plan = planSelect(eff, obj, req, opts);
  const conn = get("connection", obj.connectionId);
  if (!conn) throw new Error(ERR.connectionNotFoundForObject(obj.connectionId));
  const res = await connectorFor(conn, "read").select(plan.query);
  let rows = res.rows;
  for (const g of plan.postGuards ?? []) {
    const values = [...new Set(rows.map((r) => r[g.column]).filter((v) => v !== null && v !== undefined).map(String))];
    const visible = new Set<string>();
    for (let i = 0; i < values.length; i += POLICY.inValuesMax) {
      const chunk = values.slice(i, i + POLICY.inValuesMax);
      try {
        const sub = await selectScoped(eff, g.parent, { columns: [g.key], filters: [{ column: g.key, op: "in", value: chunk }], limit: chunk.length }, opts);
        for (const r of sub.rows) visible.add(String(r[g.key]));
      } catch (e) { if (!(e instanceof PolicyError)) throw e; }
    }
    rows = rows.filter((r) => visible.has(String(r[g.column])));
  }
  if (plan.dropColumns?.length) rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !plan.dropColumns!.includes(k))));
  // After a row-by-row check the source's total counts rows this user may not see, so it is not reported.
  return { plan, rows, total: plan.postGuards?.length ? null : res.total, ms: res.ms, statement: res.statement };
}
