import { z } from "zod";
import { runTurn } from "@/lib/agent";
import type { Chat, Message, StreamEvent } from "@/lib/types";
import { requireUser } from "@/platform/auth";
import { resolveEffective } from "@/platform/org";
import { pinsFor } from "@/platform/pins";
import { queueFor } from "@/platform/work";
import { briefKey, briefWhileBuilding, building, freshBrief, keepBrief, queueOf } from "@/platform/home";
import type { Principal } from "@/platform/contract";
import { handle } from "@/platform/route-kit";
import { API } from "@/copy/app-api";
import { HOME_BRIEF_ASK } from "@/copy/agent";
import { LABELS } from "@/copy/ui-labels";
import { API_LIMITS } from "@/config/app";
import { HOME_BRIEF } from "@/config/server";
import { LOCALE, TIME_ZONE } from "@/config/locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  unitId: z.string().min(1).max(API_LIMITS.idMax),
  refresh: z.boolean().optional(),
});

/** The start screen: the agent decides what this person needs first and builds it. Streams like a chat turn. */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? API.badRequest }, { status: 400 });
    const { unitId, refresh } = parsed.data;
    let eff;
    try { eff = resolveEffective(user.id, unitId); } catch { return Response.json({ error: API.notMember }, { status: 403 }); }

    const key = briefKey(user.id, unitId);
    const queue = queueOf(queueFor(user.id, unitId).awaitingMe);
    const encoder = new TextEncoder();
    const line = (e: StreamEvent) => encoder.encode(JSON.stringify(e) + "\n");
    const headers = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };

    const kept = refresh ? null : freshBrief(key, queue);
    if (kept) return new Response(line({ t: "done", message: kept }), { headers });
    const last = refresh ? null : briefWhileBuilding(key, queue);

    const stream = new ReadableStream({
      async start(controller) {
        let open = true;
        const emit = (e: StreamEvent) => { if (!open) return; try { controller.enqueue(line(e)); } catch { open = false; } };
        if (last) emit({ t: "done", message: last.message });
        try {
          let job = building.get(key);
          if (!job) {
            const now = new Date();
            const chat: Chat = {
              id: `${HOME_BRIEF.idPrefix}${crypto.randomUUID().replace(/-/g, "")}`, title: "", createdAt: now.toISOString(), updatedAt: now.toISOString(),
              userId: user.id, unitId, sessionId: null, model: "", messages: [], notes: [],
            };
            const principal: Principal = { tenantId: tenant.id, userId: user.id, unitId };
            const userText = HOME_BRIEF_ASK({
              name: user.name, role: LABELS.role[eff.role] ?? eff.role, unit: eff.unit.name,
              now: now.toLocaleString(LOCALE, { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
              pins: pinsFor(eff, null).slice(0, HOME_BRIEF.pinsShown).map((p) => ({ title: p.title, ask: p.ask })),
            });
            // The build outlives this request: a closed tab still leaves a ready screen for the next open.
            job = runTurn({ chat, principal, userText, emit, signal: new AbortController().signal })
              .then(({ message }) => { keepBrief(key, queue, message); return message; })
              .finally(() => building.delete(key));
            building.set(key, job);
          }
          const message: Message = await job;
          emit({ t: "done", message });
        } catch (err) {
          emit({ t: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          if (open) { open = false; try { controller.close(); } catch { /* client gone */ } }
        }
      },
    });
    return new Response(stream, { headers });
  });
}
