import { getSession, logoutCookie } from "@/platform/auth";
import { forgetAgentKey } from "@/platform/agent-keys";
import { handle, json } from "@/platform/route-kit";

export const dynamic = "force-dynamic";

/** Ends the session and forgets the API key the person signed in with. */
export async function POST(req: Request) {
  return handle(() => {
    const session = getSession(req);
    if (session) forgetAgentKey(session.user.id);
    const res = json({ ok: true });
    res.headers.append("set-cookie", logoutCookie());
    return res;
  });
}
