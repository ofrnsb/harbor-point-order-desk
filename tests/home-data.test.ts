import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionFirst, byDay, byStatus, parseSections, sectionHasData } from "../src/components/home-data.ts";
import type { Item } from "../src/lib/types.ts";

const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, title: id, fields: [], ...extra });
const NOW = new Date(2026, 10, 3, 9, 30).getTime();
const at = (days: number, h: number, m = 0) => new Date(2026, 10, 3 + days, h, m).toISOString();

test("a preview list keeps known sections once, in order, and rejects junk", () => {
  assert.deepEqual(parseSections("board, agenda,board,unknown"), ["board", "agenda"]);
  assert.equal(parseSections("nope,also-nope"), null);
  assert.equal(parseSections(""), null);
  assert.equal(parseSections(null), null);
});

test("records that need the user lead, otherwise the domain order stays", () => {
  const items = [
    item("ok", { status: { label: "Done", tone: "good" } }),
    item("plain"),
    item("late", { status: { label: "Late", tone: "warn" } }),
    item("failed", { status: { label: "Failed", tone: "bad" } }),
    item("plain2"),
  ];
  assert.deepEqual(attentionFirst(items).map((i) => i.id), ["failed", "late", "plain", "plain2", "ok"]);
});

test("the board has one column per status, in first-seen order, without unlabelled records", () => {
  const items = [
    item("a", { status: { label: "New", tone: "info" } }),
    item("b", { status: { label: "In review", tone: "warn" } }),
    item("c", { status: { label: "New", tone: "info" } }),
    item("d"),
  ];
  const cols = byStatus(items);
  assert.deepEqual(cols.map((c) => [c.label, c.items.map((i) => i.id)]), [["New", ["a", "c"]], ["In review", ["b"]]]);
  assert.equal(cols[1].tone, "warn");
});

test("the agenda shows today onward in time order, grouped by day with readable labels", () => {
  const items = [
    item("yesterday", { at: at(-1, 15) }),
    item("tomorrow-am", { at: at(1, 8) }),
    item("today-late", { at: at(0, 17) }),
    item("today-early", { at: at(0, 7) }),
    item("later", { at: at(4, 10) }),
    item("undated"),
    item("broken", { at: "not a date" }),
  ];
  const days = byDay(items, NOW, "en");
  assert.deepEqual(days.map((d) => d.items.map((i) => i.id)), [["today-early", "today-late"], ["tomorrow-am"], ["later"]]);
  assert.equal(days[0].label, "Today");
  assert.equal(days[1].label, "Tomorrow");
  assert.match(days[2].label, /Saturday/);
  assert.equal(byDay(items, NOW, "es")[0].label, "Hoy", "labels follow the locale they are given");
});

test("a section without data takes no space", () => {
  const panel = { title: "Cases", hint: "", items: [item("x")] };
  assert.equal(sectionHasData("records", panel), true);
  assert.equal(sectionHasData("board", panel), false);
  assert.equal(sectionHasData("agenda", panel, NOW), false);
  assert.equal(sectionHasData("metrics", panel), false);
  assert.equal(sectionHasData("metrics", { ...panel, metrics: [{ label: "Open", value: "3" }] }), true);
  assert.equal(sectionHasData("records", { ...panel, items: [] }), false);
});
