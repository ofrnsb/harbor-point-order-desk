import { z } from "zod";
import { busy } from "@/lib/agent";
import { deleteChat, getChat, saveChat } from "@/lib/store";
import { requireUser } from "@/platform/auth";
import { handle } from "@/platform/route-kit";
import { API } from "@/copy/app-api";
import { API_LIMITS } from "@/config/app";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: API.chatNotFound }, { status: 404 });

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user } = requireUser(req);
    const chat = await getChat((await params).id);
    if (!chat || chat.userId !== user.id) return notFound();
    const { sessionId: _s, ...pub } = chat;
    return Response.json({ ...pub, busy: busy.has(chat.id) });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user } = requireUser(req);
    const body = z.object({ title: z.string().trim().min(API_LIMITS.chatTitle.min).max(API_LIMITS.chatTitle.max) }).safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: API.titleLength(API_LIMITS.chatTitle.min, API_LIMITS.chatTitle.max) }, { status: 400 });
    const chat = await getChat((await params).id);
    if (!chat || chat.userId !== user.id) return notFound();
    chat.title = body.data.title;
    await saveChat(chat);
    return Response.json({ id: chat.id, title: chat.title });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user } = requireUser(req);
    const id = (await params).id;
    const chat = await getChat(id);
    if (!chat || chat.userId !== user.id) return notFound();
    if (busy.has(id)) return Response.json({ error: API.stopBeforeDelete }, { status: 409 });
    return (await deleteChat(id)) ? Response.json({ ok: true }) : notFound();
  });
}
