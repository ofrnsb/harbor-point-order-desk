
import { z } from "zod";
import { COLUMN_MODES, DB_KINDS, SENSITIVITIES } from "./contract.ts";
import type { OrgUnit, User } from "./contract.ts";
import type { UnitNode } from "./api-types.ts";
import { record } from "./audit.ts";
import { get, memberships } from "./store.ts";
import { COUNT, LEN } from "../config/data.ts";
import { ERR, WORDS } from "../copy/server.ts";
import { SLUG_CHARS } from "../config/server.ts";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

/** Runs a route body; auth helpers throw Responses, which pass through; anything else is a 500 with its message. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try { return await fn(); }
  catch (err) {
    if (err instanceof Response) return err;
    console.error("[api]", err);
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw fail(i ? `${i.path.join(".") || "body"}: ${i.message}` : ERR.badRequest);
  }
  return parsed.data;
}

export function adminAudit(user: User, target: string, detail: Record<string, unknown>) {
  record({ tenantId: user.tenantId, actor: { userId: user.id, unitId: null, role: user.platformRoles.join("+") || "admin" }, kind: "admin", target, detail });
}

/** Loads a tenant-owned document or throws 404, so one tenant can never touch another's records. */
export function owned<K extends Parameters<typeof get>[0]>(kind: K, id: string, tenantId: string) {
  const doc = get(kind, id) as { tenantId?: string } | null;
  if (!doc || doc.tenantId !== tenantId) throw fail(ERR.notFound(kind, id), 404);
  return doc as NonNullable<ReturnType<typeof get<K>>>;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, SLUG_CHARS) || "x";
export const newId = (prefix: string, hint = "") => `${prefix}_${hint ? `${slug(hint)}_` : ""}${crypto.randomUUID().slice(0, 6)}`;

export const emptyProfile = (): OrgUnit["profile"] => ({
  description: "", glossary: [], rules: [], grants: null, actions: null, models: null, clearance: null, budgetMonthly: null, approvalOver: null, attributes: {},
});

// ---------- Schemas ----------
const attr = z.union([z.string().max(LEN.line), z.array(z.string().max(LEN.line)).max(COUNT.huge)]);
const ident = z.string().min(1).max(LEN.ident).regex(/^[A-Za-z0-9_.$ -]+$/, ERR.lettersDigitsSpacesOnly);
export const RowFilterS = z.object({ column: ident, op: z.enum(["eq", "in"]), value: attr });
export const DataGrantS = z.object({
  connectionId: z.string().min(1).max(LEN.key),
  objects: z.union([z.literal("*"), z.array(z.object({ object: ident, columns: z.record(ident, z.enum(COLUMN_MODES)).optional(), rowFilters: z.array(RowFilterS).max(COUNT.l).optional() })).max(COUNT.bulk)]),
});
export const ProfileS = z.object({
  description: z.string().max(LEN.doc),
  glossary: z.array(z.object({ term: z.string().min(1).max(LEN.label), meaning: z.string().min(1).max(LEN.para) })).max(COUNT.max),
  rules: z.array(z.object({ id: z.string().min(1).max(LEN.id), text: z.string().min(1).max(LEN.detail), locked: z.boolean() })).max(COUNT.huge),
  grants: z.array(DataGrantS).max(COUNT.xxl).nullable(),
  actions: z.array(z.string().max(LEN.key)).max(COUNT.max).nullable(),
  models: z.array(z.string().max(LEN.key)).max(COUNT.xxl).nullable(),
  clearance: z.enum(SENSITIVITIES).nullable(),
  budgetMonthly: z.number().min(0).max(1e13).nullable(),
  approvalOver: z.number().min(0).max(1e15).nullable(),
  attributes: z.record(z.string().max(LEN.id), attr),
});
export const CredS = z.object({ user: z.string().max(LEN.line).optional(), password: z.string().max(LEN.para).optional(), url: z.string().max(LEN.long).optional(), token: z.string().max(LEN.para).optional() });
export const ConnectionConfigS = z.object({ file: z.string().trim().min(1).max(LEN.text) });
export const ConnectionInputS = z.object({
  code: z.string().min(2).max(LEN.short).regex(/^[A-Z0-9_-]+$/, ERR.uppercaseLettersDigitsOnly),
  name: z.string().min(2).max(LEN.label), kind: z.enum(DB_KINDS), config: ConnectionConfigS, read: CredS, write: CredS.nullable().optional(),
});
export const ActionFieldS = z.object({
  column: ident, label: z.string().min(1).max(LEN.label), kind: z.enum(["text", "number", "date", "choice"]), required: z.boolean(),
  options: z.array(z.string().max(LEN.label)).max(COUNT.xxl).optional(), fixed: z.union([z.string().max(LEN.line), z.number(), z.boolean()]).optional(),
});
export const ActionTemplateS = z.object({
  id: z.string().min(2).max(LEN.key).regex(/^[a-z0-9_-]+$/).optional(),
  name: z.string().min(2).max(LEN.label), description: z.string().max(LEN.detail), connectionId: z.string().min(1).max(LEN.key),
  object: z.string().min(1).max(LEN.key).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, ERR.tableNameChars),
  op: z.enum(["insert", "update"]), keyColumn: ident.optional(), fields: z.array(ActionFieldS).min(1).max(COUNT.wide),
  amountField: z.string().max(LEN.key).optional(), risk: z.enum(["low", "high"]), owner: z.string().min(1).max(LEN.label),
  receiptPrefix: z.string().min(2).max(LEN.prefix).regex(/^[A-Z]+$/),
}).refine((a) => a.op !== "update" || !!a.keyColumn, { message: ERR.updateActionsNeedKeycolumn, path: ["keyColumn"] });
export const RouteS = z.object({
  id: z.string().min(2).max(LEN.key).regex(/^[a-z0-9_.-]+$/).optional(),
  label: z.string().min(2).max(LEN.name), provider: z.enum(["anthropic", "openai", "gemini", "azure", "bedrock", "vertex", "ollama", "vllm", "claude-login", "codex-login"]),
  model: z.string().min(1).max(LEN.title), backend: z.enum(["litellm", "claude-sdk", "codex-sdk"]), external: z.boolean(),
  fallbacks: z.array(z.string().max(LEN.key)).max(COUNT.s), inputPer1M: z.number().min(0).max(1e9), outputPer1M: z.number().min(0).max(1e9), active: z.boolean(),
}).refine((r) => r.backend !== "claude-sdk" || (r.provider === "claude-login" && ["sonnet", "haiku", "opus"].includes(r.model)), { message: ERR.claudeSdkRoutesUse, path: ["model"] })
  .refine((r) => r.backend !== "litellm" || r.provider !== "claude-login", { message: ERR.claudeLoginRoutesUse, path: ["backend"] })
  .refine((r) => (r.backend === "codex-sdk") === (r.provider === "codex-login"), { message: ERR.codexRoutesUse, path: ["backend"] });

/** The tree in depth-first order, root first, with level names, member counts and children. */
export function unitTree(units: OrgUnit[], levels: string[]): UnitNode[] {
  const kids = new Map<string | null, OrgUnit[]>();
  for (const u of units) kids.set(u.parentId, [...(kids.get(u.parentId) ?? []), u]);
  const counts = new Map<string, number>();
  for (const m of memberships({})) counts.set(m.unitId, (counts.get(m.unitId) ?? 0) + 1);
  const out: UnitNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ ...u, depth, levelName: levels[Math.min(depth, levels.length - 1)] ?? WORDS.unit, members: counts.get(u.id) ?? 0, children: (kids.get(u.id) ?? []).map((c) => c.id) });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

