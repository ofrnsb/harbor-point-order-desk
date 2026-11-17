import { notFound } from "next/navigation";
import { BrickGallery } from "@/components/BrickGallery";
import { env } from "@/config/env";

/** Dev only: every brick the agent builds answers from, one per frame, in every variant. `?only=chart,table` narrows it. */
export default async function Page({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  if (env.production) notFound();
  return <BrickGallery only={(await searchParams).only} />;
}
