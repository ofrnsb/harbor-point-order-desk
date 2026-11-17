import assert from "node:assert/strict";
import { before, test } from "node:test";
import { seedFixture } from "./fixtures/tenant.ts";

let org: typeof import("../src/platform/org.ts");
let pins: typeof import("../src/platform/pins.ts");
let projects: typeof import("../src/platform/projects.ts");
before(async () => {
  await seedFixture();
  org = await import("../src/platform/org.ts");
  pins = await import("../src/platform/pins.ts");
  projects = await import("../src/platform/projects.ts");
});
const op = () => org.resolveEffective("u-op", "ar-east");
const viewer = () => org.resolveEffective("u-view", "ar-east");
const pin = (ask: string, projectId: string | null = null) => ({ projectId, title: ask.slice(0, 20), ask, view: "Tabel" });

test("pins belong to their owner and their place: the team without a project, or one project", () => {
  const a = pins.savePin(op(), pin("Orders on credit hold"));
  assert.ok(typeof a !== "string");
  const p = projects.saveProject(op(), { name: "Order desk", goal: "", instructions: "", sources: [] });
  assert.ok(typeof p !== "string");
  assert.ok(typeof pins.savePin(op(), pin("Open orders by customer", p.id)) !== "string");
  assert.deepEqual(pins.pinsFor(op(), null).map((x) => x.ask), ["Orders on credit hold"]);
  assert.deepEqual(pins.pinsFor(op(), p.id).map((x) => x.ask), ["Open orders by customer"]);
  assert.deepEqual(pins.pinsFor(viewer(), null), [], "another user in the same team sees none of them");
  assert.equal(pins.removePin(viewer(), a.id), false, "and cannot remove them");
});

test("a project the user does not own cannot take pins; the same question twice is one pin; there is a cap", () => {
  const theirs = projects.saveProject(viewer(), { name: "Someone else's", goal: "", instructions: "", sources: [] });
  assert.ok(typeof theirs !== "string");
  assert.equal(typeof pins.savePin(op(), pin("x", theirs.id)), "string");
  const before = pins.pinsFor(op(), null).length;
  pins.savePin(op(), { ...pin("Orders on credit hold"), title: "New title" });
  assert.equal(pins.pinsFor(op(), null).length, before);
  assert.equal(pins.pinsFor(op(), null).find((x) => x.ask === "Orders on credit hold")?.title, "New title");
  for (let i = 0; pins.pinsFor(op(), null).length < pins.MAX_PINS; i++) pins.savePin(op(), pin(`q${i}`));
  assert.match(String(pins.savePin(op(), pin("satu lagi"))), /At most/);
});

test("removing a pin removes only that pin", () => {
  const [first, ...rest] = pins.pinsFor(op(), null);
  assert.equal(pins.removePin(op(), first.id), true);
  assert.deepEqual(pins.pinsFor(op(), null).map((x) => x.id), rest.map((x) => x.id));
});
