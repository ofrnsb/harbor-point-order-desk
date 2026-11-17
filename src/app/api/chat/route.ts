import { z } from "zod";
import { busy, runTurn } from "@/lib/agent";
import { createChat, getChat, isChatId, saveChat } from "@/lib/store";
import type { StreamEvent } from "@/lib/types";
import { requireUser } from "@/platform/auth";
import { ownedProject } from "@/platform/projects";
import { resolveEffective } from "@/platform/org";
import type { Principal } from "@/platform/contract";
import { handle } from "@/platform/route-kit";
import { API } from "@/copy/app-api";
import { API_LIMITS, CHAT_TITLE_CHARS } from "@/config/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  chatId: z.string().refine(isChatId).optional(),
  text: z.string().trim().max(API_LIMITS.message, API.messageTooLong(API_LIMITS.message)),
  unitId: z.string().min(1).max(API_LIMITS.idMax).optional(),
  projectId: z.string().min(1).max(API_LIMITS.idMax).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? API.badRequest }, { status: 400 });
    if (!parsed.data.text) return Response.json({ error: API.messageEmpty }, { status: 400 });
    const text = parsed.data.text;
    let chat = parsed.data.chatId ? await getChat(parsed.data.chatId) : null;
    if (parsed.data.chatId && (!chat || chat.userId !== user.id)) return Response.json({ error: API.chatNotFound }, { status: 404 });
    if (chat && busy.has(chat.id)) return Response.json({ error: API.chatBusy }, { status: 409 });

    // The acting unit is fixed when the chat starts, and re-checked on every turn.
    const unitId = chat?.unitId ?? parsed.data.unitId;
    if (!unitId) return Response.json({ error: API.pickUnit }, { status: 400 });
    let eff;
    try { eff = resolveEffective(user.id, unitId); } catch { return Response.json({ error: API.notMember }, { status: 403 }); }
    const projectId = chat ? chat.projectId : parsed.data.projectId;
    const project = projectId ? ownedProject(eff, projectId) : null;
    if (projectId && !project) return Response.json({ error: API.projectGone }, { status: 404 });
    const oneLine = text.replace(/\s+/g, " ").trim();
    chat ??= await createChat(oneLine.length <= CHAT_TITLE_CHARS ? oneLine : `${oneLine.slice(0, CHAT_TITLE_CHARS + 1).replace(/\s+\S*$/, "")}${API.chatTitleEllipsis}`, { model: "", userId: user.id, unitId, ...(project ? { projectId: project.id } : {}) });
    const id = chat.id;
    busy.add(id);
    chat.messages.push({ id: crypto.randomUUID(), role: "user", text, at: new Date().toISOString() });
    chat.updatedAt = new Date().toISOString();
    await saveChat(chat);
    const turnChat = chat;
    const principal: Principal = { tenantId: tenant.id, userId: user.id, unitId };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let open = true;
        const emit = (e: StreamEvent) => { if (!open) return; try { controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")); } catch { open = false; } };
        try {
          emit({ t: "chat", id, title: turnChat.title });
          const { message, sessionId } = await runTurn({ chat: turnChat, principal, project, userText: text, origin: new URL(req.url).origin, emit, signal: req.signal });
          const fresh = (await getChat(id)) ?? turnChat;
          fresh.messages.push(message);
          fresh.sessionId = sessionId;
          fresh.model = turnChat.model;
          // Notes delivered in this turn's prompt are consumed; ones added while it ran stay for the next turn.
          fresh.notes = fresh.notes.filter((n) => !turnChat.notes.includes(n));
          fresh.updatedAt = new Date().toISOString();
          await saveChat(fresh);
          emit({ t: "done", message });
        } catch (err) {
          emit({ t: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          busy.delete(id);
          if (open) { open = false; try { controller.close(); } catch { /* client gone */ } }
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  });
}
