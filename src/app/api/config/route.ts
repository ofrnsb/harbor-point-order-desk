import path from "node:path";
import { env } from "@/config/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const dir = env.claudeProfile ?? env.claudeConfigDir ?? "";
  return Response.json({ profile: dir ? path.basename(dir) : null, agentKeyRequired: env.agentKeyRequired });
}
