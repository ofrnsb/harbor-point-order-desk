import { isLimit, nextFree, resetAt, rest, usable } from "../platform/gateway/profiles.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { openTurn } from "./mcp-bridge.ts";
import { agentKeyOf } from "../platform/agent-keys.ts";
import { createSdkMcpServer, query, tool, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { domain } from "../domain/index.ts";
import { DATA_DIR } from "./data-dir.ts";
import { contextPrompt } from "../domain/prompt.ts";
import { propose } from "./actions.ts";
import type { ToolCtx } from "./domain.ts";
import { PresentShape, resolveBlocks, type BlockInput } from "./blocks.ts";
import { legoCatalog } from "./lego/index.ts";
import { localLabel, nowLocal } from "./time.ts";
import type { Action, Block, Chat, Message, Result, StreamEvent, TraceStep } from "./types.ts";
import type { AccessTouch, Effective, ModelRoute, ModelUse, Principal, Project } from "../platform/contract.ts";
import { excludedByProject, narrowToProject, projectPrompt } from "../platform/projects.ts";
import { resolveEffective } from "../platform/org.ts";
import { budgetStatus, chooseRoute } from "../platform/policy.ts";
import { record } from "../platform/audit.ts";
import { addUsage, list } from "../platform/store.ts";
import { modelCost } from "../platform/gateway/pricing.ts";
import { gatewayUrl } from "../platform/gateway/litellm.ts";
import { candidateRoutes, historyMessages, runLoop, withFallback } from "../platform/gateway/loop.ts";
import { CATALOG, CORE, TURN, presentDesc } from "../copy/agent.ts";
import { AGENT, CODEX, GATEWAY, SDK_ENV_KEEP } from "../config/server.ts";
import { META_TOOLS, PRESENT_TOOL } from "../config/tools.ts";
import { catalogHost, toolIndex, type CatalogTool } from "./tool-catalog.ts";
import { env } from "../config/env.ts";
import { HOUR_MS, LOCALE, TIME_ZONE } from "../config/locale.ts";
import { moneyText } from "./values.ts";
import { theAgent } from "../domain/agent.ts";
import { API } from "../config/routes.ts";

const g = globalThis as unknown as { starterResults?: Map<string, Map<string, Result | Action>>; starterBusy?: Set<string> };
const registries = (g.starterResults ??= new Map());
export const busy = (g.starterBusy ??= new Set());

const SERVER = AGENT.mcpServer;
const CWD = path.join(DATA_DIR, AGENT.workDir);
const KEYED_CONFIG_DIR = path.join(DATA_DIR, AGENT.keyedConfigDir);

/** The child's environment. With the person's own API key it gets that key and an empty config folder, so the host's
 * Claude login (and the account details it carries) never reaches the agent; otherwise it runs on the host login. */
function sdkEnv(profile: string | undefined, ownKey: string | null): Record<string, string> {
  // Whitelist: an ANTHROPIC_API_KEY in process.env would switch the child to API billing.
  const out: Record<string, string> = {};
  for (const k of SDK_ENV_KEEP) { const v = env.get(k); if (v) out[k] = v; }
  if (ownKey) {
    delete out.CLAUDE_CODE_OAUTH_TOKEN;
    fs.mkdirSync(KEYED_CONFIG_DIR, { recursive: true });
    return { ...out, ANTHROPIC_API_KEY: ownKey, CLAUDE_CONFIG_DIR: KEYED_CONFIG_DIR };
  }
  if (profile) out.CLAUDE_CONFIG_DIR = profile;
  return out;
}

const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: s }], ...(isError ? { isError: true } : {}) });

/** Without a session (first turn, or the transcript is gone) the agent still gets the recent conversation. */
export function recap(chat: Pick<Chat, "messages">, max = AGENT.recapMessages): string {
  // An attachment stays readable in a later turn: the recap names it with its id.
  const lines = chat.messages.slice(-max).map((m) => `${m.role === "user" ? TURN.recapUser : TURN.recapAgent}: ${m.text.replace(/\s+/g, " ").slice(0, AGENT.recapChars)}`);
  return lines.length ? TURN.recap(lines.join("\n")) : "";
}

type Attempt = { answer: string; trace: TraceStep[]; usage: { input: number; output: number }; failure: string | null; progressed: boolean; sessionId: string | null };

