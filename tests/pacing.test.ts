import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBoundary, phaseAt, T } from "../src/lib/pacing.ts";

test("instant tool still shows a run, then done, then leaves", () => {
  const r = { enterAt: 1000, doneAt: 1001 };
  assert.equal(phaseAt(r, 999), "pending");
  assert.equal(phaseAt(r, 1000 + T.minRun - 1), "running");
  assert.equal(phaseAt(r, 1000 + T.minRun), "done");
  assert.equal(phaseAt(r, 1000 + T.minRun + T.hold), "gone");
  assert.equal(nextBoundary([r], 1001), 1000 + T.minRun);
  assert.equal(nextBoundary([r], 1e9), null);
});

test("slow tool runs until its real result; a failure reads longer, then leaves too", () => {
  assert.equal(phaseAt({ enterAt: 1000, doneAt: 4000 }, 3999), "running");
  assert.equal(phaseAt({ enterAt: 1000, doneAt: 4000 }, 4000), "done");
  const f = { enterAt: 0, doneAt: 10, failed: true };
  assert.equal(phaseAt(f, T.minRun + T.hold), "failed", "still readable after a normal step would have gone");
  assert.equal(phaseAt(f, T.minRun + T.hold * 2), "gone");
  assert.equal(nextBoundary([f], T.minRun + 1), T.minRun + T.hold * 2);
  assert.equal(phaseAt({ enterAt: 0 }, 1e9), "running");
});
