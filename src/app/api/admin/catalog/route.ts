import { z } from "zod";
import { requireAdmin } from "@/platform/auth";
import { settleRename } from "@/platform/catalog";
import { get, list, put } from "@/platform/store";
import { SENSITIVITIES, type CatalogColumn } from "@/platform/contract";
import type { CatalogResponse } from "@/platform/api-types";
import { adminAudit, body, fail, handle, json, owned } from "@/platform/route-kit";
import { ADMIN_API as M } from "@/copy/app-api";
import { API_LIMITS } from "@/config/app";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(() => {
    const { tenant } = requireAdmin(req); // read for every admin (grant editors need names); credentials never leave the server
    const id = new URL(req.url).searchParams.get("connectionId") ?? "";
    const c = owned("connection", id, tenant.id);
    const objects = list("catalog", tenant.id).filter((o) => o.connectionId === id);
    const { readSecret: _r, writeSecret, ...rest } = c;
    return json({ connection: { ...rest, hasWrite: !!writeSecret, objects: objects.length }, objects } satisfies CatalogResponse);
  });
}

const ENCODINGS = ["julian_cyyddd", "julian_yyddd", "julian_yyyyddd", "yyyymmdd", "yyyymm", "hhmmss"] as const;
type Correction = { encoding?: (typeof ENCODINGS)[number] | null; clearDecode?: boolean; clearLink?: boolean; minorUnits?: 10 | 100 | 1000 | null };
function semantics(c: CatalogColumn, x: Correction): Partial<CatalogColumn> {
  if (x.encoding === undefined && !x.clearDecode && !x.clearLink && x.minorUnits === undefined) return {};
  const out: Partial<CatalogColumn> = { semanticsSource: "admin" };
  if (x.encoding !== undefined) out.encoding = x.encoding ?? undefined;
  if (x.clearDecode) out.decode = undefined;
  if (x.clearLink) out.link = undefined;
  // Either answer settles the suggestion: confirmed it becomes the unit, rejected it is not shown again.
  if (x.minorUnits !== undefined) { out.minorUnits = x.minorUnits ?? undefined; out.unitHint = undefined; }
  return { ...c, ...out };
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireAdmin(req, "security_admin");
    const b = await body(req, z.object({
      connectionId: z.string().min(1), object: z.string().min(1).max(API_LIMITS.catalogName),
      exposed: z.boolean().optional(), label: z.string().trim().max(API_LIMITS.catalogLabel).optional(), description: z.string().trim().max(API_LIMITS.catalogDescription).optional(),
      column: z.object({ name: z.string().min(1).max(API_LIMITS.catalogName), label: z.string().trim().max(API_LIMITS.catalogLabel).optional(), description: z.string().trim().max(API_LIMITS.catalogDescription).optional(), sensitivity: z.enum(SENSITIVITIES).optional(),
        // A person correcting what was learned from the data: set or clear the encoding, drop a wrong code list or link.
        encoding: z.enum(ENCODINGS).nullable().optional(), clearDecode: z.boolean().optional(), clearLink: z.boolean().optional(),
        minorUnits: z.union([z.literal(10), z.literal(100), z.literal(1000)]).nullable().optional() }).optional(),
      // An admin's answer to "probably renamed": the same column (carry its settings over) or not.
      rename: z.object({ from: z.string().min(1).max(API_LIMITS.catalogName), to: z.string().min(1).max(API_LIMITS.catalogName), same: z.boolean() }).optional(),
    }));
    owned("connection", b.connectionId, tenant.id);
    const obj = get("catalog", `${b.connectionId}/${b.object}`);
    if (!obj) return fail(M.objectNotFound, 404);
    let next = { ...obj, ...(b.exposed !== undefined ? { exposed: b.exposed } : {}), ...(b.label !== undefined ? { label: b.label } : {}), ...(b.description !== undefined ? { description: b.description } : {}) };
    if (b.column) {
      const col = next.columns.find((c) => c.name === b.column!.name);
      if (!col) return fail(M.columnNotFound(b.column.name), 404);
      next = { ...next, columns: next.columns.map((c) => c.name !== col.name ? c : {
        ...c,
        ...(b.column!.label !== undefined ? { label: b.column!.label } : {}),
        ...(b.column!.description !== undefined ? { description: b.column!.description } : {}),
        ...(b.column!.sensitivity ? { sensitivity: b.column!.sensitivity, sensitivitySource: "admin" as const } : {}),
        ...semantics(c, b.column!),
      }) };
    }
    if (b.rename) {
      if (!next.changed?.renamed.some(([a, c]) => a === b.rename!.from && c === b.rename!.to)) return fail(M.renameNotPending, 404);
      next = settleRename(next, b.rename.from, b.rename.to, b.rename.same);
    }
    put("catalog", next);
    adminAudit(user, `${b.connectionId}/${b.object}`, { op: "update_catalog", ...(b.exposed !== undefined ? { exposed: b.exposed } : {}), ...(b.column ? { column: b.column.name, sensitivity: b.column.sensitivity, encoding: b.column.encoding, clearDecode: b.column.clearDecode, clearLink: b.column.clearLink, minorUnits: b.column.minorUnits } : {}), ...(b.rename ? { rename: b.rename } : {}) });
    return json({ object: next });
  });
}
