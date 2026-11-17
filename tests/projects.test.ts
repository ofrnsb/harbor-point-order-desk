import assert from "node:assert/strict";
import { before, test } from "node:test";
import { seedFixture } from "./fixtures/tenant.ts";

let org: typeof import("../src/platform/org.ts");
let projects: typeof import("../src/platform/projects.ts");
before(async () => {
  await seedFixture();
  org = await import("../src/platform/org.ts");
  projects = await import("../src/platform/projects.ts");
});
const eff = () => org.resolveEffective("u-op", "ar-east");

test("a project narrows the team's scope to its sources and drops actions that write elsewhere", () => {
  const base = eff();
  const systems = Object.keys(base.data);
  assert.ok(systems.length >= 1);
  const [conn] = systems;
  const [object] = Object.keys(base.data[conn]);
  const p = projects.saveProject(base, { name: "East invoices", goal: "", instructions: "", sources: [`${conn}/${object}`] });
  assert.ok(typeof p !== "string", String(p));
  const narrowed = projects.narrowToProject(base, p);
  assert.deepEqual(Object.keys(narrowed.data), [conn]);
  assert.deepEqual(Object.keys(narrowed.data[conn]), [object]);
  assert.deepEqual(narrowed.data[conn][object], base.data[conn][object], "row filters and column modes are kept, never widened");
  assert.ok(narrowed.actions.every((id) => base.actions.includes(id)));
});

test("an empty source list keeps the whole team scope; no project changes nothing", () => {
  const base = eff();
  const p = projects.saveProject(base, { name: "Everything", goal: "", instructions: "", sources: [] });
  assert.ok(typeof p !== "string");
  assert.equal(projects.narrowToProject(base, p), base);
  assert.equal(projects.narrowToProject(base, null), base);
});

test("a project cannot pick a source or an agent outside the team", () => {
  const base = eff();
  assert.match(String(projects.saveProject(base, { name: "x", goal: "", instructions: "", sources: ["c-hr/employees"] })), /outside the team/);
});

test("projects are private to their owner and team", () => {
  const base = eff();
  const p = projects.saveProject(base, { name: "Private", goal: "", instructions: "", sources: [] });
  assert.ok(typeof p !== "string");
  assert.equal(projects.ownedProject(base, p.id)?.id, p.id);
  const other = org.resolveEffective("u-hr", "hr");
  assert.equal(projects.ownedProject(other, p.id), null);
  assert.ok(!projects.projectsFor(other).some((x) => x.id === p.id));
});

test("the project prompt carries goal and instructions and names the data boundary", () => {
  const text = projects.projectPrompt({ id: "p", tenantId: "t", unitId: "u", ownerId: "o", name: "Audit stok", goal: "Temukan selisih stok Q4", instructions: "Jawab dalam tabel.", sources: ["c-erp"], createdAt: "", updatedAt: "" });
  assert.match(text, /Audit stok/);
  assert.match(text, /Temukan selisih stok Q4/);
  assert.match(text, /Jawab dalam tabel\./);
  assert.match(text, /only the objects listed/);
  assert.equal(projects.projectPrompt(null), "");
});

test("the prompt names what the project leaves out, so the agent blames the project, not the team", () => {
  const base = eff();
  const [conn] = Object.keys(base.data);
  const [obj] = Object.keys(base.data[conn]);
  // A team that also reads HR employees; the project keeps only its first object.
  const team = { ...base, data: { ...base.data, "c-hr": { employees: base.data[conn][obj] } } };
  const p = projects.saveProject(base, { name: "One object", goal: "", instructions: "", sources: [`${conn}/${obj}`] });
  assert.ok(typeof p !== "string");
  const left = projects.excludedByProject(team, projects.narrowToProject(team, p));
  assert.deepEqual(left, ["HR.employees (Employees)"]);
  assert.match(projects.projectPrompt(p, left), /Left out by this project, though the team may read them: HR\.employees/);
  assert.match(projects.projectPrompt(p, left), /outside this project \(not outside the team\)/);
  assert.doesNotMatch(projects.projectPrompt(p, []), /Left out/);
});
