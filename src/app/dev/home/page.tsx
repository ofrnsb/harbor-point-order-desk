import { notFound } from "next/navigation";
import { HomePreview } from "@/components/HomePreview";
import { domain } from "@/domain";
import { env } from "@/config/env";

export const dynamic = "force-dynamic";

/** Dev only: every home section rendered with this product's live panel data, to compare arrangements. */
export default async function Page() {
  if (env.production) notFound();
  return <HomePreview panel={await domain.panel()} />;
}
