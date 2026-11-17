// Drives the running app end to end and asserts behaviour, not status codes.
// Usage: node scripts/flow-check.mjs [base url]   (defaults to config.port in package.json)
//   VERIFY_AGENT=0 skips the real agent turns; VERIFY_MODEL picks the model for the domain journey (default sonnet).
//   FOUNDATION_SHELL=1 accepts a missing domain journey; only the foundation check sets it.
// The engine checks here are the same for every product. The domain journey lives in scripts/journey.mjs.
// Data files the journey touches are snapshotted and restored, so the check can run any number of times.
import fs from "node:fs";
import path from "node:path";
import * as product from "./journey.mjs";
import { HOME_SECTIONS } from "../src/components/home-data.ts";
import { SCENARIOS } from "../src/components/stress-fixtures.ts";
import { BRICK_GALLERY } from "../src/components/bata/gallery.ts";
import { env } from "../src/config/env.ts";
import { PEOPLE } from "../src/platform/seed/tenant.ts";
import { SIGN_IN_LIMIT } from "../src/config/server.ts";
import { API, PAGES } from "../src/config/routes.ts";

const base = process.argv[2] ?? `http://127.0.0.1:${JSON.parse(fs.readFileSync("package.json", "utf8")).config.port}`;
const agent = env.verifyAgent;
const model = env.verifyModel ?? "sonnet";
const shell = env.foundationShell;
const SNAP = [...product.DATA_FILES, "data/actions.json"].map((f) => path.resolve(f));
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 300)}`); if (!ok) failed++; };
// Every route needs a session. The journey names who drives it (product.SESSION); seeded people sign in with their
// email and the seed password from .env.local.
const signInAs = (email, password) => fetch(`${base}${API.auth.login}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
const emailOf = (userId) => PEOPLE.find((p) => p.id === userId)?.email ?? "";
const login = async (userId) => {
  const res = await signInAs(emailOf(userId), env.seedPassword);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!res.ok || !cookie) throw new Error(`sign-in as ${userId} failed: HTTP ${res.status}`);
  return cookie;
};
const SESSION = product.SESSION ?? null;
let cookie = "";
const call = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const turn = async (body, as = cookie) => {
  const full = body.chatId || !SESSION ? body : { unitId: SESSION.unitId, ...body };
  const res = await fetch(`${base}${API.chat}`, { method: "POST", headers: { "content-type": "application/json", ...(as ? { cookie: as } : {}) }, body: JSON.stringify(full) });
  if (!res.ok) return { status: res.status, events: [], error: await res.text() };
  const raw = await res.text().catch((e) => { throw new Error(`stream from ${API.chat} broke: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""}`); });
  return { status: res.status, events: raw.split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
};

try { await call("GET", API.config); } catch { console.log(`FAIL server not reachable at ${base}: start it with npm run dev`); process.exit(1); }
if (SESSION) {
  const anon = await call("GET", API.chats);
  check("routes refuse a request without a session", anon.status === 401, anon.status);
  const wrong = await signInAs(emailOf(SESSION.userId), `${env.seedPassword}x`);
  const unknown = await signInAs("nobody@harborpointsupply.example", env.seedPassword);
  const [wrongBody, unknownBody] = [await wrong.json(), await unknown.json()];
  check("a wrong password is refused without a session", wrong.status === 401 && !wrong.headers.get("set-cookie"), wrong.status);
  check("an unknown email gets the same answer as a wrong password", unknown.status === 401 && unknownBody.error === wrongBody.error, JSON.stringify([wrongBody, unknownBody]));
  const probe = `probe-${Date.now()}@harborpointsupply.example`;
  for (let i = 0; i < SIGN_IN_LIMIT.failures; i++) await signInAs(probe, "not-the-password");
  const paused = await signInAs(probe, "not-the-password");
  check("repeated failures pause sign-in for that email", paused.status === 429, paused.status);
  const badKey = await fetch(`${base}${API.auth.login}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: emailOf(SESSION.userId), password: env.seedPassword, apiKey: "not-a-key" }) });
  check("a malformed API key is refused before any session is made", badKey.status === 400 && !badKey.headers.get("set-cookie"), badKey.status);
  const keyRequired = (await (await fetch(`${base}${API.config}`)).json()).agentKeyRequired;
  check("the sign-in page learns whether this installation needs a key", typeof keyRequired === "boolean", JSON.stringify(keyRequired));
  cookie = await login(SESSION.userId);
}
await call("GET", SESSION ? API.panelOf(SESSION.unitId) : API.panel); // seeds domain data on first run
const saved = SNAP.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
const created = [];

try {
  let r = await call("GET", API.chats);
  check("history lists as an array", r.status === 200 && Array.isArray(r.json), r.text);
  r = await call("GET", SESSION ? API.panelOf(SESSION.unitId) : API.panel);
  check("context panel returns a list", r.status === 200 && Array.isArray(r.json?.items), r.text);
  r = await call("POST", API.chat, { text: "  " });
  check("empty message is a 400 with a reason", r.status === 400 && /empty/i.test(r.json?.error), r.text);
  r = await call("POST", API.chat, { text: "x".repeat(2001) });
  check("oversized message is a 400", r.status === 400, r.status);
  r = await call("POST", API.chat, { text: "hi", chatId: "nonexistent123" });
  check("unknown chat id is a 404", r.status === 404, r.status);
  r = await call("POST", API.chat, { text: "hi", chatId: "../../etc/passwd" });
  check("traversal chat id is a 400", r.status === 400, r.status);
  r = await call("POST", API.chat, { text: "hi" }, { origin: "http://evil.example" });
  check("cross-origin write is refused", r.status === 403, r.status);
  r = await call("POST", API.action("act_00000000"), { decision: "confirm" });
  check("unknown action is a 404", r.status === 404, r.status);
  // What the browser reported while ob used the app: any console error or hidden key element fails the run.
  r = await call("GET", API.uiGuard);
  const browserErrors = r.json?.errors ?? [];
  const uiIssues = r.json?.ui?.issues ?? [];
  check("the browser reported no console errors", browserErrors.length === 0, browserErrors.map((e) => e.message).join(" | "));
  check("the browser reported no hidden or covered key UI", uiIssues.length === 0, JSON.stringify(uiIssues));
  const panelNow = (await call("GET", SESSION ? API.panelOf(SESSION.unitId) : API.panel)).json;
  r = await call("GET", PAGES.dev.home);
  check("every home section renders in the gallery", r.status === 200 && HOME_SECTIONS.every((s) => r.text.includes(`data-preview="${s}"`)), r.status);
  const stress = await call("GET", PAGES.dev.blocks);
  const unrendered = SCENARIOS.filter((s) => !stress.text.includes(`data-scenario="${s.id}"`)).map((s) => s.id);
  check("every answer block survives its stress scenarios", stress.status === 200 && unrendered.length === 0, `status ${stress.status}, missing ${unrendered.join(", ")}`);
  const bricks = await call("GET", PAGES.dev.bricks);
  const unshown = BRICK_GALLERY.flatMap((g) => g.cases).filter((c) => !bricks.text.includes(`data-case="${c.id}"`)).map((c) => c.id);
  check("every brick renders on its own in every variant", bricks.status === 200 && unshown.length === 0 && !bricks.text.includes("data-problem"), `status ${bricks.status}, missing ${unshown.join(", ")}`);
  const items = panelNow?.items ?? [];
  const today = new Date().setHours(0, 0, 0, 0);
  const expected = [
    ["ap-spot-card", items.length > 0],
    ["ap-next-row", items.length > 0],
    ["ap-board-col", items.some((i) => i.status)],
    ["ap-agenda-row", items.some((i) => i.at && Date.parse(i.at) >= today)],
    ["ap-kpi\"", (panelNow?.metrics?.length ?? 0) > 0],
  ].filter(([, has]) => has).map(([marker]) => marker);
  const first = items[0]?.title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const missing = expected.filter((m) => !r.text.includes(m));
  check("each home section with data renders it", missing.length === 0 && (!first || r.text.includes(first)), `missing ${missing.join(", ") || first}`);

  if (agent) {
    console.log("  agent turn (haiku): engine");
    const t0 = await turn({ text: "Hello. In one sentence, what can you help me with?", model: "haiku" });
    const chat = t0.events.find((e) => e.t === "chat");
    if (chat) created.push(chat.id);
    const steps = t0.events.filter((e) => e.t === "step");
    const done = t0.events.find((e) => e.t === "done");
    check("a turn streams a chat id first", t0.events[0]?.t === "chat", JSON.stringify(t0.events[0] ?? t0.error));
    check("every running step finishes", steps.filter((s) => s.status === "running").every((s) => steps.some((d) => d.id === s.id && d.status !== "running")), JSON.stringify(steps));
    check("a turn ends with an answer and no error", !!done?.message?.text && done.message.error === null, JSON.stringify(done?.message ?? t0.events.at(-1)));

    if (chat) {
      const pending = turn({ chatId: chat.id, text: "Thanks. Reply with one word.", model: "haiku" });
      await new Promise((res) => setTimeout(res, 700));
      r = await call("POST", API.chat, { chatId: chat.id, text: "another" });
      check("second message while busy is a 409", r.status === 409, r.status);
      r = await call("DELETE", API.chatById(chat.id));
      check("delete while busy is a 409", r.status === 409, r.status);
      await pending;
      r = await call("PATCH", API.chatById(chat.id), { title: "" });
      check("blank rename is a 400", r.status === 400, r.status);
      r = await call("PATCH", API.chatById(chat.id), { title: "Verify run" });
      check("rename persists", r.status === 200 && (await call("GET", API.chats)).json?.some((c) => c.id === chat.id && c.title === "Verify run"), r.text);
    }

    if (product.journey) await product.journey({ call, turn, check, created, model, login, base });
    else check("the product has a domain journey in scripts/journey.mjs", shell, "export journey(ctx) and DATA_FILES");
  } else console.log("  agent turns skipped (VERIFY_AGENT=0)");
} catch (err) {
  check("journey ran to the end without crashing", false, err?.stack ?? err);
} finally {
  // A chat made as another user is deleted as that user; deleting with the default session would be refused and leave it in their history.
  for (const c of created) {
    const r = typeof c === "string" ? await call("DELETE", API.chatById(c)) : await call("DELETE", API.chatById(c.id), undefined, { cookie: c.as });
    if (r.status >= 400) console.log(`  could not delete test chat ${typeof c === "string" ? c : c.id}: ${r.status}`);
  }
  SNAP.forEach((f, i) => { if (saved[i]) fs.writeFileSync(f, saved[i]); else if (fs.existsSync(f)) fs.rmSync(f); });
}
if (agent && product.journey && product.restored) product.restored(check);
process.exit(failed ? 1 : 0);
