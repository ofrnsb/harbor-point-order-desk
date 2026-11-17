// Fills the history with real conversations by sending each capability prompt through the agent.
// Clears every existing chat first, so manual test turns never linger in the demo history.
// Usage: node scripts/seed-chats.mjs [base url]   (run with the dev server up; uses Haiku to keep it quick)
import fs from "node:fs";
import { ui } from "../src/domain/ui.ts";
import { SESSION } from "./journey.mjs";
import { API } from "../src/config/routes.ts";
import { PEOPLE } from "../src/platform/seed/tenant.ts";
import { env } from "../src/config/env.ts";

const base = process.argv[2] ?? `http://127.0.0.1:${JSON.parse(fs.readFileSync("package.json", "utf8")).config.port}`;
if (!ui.capabilities.length) { console.log("FAILED  src/domain/ui.ts has no capabilities to seed"); process.exit(1); }
const email = PEOPLE.find((p) => p.id === SESSION.userId)?.email ?? "";
const login = await fetch(`${base}${API.auth.login}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: env.seedPassword }) });
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
if (!login.ok || !cookie) { console.log(`FAILED  sign-in as ${SESSION.userId}: HTTP ${login.status}`); process.exit(1); }
const chats = await fetch(`${base}${API.chats}`, { headers: { cookie } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GET ${API.chats}: HTTP ${r.status}`))));
for (const c of chats) {
  const r = await fetch(`${base}${API.chatById(c.id)}`, { method: "DELETE", headers: { cookie } });
  if (!r.ok) { console.log(`FAILED  could not clear chat ${c.id}: HTTP ${r.status}`); process.exit(1); }
}
if (chats.length) console.log(`cleared ${chats.length} chat${chats.length === 1 ? "" : "s"}`);
let failed = 0;
for (const c of ui.capabilities) {
  const res = await fetch(`${base}${API.chat}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ text: c.send, unitId: SESSION.unitId }) });
  const events = res.ok ? (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const done = events.find((e) => e.t === "done")?.message;
  const ok = !!done && !done.error && (done.blocks.length > 0 || done.text.length > 0);
  if (!ok) failed++;
  console.log(`${ok ? "seeded" : "FAILED"}  ${c.title}: ${done ? `${done.blocks.map((b) => b.type).join(", ") || "text"}` : `HTTP ${res.status}`}`);
}
process.exit(failed ? 1 : 0);
