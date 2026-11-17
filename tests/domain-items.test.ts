import { test } from "node:test";
import assert from "node:assert/strict";
import { localTimes, toItem } from "../src/domain/index.ts";
import type { CatalogObject, Connection } from "../src/platform/contract.ts";

const conn = { code: "HR" } as Connection;
const leave = { name: "leave_requests", label: "Time-off requests", primaryKey: ["request_no"], columns: [] } as unknown as CatalogObject;
const row = { request_no: "LV-2026-03190", employee_no: "EMP-0042", leave_type: "Annual leave", start_date: "2026-03-12", end_date: "2026-03-14", days: 3, reason: "Family event", status: "submitted", approver_no: "EMP-0007", created_at: "2026-03-01T02:00:00Z", decided_at: null };

test("record without a name column shows its own facts, not the table label", () => {
  const it = toItem(conn, leave, row);
  assert.equal(it.title, "LV-2026-03190");
  assert.equal(it.subtitle, "Annual leave · Mar 12, 2026 – Mar 14, 2026 · 3 days");
  const labels = it.fields.map((f) => f.label);
  for (const shown of ["request_no", "leave_type", "start_date", "end_date", "days", "status"]) assert.ok(!labels.includes(shown), `${shown} is already in the title or muted line`);
  assert.ok(labels.includes("reason") && labels.includes("employee_no"));
  assert.equal(it.action?.label, "Open related data");
});

test("status values read as words and keep their tone", () => {
  assert.deepEqual(toItem(conn, leave, row).status, { label: "Submitted", tone: "warn" });
  assert.deepEqual(toItem(conn, leave, { ...row, status: "approved" }).status, { label: "Approved", tone: "good" });
  assert.equal(toItem(conn, leave, { ...row, status: "awaiting_signature" }).status?.label, "Awaiting signature", "an unknown status reads as words");
});

test("record with a name column keeps key and label as its muted line", () => {
  const emp = { name: "employees", label: "Employees", primaryKey: ["employee_no"], columns: [] } as unknown as CatalogObject;
  const it = toItem(conn, emp, { employee_no: "EMP-0042", full_name: "Megan Sullivan", status: "active" });
  assert.equal(it.title, "Megan Sullivan");
  assert.equal(it.subtitle, "EMP-0042 · Employees");
});

test("an auto-numbered lab result is named by its sample and parameter and reads with its unit", () => {
  const results = { name: "results", label: "Test results", primaryKey: ["result_id"], columns: [
    { name: "result_id", type: "number" }, { name: "sample_no", type: "text", fk: { object: "samples", column: "sample_no" } },
    { name: "param_code", type: "text", fk: { object: "parameters", column: "param_code" } }, { name: "value", type: "number" }, { name: "unit", type: "text" },
  ] } as unknown as CatalogObject;
  const it = toItem({ code: "LIMS" } as Connection, results, { result_id: 2762, sample_no: "LAB-26-08510", param_code: "EM-PART", value: 231.428, unit: "mg/Nm³", limit_max: 150, status: "verified" });
  assert.equal(it.title, "LAB-26-08510 · EM-PART");
  assert.equal(it.subtitle, "231.428 mg/Nm³");
  // Without a unit column, bare numbers stay out of the muted line.
  assert.equal(toItem(conn, leave, { ...row, request_no: "LV-1" }).subtitle, "Annual leave · Mar 12, 2026 – Mar 14, 2026 · 3 days");
});

test("instants reach the agent in company time, dates and other values untouched", () => {
  const r = localTimes({ due_at: "2026-10-29T17:00:00.000Z", analyzed: new Date("2026-10-29T03:00:00Z"), start_date: "2026-03-12", n: 3, note: "T-shirt" }, "America/New_York");
  assert.deepEqual(r, { due_at: "2026-10-29 13:00 EDT", analyzed: "2026-10-28 23:00 EDT", start_date: "2026-03-12", n: 3, note: "T-shirt" });
  assert.equal(localTimes({ at: "2026-01-01T00:00:00Z" }, "America/Chicago").at, "2025-12-31 18:00 CST");
});
