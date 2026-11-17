"use client";
import { AccessTrail } from "@/components/sp/AccessTrail";
import type { Visual } from "@/lib/types";
import type { AccessTrail as Trail } from "@/platform/contract";

// Simpul's signature is the access trail: which systems an answer or record touched, under which scope.
export function Signature({ visual }: { visual: Visual }) {
  if (visual.kind !== "access-trail") return null;
  const data = visual.data as unknown as Partial<Trail>;
  return <AccessTrail trail={{ touches: Array.isArray(data.touches) ? data.touches : [], model: data.model ?? null }} />;
}
