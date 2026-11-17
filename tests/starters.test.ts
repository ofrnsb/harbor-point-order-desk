import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObject, type RawColumn } from "../src/platform/classify.ts";
import type { CatalogObject } from "../src/platform/contract.ts";
import { dataStarters } from "../src/platform/starters.ts";

const col = (name: string, nativeType = "text", fk?: RawColumn["fk"]): RawColumn => ({ name, nativeType, nullable: true, ...(fk ? { fk } : {}) });
const obj = (name: string, pk: string, cols: RawColumn[]): CatalogObject =>
  ({ ...buildObject({ name, kind: "table", columns: [col(pk), ...cols], primaryKey: [pk], rowEstimate: 10, samples: {} }), connectionId: "c", exposed: true });

const matters = obj("matters", "matter_no", [col("title"), col("status"), col("opened_on", "date")]);
const deadlines = obj("deadlines", "deadline_id", [col("matter_no", "text", { object: "matters", column: "matter_no" }), col("due_date", "date"), col("status")]);
const invoices = obj("invoices", "invoice_no", [col("matter_no", "text", { object: "matters", column: "matter_no" }), col("invoice_date", "date"), col("amount", "numeric"), col("status")]);
const tags = obj("tags", "tag_id", [col("payload", "jsonb")]);

test("a dated deadline asks what is coming up; a plain date asks for the latest", () => {
  const s = dataStarters([deadlines, matters]);
  const due = s.find((x) => x.source === "c/deadlines")!;
  assert.equal(due.kind, "upcoming");
  assert.match(due.send, /in the next 14 days/);
  assert.equal(s.find((x) => x.source === "c/matters")!.kind, "board", "second object takes a different shape");
});

test("what is coming up leads, then the most referenced object; one question per object, shapes vary", () => {
  const s = dataStarters([invoices, deadlines, matters, tags]);
  assert.deepEqual(s.slice(0, 2).map((x) => x.source), ["c/deadlines", "c/matters"]);
  assert.equal(new Set(s.map((x) => x.source)).size, s.length);
  assert.equal(new Set(s.map((x) => x.kind)).size, s.length);
  assert.ok(!s.some((x) => x.source === "c/tags"), "an object with no date, status or measure offers nothing");
});

test("no connected data means no questions, and max is respected", () => {
  assert.deepEqual(dataStarters([]), []);
  assert.equal(dataStarters([invoices, deadlines, matters], 2).length, 2);
});
