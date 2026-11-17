import { z } from "zod";
import { decide, getAction } from "@/lib/actions";
import { getChat, saveChat } from "@/lib/store";
import { domain } from "@/domain";
import { requireUser } from "@/platform/auth";
import { cancelWorkItem } from "@/platform/work";
import { handle } from "@/platform/route-kit";
import { API } from "@/copy/app-api";
import { ACTION_ID_PATTERN } from "@/config/app";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const ID = ACTION_ID_PATTERN;
const notFound = () => Response.json({ error: API.actionNotFound }, { status: 404 });

/** The action and its chat, only when the chat belongs to the signed-in user. */
async function ownedAction(id: string, userId: string) {
  if (!ID.test(id)) return null;
  const a = await getAction(id);
  if (!a) return null;
  const chat = await getChat(a.chatId);
  return chat && chat.userId === userId ? { a, chat } : null;
}

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user } = requireUser(req);
    const found = await ownedAction((await params).id, user.id);
    return found ? Response.json({ action: found.a }) : notFound();
  });
}

/** The only path that executes a proposed action: the chat owner's own Confirm. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, tenant } = requireUser(req);
    const id = (await params).id;
    if (!(await ownedAction(id, user.id))) return notFound();
    const body = z.object({ decision: z.enum(["confirm", "cancel"]) }).safeParse(await req.json().catch(() => null));
    if (!body.success) return Response.json({ error: API.decisionInvalid }, { status: 400 });
    const r = await decide(id, body.data.decision, domain.actions);
    if ("error" in r) return Response.json({ error: r.error, action: await getAction(id) }, { status: r.status });

    const a = r.action;
    if (a.status === "cancelled") await cancelWorkItem(tenant.id, a.id);
    const chat = await getChat(a.chatId);
    if (chat) {
      // Keep the saved card in step with the decision, and tell the agent on its next turn.
      for (const m of chat.messages) if (m.role === "agent") m.blocks = m.blocks.map((b) => (b.type === "confirm" && b.action.id === a.id ? { ...b, action: a } : b));
      const receipt = a.receipt?.map((f) => API.notes.receiptLine(f.label, f.value)).join(API.notes.receiptSep);
      chat.notes.push(a.status === "confirmed" ? API.notes.confirmed(a.title, receipt) : a.status === "cancelled" ? API.notes.cancelled(a.title) : API.notes.failed(a.title, a.error));
      await saveChat(chat);
    }
    return Response.json({ action: a }, { status: a.status === "failed" ? 502 : 200 });
  });
}
