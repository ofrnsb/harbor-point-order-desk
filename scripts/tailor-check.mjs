// Fails a product that kept the foundation's look by default: it must restyle type, shape and feel (not only colour),
// record its layout, home and motion decisions in ui.ts, issue its own receipt artifact, and fill the brief's design sections.
// FOUNDATION_SHELL=1 skips it for the unbranded shell itself.
import fs from "node:fs";

const FOUNDATION_SHELL = process.env.FOUNDATION_SHELL === "1";

if (FOUNDATION_SHELL) {
  console.log("SKIP tailoring (foundation shell)");
  process.exit(0);
}

let failed = 0;
const check = (name, ok, hint) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${hint}`}`); if (!ok) failed++; };
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const tokens = (css) => Object.fromEntries([...css.matchAll(/(--ap-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const shell = tokens(read("src/app/globals.css").split(/\n\}\n/)[0]);
const own = tokens(read("src/domain/domain.css"));
const changed = (names) => names.filter((n) => own[n] !== undefined && own[n] !== shell[n]);
const GROUPS = {
  colour: ["--ap-backdrop", "--ap-accent"],
  type: ["--ap-font", "--ap-font-display", "--ap-type-scale"],
  shape: ["--ap-radius-card", "--ap-radius-composer", "--ap-radius-pill", "--ap-radius-scale"],
  feel: ["--ap-density", "--ap-lift", "--ap-lift-hover", "--ap-float", "--ap-surface", "--ap-sunk", "--ap-hairline", "--ap-measure"],
};
for (const [group, names] of Object.entries(GROUPS)) {
  check(`domain.css restyles ${group}`, changed(names).length > 0, `set one of ${names.join(", ")} to this sector's value`);
}

// --ap- belongs to the shell: a product names its own tokens with its own prefix (--lp-, --sj-), and uses no --ap- token that does not exist.
const ownApTokens = Object.keys(own).filter((n) => !(n in shell));
check("product tokens use the product's own prefix", ownApTokens.length === 0, `rename ${ownApTokens.join(", ")} to the product's prefix, e.g. --xx-name`);
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(css|tsx?|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : [])) : []);
const known = new Set([...Object.keys(shell), ...Object.keys(own), ...[...read("src/app/globals.css").matchAll(/(--ap-[a-z0-9-]+)\s*:/g)].map((m) => m[1]), "--ap-intents", "--ap-board-cols", "--ap-kpi-cols"]);
const unknown = [...new Set(walk("src").flatMap((file) => [...read(file).matchAll(/var\((--ap-[a-z0-9-]+)/g)].map((m) => m[1])))].filter((n) => !known.has(n));
check("every --ap- token used exists", unknown.length === 0, `undefined: ${unknown.join(", ")}`);

const ui = read("src/domain/ui.ts");
for (const key of ["layout", "home", "motionScale"]) {
  check(`ui.ts decides ${key}`, new RegExp(`\\b${key}\\s*:`).test(ui), `set ${key} explicitly, even when the decision is to keep the default`);
}

// The layout and the home may not both stay as shipped: the reference composition is a starting point, never the product.
const layout = (ui.match(/\blayout\s*:\s*"([a-z]+)"/) ?? [])[1] ?? "editorial";
const home = ((ui.match(/\bhome\s*:\s*\[([^\]]*)\]/) ?? [])[1] ?? "").match(/"[a-z-]+"/g)?.join(",") ?? "";
const bespokeStage = !read("src/components/Stage.tsx").includes("const DEFAULT_HOME: HomeSection[] = [\"records\", \"suggestions\"];");
check("the screen is not the shipped reference", layout !== "editorial" || (home !== "" && home !== `"records","suggestions"`) || bespokeStage, "change the layout or the home arrangement to the one picked at Checkpoint 2");

const proposes = /\bpropose\(/.test(read("src/domain/index.ts"));
check("the product issues its own receipt", !proposes || /\breceipt\s*:/.test(read("src/domain/blocks.tsx")), "set blocks.receipt in src/domain/blocks.tsx to the sector's proof (slip, pass, label)");

const brief = read("DESIGN.md");
const section = (title) => (brief.split(new RegExp(`^## ${title}\\s*$`, "m"))[1] ?? "").split(/^## /m)[0].trim();
const TEMPLATE = ["The archetype (`editorial`, `workbench` or `horizon`) and the home arrangement:", "How dense the screens are, the type pairing and scale,"];
for (const [i, title] of ["Layout and home", "Density, type and motion"].entries()) {
  const body = section(title);
  const placeholder = /\b(to be decided|tbd|todo|lorem)\b/i.test(body);
  check(`DESIGN.md decides ${title.toLowerCase()}`, body.length > 40 && !body.startsWith(TEMPLATE[i]) && !placeholder, `write the ${title} decisions and their reasons for this sector (no placeholders)`);
}

const dials = section("Density, type and motion").match(/Dials:\s*density\s*(\d+).*?motion\s*(\d+).*?variance\s*(\d+)/is);
if (dials) {
  const [density, motion] = [Number(dials[1]), Number(dials[2])];
  const set = Number(own["--ap-density"] ?? 1);
  const fits = density <= 3 ? set >= 1.05 : density >= 7 ? set <= 0.95 : set >= 0.9 && set <= 1.1;
  check("--ap-density matches the density dial", fits, `density ${density} wants --ap-density ${density <= 3 ? "1.05 or more" : density >= 7 ? "0.95 or less" : "between 0.9 and 1.1"}, found ${set}`);
  check("the motion dial keeps every component moving", motion >= 4, "motion 4 is the floor: feedback plus enter and exit on every component");
}
check("DESIGN.md sets the three dials", !!dials && dials.slice(1).every((n) => Number(n) >= 1 && Number(n) <= 10), "end Density, type and motion with: Dials: density N, motion N, variance N (1 to 10, each with its reason)");

// Coverage: the product handles every job its customers usually bring, each through a tool that exists or the request fallback.
const domainSource = fs.existsSync("src/domain") ? fs.readdirSync("src/domain", { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f)).map((f) => read(`src/domain/${f}`)).join("\n") : "";
const hasFallback = /\bserviceRequests\(/.test(domainSource);
const tools = new Set([...domainSource.matchAll(/\bname:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]).concat(hasFallback ? ["open_request"] : []));
const rows = section("Coverage").split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1);
const named = [...new Set(rows.flatMap((l) => [...l.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1])))];
check("DESIGN.md covers at least ten customer jobs", rows.length >= 10, `found ${rows.length}; list every job from the sector in interface-design/references/sectors.md`);
check("every job in Coverage has a tool that exists", named.length > 0 && named.every((n) => tools.has(n)), `missing tools: ${named.filter((n) => !tools.has(n)).join(", ") || "none named"}`);
check("jobs without a dedicated tool fall back to a service request", hasFallback, "add serviceRequests([...desks]) from src/lib/requests.ts to the domain's tools and actions");

process.exit(failed ? 1 : 0);
