// Cost of a model call in the tenant currency from token counts and the route's prices.
import type { ModelRoute } from "../contract.ts";

export function modelCost(route: Pick<ModelRoute, "inputPer1M" | "outputPer1M">, input: number, output: number): number {
  const raw = (Math.max(0, input) * route.inputPer1M + Math.max(0, output) * route.outputPer1M) / 1_000_000;
  return Math.round(raw * 100) / 100;
}