export async function runTurn(opts: { chat: Chat; principal: Principal; project?: Project | null; userText: string; /** The app's own address, for agents that reach its tools over HTTP (Codex). */ origin?: string; emit: (e: StreamEvent) => void; signal: AbortSignal }): Promise<{ message: Message; sessionId: string | null }> {
  const { chat, principal, userText, emit, signal } = opts;
  const agent = theAgent();
  const finish = (error: string, sessionId = chat.sessionId): { message: Message; sessionId: string | null } => {
    emit({ t: "error", message: error });
    return { message: { id: crypto.randomUUID(), role: "agent", text: "", blocks: [], trace: [], error, at: new Date().toISOString(), trail: { touches: [], model: null } }, sessionId };
  };

  let eff: Effective;
  let excluded: string[] = [];
  try {
    const team = resolveEffective(principal.userId, principal.unitId);
    eff = narrowToProject(team, opts.project ?? null);
    excluded = excludedByProject(team, eff);
  }
  catch (err) { return finish(err instanceof Error ? err.message : String(err)); }
  if (!eff.can.read) return finish(TURN.roleCannotUse(eff.unit.name));
  const ownKey = agentKeyOf(principal.userId);
  if (!ownKey && env.agentKeyRequired) return finish(TURN.needsAgentKey);

  const routes = list("route", eff.tenant.id);
  let choice: ReturnType<typeof chooseRoute>;
  try { choice = chooseRoute(eff, routes); }
  catch (err) { return finish(err instanceof Error ? err.message : String(err)); }

  // A limit of 0 means no limit was set anywhere on the path.
  const budget = budgetStatus(eff);
  if (budget.limit > 0 && budget.used >= budget.limit) {
    const owner = eff.path.find((u) => u.id === budget.bindingUnitId)?.name ?? eff.unit.name;
    return finish(TURN.budgetSpent(owner, moneyText(budget.used), moneyText(budget.limit)));
  }

  const reg = registries.get(chat.id) ?? new Map<string, Result | Action>();
  registries.set(chat.id, reg);
  if (reg.size > AGENT.resultsPerChat) for (const k of [...reg.keys()].slice(0, reg.size - AGENT.resultsPerChat)) reg.delete(k);

  const blocks: Block[] = [];
  const touches: AccessTouch[] = [];
  const actor = { userId: principal.userId, unitId: principal.unitId, role: eff.role };
  // Every tool: what a call may touch is the person's scope, checked inside each tool.
  const tools = domain.tools;
  let model: ModelUse = choice.use;

  const ctx: ToolCtx = {
    chatId: chat.id,
    projectId: opts.project?.id ?? null,
    result: (id) => { const r = reg.get(id); return r && "kind" in r ? (r as Result) : undefined; },
    save: (r) => { const saved = { ...r, id: `r_${crypto.randomUUID().slice(0, 6)}` } as never as Result; reg.set(saved.id, saved); return saved as never; },
    propose: async (p) => { const a = await propose({ ...p, chatId: chat.id }); reg.set(a.id, a); return a; },
    principal, eff, external: choice.external,
    touch: (t) => { const full = { ...t, id: `tc_${crypto.randomUUID().slice(0, 8)}` }; touches.push(full); emit({ t: "touch", touch: full }); return full; },
  };

  const present = async (input: BlockInput[]) => {
    const r = resolveBlocks(input, reg);
    for (const b of r.blocks) { blocks.push(b); emit({ t: "block", block: b }); }
    if (!r.blocks.length) return { text: TURN.nothingShown(r.problems.join("; ")), isError: true };
    return { text: TURN.shown(r.problems.join("; "), r.blocks.some((b) => b.type === "form" || b.type === "choices" || b.type === "confirm")), isError: false };
  };
  const catalog: CatalogTool[] = [
    ...tools.map((t): CatalogTool => ({
      name: t.name, category: t.category, description: t.description, shape: t.shape,
      label: (input) => { const l = t.label(input); return { kind: "tool", label: l.running, doneLabel: l.done, ...(l.writing ? { writing: l.writing } : {}) }; },
      call: async (args) => ({ text: await t.run(args, ctx), isError: false }),
    })),
    {
      name: PRESENT_TOOL, category: "answer", description: presentDesc(legoCatalog()), shape: PresentShape,
      label: () => ({ kind: "tool", label: TURN.presenting, doneLabel: TURN.presented }),
      call: (args) => present((args as { blocks: BlockInput[] }).blocks),
    },
  ];
  const host = catalogHost(catalog);

  const system = `${CORE}${CATALOG.index(toolIndex(catalog))}\n\n${domain.prompt}\n\n${contextPrompt(eff, agent)}${opts.project ? `\n\n${projectPrompt(opts.project, excluded)}` : ""}`;
  const now = nowLocal(eff.tenant.timezone);
  const header = [TURN.now(localLabel(now, eff.tenant.timezone), now.slice(0, 10)), ...chat.notes.map(TURN.sinceLast)];
  fs.mkdirSync(CWD, { recursive: true });

  async function viaSdk(route: ModelRoute, resume: string | null): Promise<Attempt> {
    const OURS = new Set(host.tools.map((t) => `mcp__${SERVER}__${t.name}`));
    const server = createSdkMcpServer({
      name: SERVER, version: AGENT.serverVersion,
      tools: host.tools.map((t) => tool(t.name, t.description, t.shape, async (args: Record<string, unknown>) => {
        try { const r = await host.call(t.name, args); return text(r.text, r.isError); }
        catch (err) { return text(err instanceof Error ? err.message : String(err), true); }
      })),
    });
    let writing: { id: string; l: NonNullable<ReturnType<typeof labelFor>>; items: number; tail: string; at: number } | null = null;
    const labelFor = (name: string, input: Record<string, unknown>) => {
      return name.startsWith(`mcp__${SERVER}__`) ? host.label(name.slice(`mcp__${SERVER}__`.length), input) : null;
    };
    const canUseTool: CanUseTool = async (name, input) => {
      return OURS.has(name) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: TURN.notInApp };
    };
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal.addEventListener("abort", onAbort);
    const a: Attempt = { answer: "", trace: [], usage: { input: 0, output: 0 }, failure: null, progressed: false, sessionId: resume };

    async function run(resumeId: string | null, profile: string | undefined): Promise<string | null> {
      const started = new Map<string, { at: number; l: NonNullable<ReturnType<typeof labelFor>> }>();
      let failure: string | null = null;
      let toolSinceText = false;
      let held = "";
      const text = [...header, resumeId ? "" : recap({ messages: chat.messages.slice(0, -1) }), userText].filter(Boolean).join("\n\n");
      for await (const m of query({
        prompt: text,
        options: {
          cwd: CWD, model: route.model, systemPrompt: system, tools: [], mcpServers: { [SERVER]: server }, strictMcpConfig: true,
          settingSources: [], permissionMode: "default", canUseTool,
          includePartialMessages: true, thinking: AGENT.thinking, maxTurns: AGENT.maxTurns, maxBudgetUsd: AGENT.maxBudgetUsd, abortController: abort, env: sdkEnv(profile, ownKey), ...(resumeId ? { resume: resumeId } : {}),
        },
      })) {
        if (m.type === "system" && m.subtype === "init") a.sessionId = m.session_id;
        else if (m.type === "stream_event") {
          const ev = m.event;
          if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
            toolSinceText = true;
            // The step shows the moment the agent starts writing it: a large call (a whole screen of bricks) can take minutes
            // to write, and the person sees it being written rather than a still screen.
            // Only a tool that says what it is doing while it is still being written ("Planning the board"): its working
            // label ("Drawing on the board") waits until the drawing really starts.
            const l0 = labelFor(ev.content_block.name, {});
            const w0 = l0 && "writing" in l0 && typeof l0.writing === "string" ? l0.writing : "";
            const l = l0 && w0 ? { kind: l0.kind, label: w0, doneLabel: l0.doneLabel } : null;
            if (l) { const w = { id: ev.content_block.id, l, items: 0, tail: "", at: 0 }; writing = w; a.progressed = true; emit({ t: "step", id: w.id, ...l, status: "running" }); }
            else writing = null;
            // Text written before a step is narration ("I am now...", "here is..."): drop it. Text before a tool run
            // (which may be the answer being shown) is kept aside, and comes back only if the model says nothing after.
            if (a.answer.trim()) { held = ev.content_block.name.endsWith(META_TOOLS.run) ? a.answer : ""; a.answer = ""; emit({ t: "reset" }); }
          }
          else if (ev.type === "content_block_delta" && ev.delta.type === "input_json_delta" && writing) {
            // Counts the items written so far (each has a "key"), told at most every `writingMs`.
            const w = writing, chunk = w.tail + ev.delta.partial_json;
            w.items += (chunk.match(/"key"\s*:/g) ?? []).length - (w.tail.match(/"key"\s*:/g) ?? []).length;
            w.tail = chunk.slice(-12);
            const now = Date.now();
            if (w.items && now - w.at > AGENT.writingMs) { w.at = now; emit({ t: "step", id: w.id, ...w.l, label: TURN.writingItems(w.l.label, w.items), status: "running" }); }
          }
          else if (ev.type === "content_block_start" && ev.content_block.type === "thinking") emit({ t: "think", d: "", fresh: true });
          else if (ev.type === "content_block_delta" && ev.delta.type === "thinking_delta") emit({ t: "think", d: ev.delta.thinking });
          else if (ev.type === "content_block_start" && ev.content_block.type === "text") {
            // Text after a tool call continues the answer as a new paragraph; what was already said stays where it is.
            if (toolSinceText && a.answer.trim()) { a.answer += "\n\n"; emit({ t: "text", d: "\n\n" }); }
            toolSinceText = false;
          } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { a.answer += ev.delta.text; a.progressed = true; emit({ t: "text", d: ev.delta.text }); }
        } else if (m.type === "assistant") {
          for (const b of m.message.content) {
            if (b.type !== "tool_use") continue;
            const l = labelFor(b.name, (b.input ?? {}) as Record<string, unknown>);
            if (!l) continue;
            a.progressed = true;
            started.set(b.id, { at: Date.now(), l });
            emit({ t: "step", id: b.id, ...l, status: "running" });
          }
        } else if (m.type === "user" && Array.isArray(m.message.content)) {
          for (const b of m.message.content) {
            if (b.type !== "tool_result") continue;
            const s = started.get(b.tool_use_id);
            if (!s) continue;
            started.delete(b.tool_use_id);
            const body = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c) => ("text" in c ? c.text : "")).join("\n") : "";
            const status = b.is_error ? "failed" : "done";
            const detail = body.split("\n")[0].slice(0, GATEWAY.traceDetailChars);
            a.trace.push({ id: b.tool_use_id, kind: s.l.kind, label: s.l.doneLabel, detail, status, ms: Date.now() - s.at });
            emit({ t: "step", id: b.tool_use_id, ...s.l, status, detail });
          }
        } else if (m.type === "result") {
          a.usage.input += (m.usage?.input_tokens ?? 0) + (m.usage?.cache_read_input_tokens ?? 0) + (m.usage?.cache_creation_input_tokens ?? 0);
          a.usage.output += m.usage?.output_tokens ?? 0;
          if (!a.answer.trim() && held) { a.answer = held; emit({ t: "text", d: held }); }
          if (m.is_error || m.subtype !== "success") failure = m.subtype === "success" ? m.result : TURN.stoppedEarly(m.subtype);
        }
      }
      return failure;
    }

    try {
      // Each login in turn: one that hits its usage limit rests until its reset time and the next one carries the turn.
      let failure: string | null = null;
      let limited = false;
      for (const profile of ownKey ? [undefined] : usable()) {
        let sessionId = resume;
        try { failure = await run(sessionId, profile); } catch (err) { failure = err instanceof Error ? err.message : String(err); }
        // A session lives in the login that made it; another login starts fresh from the recap.
        if (failure && /no conversation found/i.test(failure) && sessionId) { a.sessionId = sessionId = null; failure = await run(null, profile); }
        const loggedOut = !!failure && /not logged in|authenticate/i.test(failure);
        if (!failure || signal.aborted || (!isLimit(failure) && !loggedOut)) break;
        // A login that is out of quota rests until its reset, one that is not signed in rests an hour, whatever the
        // turn already showed, so the next turn never starts on it.
        rest(profile, loggedOut ? Date.now() + HOUR_MS : resetAt(failure));
        // Real work already done on this login (a step run, an answer given) is not repeated on another; a turn that
        // only showed the limit notice moves to the next login with that notice cleared.
        if (a.progressed && !isLimit(a.answer)) break;
        if (a.answer) { a.answer = ""; emit({ t: "reset" }); }
        a.progressed = false;
        limited = true;
        a.sessionId = null;
      }
      if (failure && isLimit(failure)) { const at = nextFree(); a.failure = TURN.atCapacity(at ? new Date(at).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }) : null); }
      else if (failure) a.failure = signal.aborted ? TURN.stopped : /not logged in|authenticate/i.test(failure) ? TURN.notLoggedIn : failure;
      else if (limited) a.failure = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      a.failure = signal.aborted ? TURN.stopped : /not logged in/i.test(msg) ? TURN.notLoggedIn : msg;
      if (signal.aborted) a.progressed = true;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return a;
  }

  async function viaGateway(route: ModelRoute): Promise<Attempt> {
    const base = gatewayUrl();
    if (!base) return { answer: "", trace: [], usage: { input: 0, output: 0 }, failure: TURN.noGateway, progressed: false, sessionId: null };
    const r = await runLoop({
      baseUrl: base, apiKey: env.litellmKey ?? null, route, system,
      history: historyMessages({ messages: chat.messages.slice(0, -1) }),
      userText: [...header, userText].join("\n\n"),
      host, emit, signal,
    });
    return { ...r, sessionId: null };
  }

  async function viaCodex(route: ModelRoute, resume: string | null): Promise<Attempt> {
    const a: Attempt = { answer: "", trace: [], usage: { input: 0, output: 0 }, failure: null, progressed: false, sessionId: resume };
    const home = env.codexHome ?? path.join(os.homedir(), CODEX.homeDir);
    if (!fs.existsSync(path.join(home, "auth.json"))) return { ...a, failure: TURN.codexNotLoggedIn(home) };
    if (!opts.origin) return { ...a, failure: TURN.codexNoOrigin };
    const turn = openTurn(host, CODEX.turnMs);
    const work = path.join(CWD, "codex");
    fs.mkdirSync(work, { recursive: true });
    const set = (k: string, v: unknown) => ["--config", `${k}=${JSON.stringify(v)}`];
    const args = [
      "exec", "--experimental-json", "--ignore-user-config", "--skip-git-repo-check", "--sandbox", "read-only", "--cd", work,
      ...set(`mcp_servers.${CODEX.mcpServer}.url`, `${opts.origin}${API.mcp}`),
      ...set(`mcp_servers.${CODEX.mcpServer}.bearer_token_env_var`, CODEX.tokenEnv),
      ...set(`mcp_servers.${CODEX.mcpServer}.default_tools_approval_mode`, "approve"),
      ...CODEX.featuresOff.flatMap((f) => set(`features.${f}`, false)),
      ...set("web_search", "disabled"),
      ...set("approval_policy", "never"),
      ...set("model_reasoning_effort", CODEX.reasoning),
      ...set("developer_instructions", system),
      ...(route.model && route.model !== "default" ? ["--model", route.model] : []),
      ...(resume ? ["resume", resume] : []),
    ];
    const childEnv: Record<string, string> = { CODEX_HOME: home, [CODEX.tokenEnv]: turn.token };
    for (const k of CODEX.envKeep) { const v = env.get(k); if (v) childEnv[k] = v; }
    // Only these variables reach Codex: no OPENAI_API_KEY (it would switch the login to API billing), no app secrets.
    const child = spawn(CODEX.bin, args, { env: childEnv as unknown as NodeJS.ProcessEnv, cwd: work, stdio: ["pipe", "pipe", "pipe"] });
    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort);
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString()).slice(-CODEX.stderrChars * 4); });
    const exited = new Promise<number | null>((resolve) => { child.once("exit", (code) => resolve(code)); child.once("error", () => resolve(-1)); });
    child.stdin.end([...header, resume ? "" : recap({ messages: chat.messages.slice(0, -1) }), userText].filter(Boolean).join("\n\n"));
    const started = new Map<string, { at: number; l: NonNullable<ReturnType<typeof host.label>> }>();
    try {
      for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) {
        let e: { type?: string; thread_id?: string; item?: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string }; message?: string };
        try { e = JSON.parse(line); } catch { continue; }
        const it = e.item ?? {};
        const kind = String(it.type ?? "");
        const id = String(it.id ?? "");
        if (e.type === "thread.started" && e.thread_id) a.sessionId = e.thread_id;
        else if (e.type === "item.started" && kind === "mcp_tool_call") {
          const l = host.label(String(it.tool ?? ""), (it.arguments ?? {}) as Record<string, unknown>);
          if (!l) continue;
          started.set(id, { at: Date.now(), l });
          a.progressed = true;
          emit({ t: "step", id, ...l, status: "running" });
        } else if (e.type === "item.completed" && kind === "mcp_tool_call") {
          const s = started.get(id);
          if (!s) continue;
          const failed = it.status === "failed" || !!(it.result as { isError?: boolean } | undefined)?.isError;
          const detail = failed ? String((it.error as { message?: string } | undefined)?.message ?? "") : "";
          a.trace.push({ id, kind: s.l.kind, label: s.l.doneLabel, detail, status: failed ? "failed" : "done", ms: Date.now() - s.at });
          emit({ t: "step", id, ...s.l, status: failed ? "failed" : "done", ...(detail ? { detail } : {}) });
        } else if (e.type === "item.completed" && kind === "agent_message") a.answer = String(it.text ?? "");
        else if (e.type === "turn.completed") a.usage = { input: e.usage?.input_tokens ?? 0, output: e.usage?.output_tokens ?? 0 };
        else if (e.type === "turn.failed" || e.type === "error") a.failure = TURN.codexFailed(e.error?.message ?? e.message ?? "");
      }
      const code = await exited;
      if (signal.aborted) { a.failure = TURN.stopped; a.progressed = true; }
      else if (code !== 0 && !a.failure) a.failure = /not logged in|401|unauthori[sz]ed|login/i.test(stderr) ? TURN.codexNotLoggedIn(home) : TURN.codexFailed(stderr.trim().slice(-CODEX.stderrChars) || `exit ${code}`);
      if (a.answer && !a.failure) emit({ t: "text", d: a.answer });
    } finally {
      signal.removeEventListener("abort", onAbort);
      turn.close();
    }
    return a;
  }

  const candidates = candidateRoutes(choice.route, routes, eff, choice.external);
  emit({ t: "model", model });

  const { route, result, tried } = await withFallback<Attempt>(
    candidates,
    async (r) => {
      ctx.external = r.external;
      const resume = r.id === chat.model ? chat.sessionId : null;
      return r.backend === "claude-sdk" ? viaSdk(r, resume) : r.backend === "codex-sdk" ? viaCodex(r, resume) : viaGateway(r);
    },
    (to, reason) => {
      model = { routeId: to.id, label: to.label, external: to.external, rerouted: true, reason: TURN.fallbackUsed(reason.slice(0, AGENT.fallbackReasonChars)) };
      emit({ t: "model", model });
    },
  );

  for (const t of tried) {
    const cost = modelCost(t.route, t.result.usage.input, t.result.usage.output);
    if (t.result.usage.input || t.result.usage.output) {
      addUsage({ id: `us_${crypto.randomUUID().slice(0, 12)}`, tenantId: eff.tenant.id, unitId: eff.unit.id, userId: principal.userId, chatId: chat.id, routeId: t.route.id, inputTokens: t.result.usage.input, outputTokens: t.result.usage.output, cost: cost, at: new Date().toISOString() });
    }
    record({ tenantId: eff.tenant.id, actor, kind: "model_call", target: t.route.id, detail: { chatId: chat.id, inputTokens: t.result.usage.input, outputTokens: t.result.usage.output, cost: cost, external: t.route.external, failure: t.result.failure } });
  }

  chat.model = route.id;
  // A turn that ends with no words, no view and no reason is never shown as an empty reply: the person is told.
  if (!result.failure && !result.answer.trim() && !blocks.length && !signal.aborted) result.failure = TURN.emptyReply;
  if (result.failure) emit({ t: "error", message: result.failure });
  return {
    message: { id: crypto.randomUUID(), role: "agent", text: result.answer.trim(), blocks, trace: result.trace, error: result.failure, at: new Date().toISOString(), trail: { touches, model } },
    sessionId: route.backend === "claude-sdk" || route.backend === "codex-sdk" ? result.sessionId : null,
  };
}
