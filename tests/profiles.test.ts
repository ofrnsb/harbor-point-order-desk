import { test } from "node:test";
import assert from "node:assert/strict";
import { isLimit, resetAt } from "../src/platform/gateway/profiles.ts";

test("a usage-limit error is recognised, other errors are not", () => {
  assert.ok(isLimit("Claude Code returned an error result: You've hit your 5-hour limit · resets 5:40pm (America/New_York)"));
  assert.ok(isLimit("429 Too Many Requests"));
  assert.ok(!isLimit("Claude is not logged in"));
  assert.ok(!isLimit("Tool failed: column not found"));
});

test("the reset time is read in its own time zone, rolling to tomorrow once passed", () => {
  // 10:00 UTC = 05:00 in New York (UTC-5 in November).
  const now = Date.UTC(2026, 10, 11, 10, 0);
  assert.equal(new Date(resetAt("resets 5:40pm (America/New_York)", now)).toISOString(), "2026-11-11T22:40:00.000Z");
  assert.equal(new Date(resetAt("resets 4am (America/New_York)", now)).toISOString(), "2026-11-12T09:00:00.000Z", "4am has passed today: tomorrow");
  assert.equal(resetAt("limit reached", now), now + 3_600_000, "no time given: rest an hour");
  assert.equal(new Date(resetAt("You've hit your weekly limit · resets Nov 14 at 7pm (America/New_York)", now)).toISOString(), "2026-11-15T00:00:00.000Z", "a weekly limit rests until its date");
});
