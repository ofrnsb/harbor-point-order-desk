// Restores Harbor Point: rebuilds the working ERP from the data pack, then the platform (org, people, connection,
// catalog by real introspection, agents, routes) and clears proposals. Chats, projects and pins are people's work and
// are kept unless --chats.
import fs from "node:fs";
import { DATA_FILES } from "./journey.mjs";
import { seedPlatform } from "../src/platform/seed/tenant.ts";
import { closeAll } from "../src/platform/connectors/index.ts";
import { get, list, listTenants, put } from "../src/platform/store.ts";

const clearChats = process.argv.includes("--chats");
for (const f of [...DATA_FILES, "data/actions.json"]) fs.rmSync(f, { force: true });
if (clearChats) fs.rmSync("data/chats", { recursive: true, force: true });
const projects = clearChats ? [] : listTenants().flatMap((t) => list("project", t.id));
const pins = clearChats ? [] : listTenants().flatMap((t) => list("pin", t.id));
await seedPlatform();
// A kept chat still points at its project, so projects survive too, as long as their team and owner still exist.
for (const p of projects) if (get("unit", p.unitId) && get("user", p.ownerId)) put("project", p);
// A pin outlives the reset when its team, owner and project (if any) do.
for (const p of pins) if (get("unit", p.unitId) && get("user", p.ownerId) && (!p.projectId || get("project", p.projectId))) put("pin", p);
await closeAll();
console.log(`Reset: ERP rebuilt from the data pack, platform seeded${clearChats ? ", chats cleared" : ""}.`);
process.exit(0);
