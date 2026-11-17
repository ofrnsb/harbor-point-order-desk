import { z } from "zod";
import { sessionCookie } from "@/platform/auth";
import { record } from "@/platform/audit";
import { currentTenant } from "@/platform/org";
import { pausedFor, signIn } from "@/platform/sign-in";
import { body, fail, handle, json } from "@/platform/route-kit";
import { API } from "@/copy/app-api";
import { AGENT_KEY, PASSWORD } from "@/config/server";
import { env } from "@/config/env";
import { isAgentKey, saveAgentKey } from "@/platform/agent-keys";
import { MINUTE_MS } from "@/config/locale";

export const dynamic = "force-dynamic";

const Credentials = z.object({ email: z.string().trim().max(PASSWORD.maxLength), password: z.string().max(PASSWORD.maxLength), apiKey: z.string().trim().max(AGENT_KEY.maxLength).optional() });

/** Email and password sign-in, with the person's own Anthropic API key when given (required on a deployment without the
 * host's Claude login). Failures get one answer whatever went wrong, and pause after repeated tries. */
export async function POST(req: Request) {
  return handle(async () => {
    const { email, password, apiKey } = await body(req, Credentials);
    if (env.agentKeyRequired && !apiKey) return fail(API.agentKeyRequired, 400);
    if (apiKey && !isAgentKey(apiKey)) return fail(API.agentKeyInvalid, 400);
    const tenant = currentTenant();
    const wait = pausedFor(email);
    if (wait > 0) return fail(API.signInPaused(Math.ceil(wait / MINUTE_MS)), 429);
    const user = signIn(tenant, email, password);
    if (!user) {
      record({ tenantId: tenant.id, actor: { userId: "anonymous", unitId: null, role: "anonymous" }, kind: "denied", target: "sign-in", detail: { email: email.toLowerCase() } });
      return fail(API.signInFailed, 401);
    }
    if (apiKey) saveAgentKey(tenant.id, user.id, apiKey);
    record({ tenantId: tenant.id, actor: { userId: user.id, unitId: null, role: "user" }, kind: "login", target: user.id, detail: { method: "password", agentKey: apiKey ? "own" : "host" } });
    const res = json({ ok: true });
    res.headers.append("set-cookie", sessionCookie(user.id));
    return res;
  });
}
