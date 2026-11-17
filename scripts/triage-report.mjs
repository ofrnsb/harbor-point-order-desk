// Runs the agent on the whole inbox through the running app, then writes what happened to each email, so the results
// in docs/ can be replayed and audited. Run `npm run reset` and `npm run dev` first.
// Usage: node --env-file-if-exists=.env.local scripts/triage-report.mjs [base url]
import fs from "node:fs";
import path from "node:path";
import { env } from "../src/config/env.ts";
import { API } from "../src/config/routes.ts";
import { PEOPLE } from "../src/platform/seed/tenant.ts";

const base = process.argv[2] ?? `http://127.0.0.1:${JSON.parse(fs.readFileSync("package.json", "utf8")).config.port}`;
const OUT_DIR = "docs/results";
const RUNNER = "u-sam";
const WAIT = { pollMs: 5000, maxMs: 20 * 60_000 };

const res = await fetch(`${base}${API.auth.login}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: PEOPLE.find((p) => p.id === RUNNER).email, password: env.seedPassword }) });
if (!res.ok) throw new Error(`sign-in failed: HTTP ${res.status}`);
const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
const get = async (p, init = {}) => (await fetch(base + p, { ...init, headers: { cookie, ...(init.headers ?? {}) } })).json();

const started = await get(API.inboxRun, { method: "POST" });
if (!started.run) throw new Error(started.error ?? "the run did not start");
console.log(`agent working on ${started.run.total} emails`);
let q = await get(API.inbox);
for (const until = Date.now() + WAIT.maxMs; q.run.running && Date.now() < until; q = await get(API.inbox)) {
  process.stdout.write(`\r${q.run.done}/${q.run.total}`);
  await new Promise((r) => setTimeout(r, WAIT.pollMs));
}
if (q.run.running) throw new Error("the run did not finish in time");

const rows = q.items.map((t) => ({
  email: t.id, received: t.receivedAt, from: t.fromEmail, state: t.state, kind: t.kind, desk: t.desk,
  customer: t.checked[0]?.customerName ?? null, value: t.checked.reduce((s, c) => s + c.total, 0),
  orders: t.proposals.map((p) => (p.action === "create" ? `create ${p.shipToId ?? "default ship-to"}: ${p.lines.map((l) => `${l.sku} x${l.qty}`).join(", ")}` : `${p.action} ${p.soNumber}`)),
  issues: t.checked.flatMap((c) => c.issues.map((i) => i.code)), flags: t.flags, related: t.related,
  mergedInto: t.mergedInto ?? null, released: t.released?.soNumbers ?? [], summary: t.summary, nextStep: t.nextStep, error: t.error ?? null,
}));
const count = (k) => Object.entries(rows.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] ?? 0) + 1 }), {})).map(([v, n]) => `${v} ${n}`).join(", ");
const cell = (v) => String(v ?? "").replace(/\|/g, "/").replace(/\s+/g, " ");
const md = [
  `# Triage run, ${q.run.finishedAt}`,
  "",
  `${rows.length} emails, ${((Date.parse(q.run.finishedAt) - Date.parse(q.run.startedAt)) / 1000).toFixed(0)} s. States: ${count("state")}. Desks: ${count("desk")}.`,
  "",
  "| Email | State | Kind | Desk | Customer | Value | Orders | Issues | Flags | Summary |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.email} | ${r.state}${r.mergedInto ? ` into ${r.mergedInto}` : ""}${r.released.length ? ` ${r.released.join(", ")}` : ""} | ${r.kind ?? ""} | ${r.desk} | ${cell(r.customer)} | ${r.value ? r.value.toFixed(2) : ""} | ${cell(r.orders.join("; "))} | ${r.issues.join(", ")} | ${r.flags.join(", ")} | ${cell(r.summary)} |`),
  "",
].join("\n");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "run.json"), JSON.stringify({ run: q.run, emails: rows }, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "run.md"), md);
console.log(`\nwrote ${OUT_DIR}/run.json and ${OUT_DIR}/run.md`);
