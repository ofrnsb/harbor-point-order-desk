import { NextResponse, type NextRequest } from "next/server";
import { env } from "./config/env";

const LOCAL_HOSTS = ["127.0.0.1", "localhost"];
/** Local hosts, plus the public names a deployment is served on (SIMPUL_PUBLIC_HOSTS); any other Host is refused. */
const hosts = () => new Set([...LOCAL_HOSTS, ...env.publicHosts]);

// Refuse unknown Host headers (DNS rebinding) and cross-origin writes.
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!hosts().has(host.replace(/:\d+$/, "").toLowerCase())) return new NextResponse("Unknown host", { status: 421 });
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin !== null) {
      let same = false;
      try { same = new URL(origin).host === host; } catch { /* malformed origin */ }
      if (!same) return new NextResponse("Cross-origin request refused", { status: 403 });
    }
  }
  return NextResponse.next();
}

// Next reads the matcher statically at build time, so it is the one path written as a literal (API in src/config/routes.ts).
export const config = { matcher: "/api/:path*" };
