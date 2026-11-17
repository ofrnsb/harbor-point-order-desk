import { notFound } from "next/navigation";
import { BlockStress } from "@/components/BlockStress";
import { env } from "@/config/env";

/** Dev only: every answer block under hostile scenarios. */
export default async function Page({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  if (env.production) notFound();
  return <BlockStress only={(await searchParams).only} />;
}
