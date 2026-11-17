import { test } from "node:test";
import assert from "node:assert/strict";
import { epochToLocal, localLabel, zonedToEpoch, zoneLabel } from "../src/lib/time.ts";

test("US zones round-trip and differ by whole hours", () => {
  const e = zonedToEpoch("2026-11-02T07:00", "America/New_York");
  assert.equal(new Date(e).toISOString(), "2026-11-02T12:00:00.000Z", "New York is on standard time (UTC-5) on 2 Nov 2026");
  assert.equal(epochToLocal(e, "America/Chicago"), "2026-11-02T06:00");
  assert.equal(epochToLocal(e, "America/Los_Angeles"), "2026-11-02T04:00");
});

test("day rollover and DST zones", () => {
  const e = zonedToEpoch("2026-11-02T23:30", "America/New_York");
  assert.equal(epochToLocal(e, "UTC"), "2026-11-03T04:30");
  // New York left daylight time on 1 Nov 2026, so 31 Oct is still UTC-4.
  assert.equal(epochToLocal(zonedToEpoch("2026-10-31T12:00", "America/New_York"), "UTC"), "2026-10-31T16:00");
  // London left summer time on 25 Oct 2026.
  assert.equal(epochToLocal(zonedToEpoch("2026-11-01T12:00", "Europe/London"), "UTC"), "2026-11-01T12:00");
});

test("zone labels use the zone's short name at that instant", () => {
  assert.equal(zoneLabel("America/New_York", Date.parse("2026-11-02T12:00:00Z")), "EST");
  assert.equal(zoneLabel("America/New_York", Date.parse("2026-07-01T12:00:00Z")), "EDT");
  assert.equal(localLabel("2026-11-02T07:00", "America/New_York"), "Mon, Nov 2, 07:00 EST");
});

test("rejects malformed local times", () => {
  assert.throws(() => zonedToEpoch("tomorrow", "America/New_York"));
});
