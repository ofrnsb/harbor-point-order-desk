import type { ModelRoute } from "./contract.ts";
import { CLAUDE_ROUTES } from "../config/server.ts";

/** Routes used by the seeded tenant, not by fresh-company setup. */
export function claudeRoutes(tenantId: string): ModelRoute[] {
  const route = (id: string, label: string, model: "sonnet" | "haiku" | "opus", fallbacks: string[], input: number, output: number): ModelRoute =>
    ({ id, tenantId, label, provider: "claude-login", model, backend: "claude-sdk", external: true, fallbacks, inputPer1M: input, outputPer1M: output, active: true });
  return CLAUDE_ROUTES.map((r) => route(r.id, r.label, r.model, [...r.fallbacks], r.inputPer1M, r.outputPer1M));
}
