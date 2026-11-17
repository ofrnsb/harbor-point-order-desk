import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { App } from "@/components/App";
import { getSession } from "@/platform/auth";
import { PAGES } from "@/config/routes";

export const dynamic = "force-dynamic";

/** Someone without a session goes straight to sign-in instead of an empty workspace. */
export default async function Page() {
  const session = getSession(new Request("http://internal/", { headers: await headers() }));
  if (!session) redirect(PAGES.signIn);
  return <App />;
}
