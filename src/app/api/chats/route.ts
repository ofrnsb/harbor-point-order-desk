import { listChats } from "@/lib/store";
import { requireUser } from "@/platform/auth";
import { handle } from "@/platform/route-kit";

export const dynamic = "force-dynamic";

/** Only the signed-in user's chats; ?unitId= narrows to the chats started while acting as that unit. */
export async function GET(req: Request) {
  return handle(async () => {
    const { user } = requireUser(req);
    const unitId = new URL(req.url).searchParams.get("unitId");
    const chats = await listChats(user.id);
    return Response.json(unitId ? chats.filter((c) => c.unitId === unitId) : chats);
  });
}
