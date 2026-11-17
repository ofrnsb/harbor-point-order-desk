import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObject, type RawColumn } from "../src/platform/classify.ts";
import type { CatalogObject } from "../src/platform/contract.ts";
import { wireCatalog, wireObject } from "../src/platform/wiring.ts";

const col = (name: string, nativeType = "text", fk?: RawColumn["fk"]): RawColumn => ({ name, nativeType, nullable: true, ...(fk ? { fk } : {}) });
const obj = (connectionId: string, name: string, pk: string, cols: RawColumn[], exposed = true): CatalogObject =>
  ({ ...buildObject({ name, kind: "table", columns: [col(pk), ...cols], primaryKey: [pk], rowEstimate: 10, samples: {} }), connectionId, exposed });
const kinds = (o: CatalogObject, all?: CatalogObject[]) => wireObject(o, all).views.map((v) => v.kind);

// An HR system with people, time off and approvals.
const employees = obj("hr", "employees", "employee_no", [col("full_name"), col("email"), col("phone"), col("department"), col("join_date", "date"), col("status")]);
const leave = obj("hr", "leave_requests", "request_no", [col("employee_no", "text", { object: "employees", column: "employee_no" }), col("leave_type"), col("start_date"), col("end_date"), col("days", "integer"), col("reason"), col("status"), col("created_at", "timestamp"), col("decided_at", "timestamp")]);
// A clinic and a fleet the platform has never seen.
const patients = obj("clinic", "patients", "id", [col("name"), col("phone"), col("address")]);
const visits = obj("clinic", "appointments", "id", [col("patient_id", "integer", { object: "patients", column: "id" }), col("start_at", "timestamptz"), col("end_at", "timestamptz"), col("ward"), col("fee", "numeric"), col("status")]);
const trucks = obj("fleet", "vehicles", "plate_no", [col("driver_name"), col("lat", "double"), col("lng", "double"), col("fuel_level", "numeric")]);
const logs = obj("fleet", "audit_log", "id", [col("payload", "jsonb")], false);

test("leave requests light a board, a calendar with its end, a timeline and a breakdown", () => {
  const w = wireObject(leave, [employees, leave]);
  assert.deepEqual(w.views.map((v) => v.kind), ["table", "detail", "board", "calendar", "trend", "breakdown", "timeline"]);
  assert.deepEqual(w.views.find((v) => v.kind === "calendar")?.binds, { start: "start_date", end: "end_date", title: "request_no" });
  assert.deepEqual(w.views.find((v) => v.kind === "breakdown")?.binds, { measure: "days", group: "leave_type" });
  assert.equal(w.roles.created_at, "stamp");
  assert.equal(w.roles.employee_no, "ref");
});

test("people tables become a directory, never a map without an address", () => {
  assert.deepEqual(kinds(employees), ["table", "detail", "board", "calendar", "directory"]);
  assert.ok(kinds(patients).includes("directory"));
  assert.deepEqual(wireObject(patients).views.find((v) => v.kind === "map")?.binds, { address: "address", title: "name" });
});

test("an unseen schema still wires: appointments by start_at, vehicles on a map by coordinates", () => {
  const a = wireObject(visits);
  assert.equal(a.roles.start_at, "start");
  assert.deepEqual(a.views.find((v) => v.kind === "calendar")?.binds, { start: "start_at", end: "end_at", title: "id" });
  // "ward" says nothing by name alone, so the breakdown groups by status rather than guessing.
  assert.deepEqual(a.views.find((v) => v.kind === "breakdown")?.binds, { measure: "fee", group: "status" });
  assert.deepEqual(wireObject(trucks).views.find((v) => v.kind === "map")?.binds, { lat: "lat", lng: "lng", title: "driver_name" });
  assert.ok(!kinds(trucks).includes("board"), "no status column, no board");
});

test("salaries are never charted, even when the column reads like money", () => {
  const staff = obj("hr", "staff", "employee_no", [col("full_name"), col("base_salary", "numeric"), col("department"), col("join_date", "date")]);
  assert.ok(!kinds(staff).includes("trend") && !kinds(staff).includes("breakdown"));
});

test("a bare table still gets the table and detail, nothing invented", () => {
  assert.deepEqual(kinds(obj("x", "settings", "key", [col("value")])), ["table", "detail"]);
});

test("rooms group objects joined by foreign keys and skip hidden ones", () => {
  const { objects, rooms } = wireCatalog([employees, leave, patients, visits, trucks, logs]);
  assert.equal(objects.length, 5);
  assert.deepEqual(rooms.map((r) => [r.anchor, r.objects.map((k) => k.split("/")[1])]), [
    ["employees", ["employees", "leave_requests"]],
    ["patients", ["appointments", "patients"]],
    ["vehicles", ["vehicles"]],
  ]);
  assert.deepEqual(wireObject(employees, [employees, leave]).links, [{ connectionId: "hr", object: "leave_requests", via: "employee_no", dir: "in", declared: true }]);
});

test("a key column named after another system's key joins the two into one room", () => {
  const orders = obj("erp", "sales_orders", "so_no", [col("customer_code"), col("total", "numeric"), col("status")]);
  const picks = obj("wms", "pick_tasks", "task_no", [col("so_no"), col("status")]);
  const notes = obj("crm", "notes", "id", [col("body")]);
  const { rooms } = wireCatalog([orders, picks, notes]);
  assert.deepEqual(rooms.map((r) => r.objects.map((k) => k.split("/")[1])), [["pick_tasks", "sales_orders"], ["notes"]]);
  assert.deepEqual(wireObject(picks, [orders, picks]).links, [{ connectionId: "erp", object: "sales_orders", via: "so_no", dir: "out", declared: false }]);
  // A shared generic "id" never links unrelated tables.
  assert.deepEqual(wireObject(notes, [notes, obj("x", "other", "id", [])]).links, []);
});
