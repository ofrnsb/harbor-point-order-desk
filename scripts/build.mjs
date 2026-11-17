// Production build into its own folder that leaves next-env.d.ts as it was.
// `next build` rewrites that file to point at its own dist dir; a dev server running beside it then reloads the page without end.
// usage: node scripts/build.mjs <distDir>
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const dist = process.argv[2];
if (!dist) { console.error("usage: node scripts/build.mjs <distDir>"); process.exit(2); }
const ENV = "next-env.d.ts";
const before = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : null;
const r = spawnSync("npx", ["next", "build"], { env: { ...process.env, SIMPUL_DIST_DIR: dist }, stdio: "inherit" });
if (before !== null && fs.readFileSync(ENV, "utf8") !== before) fs.writeFileSync(ENV, before);
process.exit(r.status ?? 1);
