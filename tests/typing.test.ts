import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTyped, TYPE_CPS, TYPE_MAX_CPS, visibleText } from "../src/components/typing.ts";

/** Per-frame speeds (chars per second) while typing out `arrived` characters that are all already there. */
const speeds = (arrived: number, frameMs = 16) => {
  const out: number[] = [];
  let n = 0;
  while (n < arrived && out.length < 10_000) {
    const next = nextTyped(n, arrived, frameMs);
    out.push(((next - n) * 1000) / frameMs);
    n = next;
  }
  return out;
};

test("a short answer types at the readable floor speed, not instantly", () => {
  const ms = speeds(90).length * 16;
  assert.ok(ms >= 950 && ms <= 1050, `90 chars took ${ms}ms`);
});

test("a long answer never types faster than the ceiling", () => {
  const s = speeds(2000);
  assert.ok(Math.max(...s) <= TYPE_MAX_CPS + 0.001, `peaked at ${Math.max(...s)} chars/s`);
  assert.ok(s.length * 16 >= (2000 / TYPE_MAX_CPS) * 1000 - 20, "finished faster than the ceiling allows");
});

test("typing never speeds up at the end: no burst as the backlog drains", () => {
  const s = speeds(800).slice(0, -1);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] <= s[i - 1] + 0.001, `sped up at frame ${i}: ${s[i - 1]} -> ${s[i]}`);
  assert.ok(s.at(-1)! >= TYPE_CPS - 0.001, "slowed below the readable floor");
});

test("text streaming in keeps an even pace instead of jumping with each chunk", () => {
  let n = 0;
  let arrived = 0;
  const s: number[] = [];
  for (let f = 0; f < 120; f++) {
    if (f % 6 === 0) arrived += 40;
    const next = nextTyped(n, arrived, 16);
    s.push(((next - n) * 1000) / 16);
    n = next;
  }
  const moving = s.filter((v) => v > 0);
  assert.ok(Math.max(...moving) / Math.min(...moving) < 4, `speed swung from ${Math.min(...moving)} to ${Math.max(...moving)}`);
});

test("it never shows more than has arrived, and clamps after a stalled frame", () => {
  assert.equal(nextTyped(10, 10, 16), 10);
  assert.equal(nextTyped(50, 20, 16), 20);
  assert.ok(nextTyped(0, 1000, 5000) <= (TYPE_MAX_CPS * 64) / 1000 + 0.001);
});

test("a bold phrase types out already bold, and a half marker never shows", () => {
  const text = "Your refund of **$120,000** is on its way.";
  assert.equal(visibleText(text, 15), "Your refund of ");
  assert.equal(visibleText(text, 16), "Your refund of ");
  assert.equal(visibleText(text, 17), "Your refund of ");
  assert.equal(visibleText(text, 21), "Your refund of **$120**");
  assert.equal(visibleText(text, 26), "Your refund of **$120,000**");
  assert.equal(visibleText(text, 27), "Your refund of **$120,000**");
  assert.equal(visibleText(text, 21.9), "Your refund of **$120**");
  assert.equal(visibleText(text, text.length), text);
  assert.equal(visibleText(text, -3), "");
});
