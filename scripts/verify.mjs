// typecheck, unit tests, production build, static CSS audit, then the end-to-end flow against the running dev server.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = JSON.parse(fs.readFileSync("package.json", "utf8")).config.port;
const APP_URL = process.env.APP_URL ?? `http://127.0.0.1:${port}`;

// The previous verify build's generated route types would be typechecked before the new build replaces them, so a
// route deleted since then fails the typecheck; the build folder is always rebuilt from scratch.
const BUILD_DIR = ".next/verify";
fs.rmSync(BUILD_DIR, { recursive: true, force: true });

// The CSS hiding audit is a tool on the author's machine; elsewhere the step is skipped and says so.
const CSS_AUDIT = path.join(os.homedir(), ".mac/.codex/skills/verify-before-done/ui-hiding-audit.mjs");
const cssAudit = fs.existsSync(CSS_AUDIT) ? `node ${CSS_AUDIT} ${BUILD_DIR}/static --custom src/app/globals.css` : `node -e "console.log('css audit skipped: tool not on this machine')"`;

const steps = [
  ["typecheck", "npx tsc --noEmit"],
  ["unit tests", "node --test tests/*.test.ts"],
  ["tailoring", "node scripts/tailor-check.mjs"],
  // Its own build folder, so a verify run never cleans the builds of the dev servers that are running.
  ["build", `node scripts/build.mjs ${BUILD_DIR}`],
  ["css audit", cssAudit],
  // The journeys write to the demo systems (reminders, leave); the agent rightly refuses duplicates on a later run,
  // so the demo data is restored first. Chats and projects are kept.
  ["demo reset", "node scripts/reset.mjs"],
  ["flow", `node scripts/flow-check.mjs ${APP_URL}`],
];
for (const [name, cmd] of steps) {
  process.stdout.write(`\n== ${name}\n`);
  try { execSync(cmd, { stdio: "inherit" }); }
  catch { console.error(`\nverify FAILED at: ${name}`); process.exit(1); }
}
console.log("\nverify passed");
