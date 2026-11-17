import assert from "node:assert/strict";
import { test } from "node:test";
import { addWorkingDays, serviceRequests } from "../src/lib/requests.ts";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10);

test("working days skip the weekend", () => {
  assert.equal(addWorkingDays(day(2026, 11, 6), 1).getDate(), 9, "Friday plus one is Monday");
  assert.equal(addWorkingDays(day(2026, 11, 6), 2).getDate(), 10, "Friday plus two is Tuesday");
  assert.equal(addWorkingDays(day(2026, 11, 7), 1).getDate(), 9, "Saturday plus one is Monday");
  assert.equal(addWorkingDays(day(2026, 11, 2), 5).getDate(), 9, "Monday plus five is the next Monday");
  assert.equal(addWorkingDays(day(2026, 11, 2), 0).getDate(), 2);
});

test("the request tool routes only to the company's own desks and carries their answer time", async () => {
  const desks = [{ name: "Finance & Billing", handles: "invoices and payments", workingDays: 2 }];
  const { tool } = serviceRequests(() => desks);
  assert.equal(tool.name, "open_request");
  const proposed: { payload: Record<string, unknown>; summary: { label: string; value: string }[] }[] = [];
  const ctx = { propose: async (p: (typeof proposed)[number]) => { proposed.push(p); return { id: "act_1" }; } } as never;
  assert.match(String(await tool.run({ desk: "Warehouse", kind: "Letter request", details: "Employment letter" }, ctx)), /does not exist\. Pick one of: Finance & Billing/);
  assert.equal(proposed.length, 0);
  assert.match(String(await tool.run({ desk: "finance & billing", kind: "Minta keringanan", details: "Klien minta keringanan" }, ctx)), /action_id=act_1/);
  assert.deepEqual(proposed[0].payload, { desk: "Finance & Billing", kind: "Minta keringanan", details: "Klien minta keringanan", workingDays: 2 });
  assert.deepEqual(proposed[0].summary.map((f) => f.label), ["Request", "Handled by", "Details", "Response within"]);
});
