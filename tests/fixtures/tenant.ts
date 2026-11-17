// A small tenant in a throwaway store: two divisions, teams with branch filters, a catalog with every sensitivity.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CatalogColumn, ColumnType, Sensitivity } from "../../src/platform/contract.ts";

export async function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simpul-test-"));
  process.env.SIMPUL_DB = path.join(dir, "t.db");
  process.env.SIMPUL_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.SIMPUL_TENANT = "t1";
  const store = await import("../../src/platform/store.ts");
  return { store, dir };
}

export async function seedFixture() {
  const { store } = await freshStore();
  const { put, setMembership } = store;
  const p = (x: Record<string, unknown> = {}) => ({ description: "", glossary: [], rules: [], grants: null, actions: null, models: null, clearance: null, budgetMonthly: null, approvalOver: null, attributes: {}, ...x });
  put("tenant", { id: "t1", name: "T", legalName: "T Inc.", industry: "x", timezone: "America/New_York", locale: "en-US", currency: "USD", levels: ["Company", "Division", "Team"], restrictedRouting: "local_model", sensitivityDefaults: { public: "show", internal: "show", confidential: "mask", restricted: "deny" }, minGroupSize: 5 });
  put("connection", { id: "c-erp", tenantId: "t1", code: "ERP", name: "ERP", kind: "sqlite", config: { file: "erp.db" }, readSecret: "x", writeSecret: null, status: "ok", statusNote: "", introspectedAt: null });
  put("connection", { id: "c-hr", tenantId: "t1", code: "HR", name: "HR", kind: "sqlite", config: { file: "hr.db" }, readSecret: "x", writeSecret: null, status: "ok", statusNote: "", introspectedAt: null });
  const col = (name: string, sensitivity: Sensitivity, type: ColumnType = "text"): CatalogColumn => ({ name, type, nativeType: type, nullable: true, pk: name.endsWith("_no"), label: name, description: "", sensitivity, sensitivitySource: "auto" });
  put("catalog", { connectionId: "c-erp", name: "invoices", kind: "table", label: "Invoice", description: "", rowEstimate: 10, primaryKey: ["invoice_no"], exposed: true,
    columns: [col("invoice_no", "internal"), col("branch", "internal"), col("amount", "internal", "number"), col("ssn", "restricted"), col("phone", "confidential")] });
  put("catalog", { connectionId: "c-erp", name: "secret_table", kind: "table", label: "Hidden", description: "", rowEstimate: 1, primaryKey: [], exposed: false, columns: [col("x", "internal")] });
  put("catalog", { connectionId: "c-hr", name: "employees", kind: "table", label: "Employees", description: "", rowEstimate: 10, primaryKey: ["employee_no"], exposed: true,
    columns: [col("employee_no", "internal"), col("department", "internal"), col("base_salary", "restricted", "number"), col("national_id", "restricted")] });
  put("unit", { id: "root", tenantId: "t1", parentId: null, name: "T Inc.", code: "T", profile: p({ grants: [{ connectionId: "c-erp", objects: "*" }, { connectionId: "c-hr", objects: "*" }], clearance: "restricted", budgetMonthly: 1000, approvalOver: 500,
    rules: [{ id: "r1", text: "Locked rule", locked: true }] }) });
  put("unit", { id: "fin", tenantId: "t1", parentId: "root", name: "Finance", code: "FIN", profile: p({ grants: [{ connectionId: "c-erp", objects: [{ object: "invoices", columns: { phone: "hash" } }] }], clearance: "confidential", budgetMonthly: 400, approvalOver: 100, actions: ["a1"] }) });
  put("unit", { id: "ar-east", tenantId: "t1", parentId: "fin", name: "AR East", code: "AR-E", profile: p({ attributes: { branch: "EAST" }, grants: [{ connectionId: "c-erp", objects: [{ object: "invoices", columns: { phone: "show" }, rowFilters: [{ column: "branch", op: "eq", value: "{unit.branch}" }] }] }], approvalOver: 900 }) });
  put("unit", { id: "ar-nobranch", tenantId: "t1", parentId: "fin", name: "AR ?", code: "AR-X", profile: p({ grants: [{ connectionId: "c-erp", objects: [{ object: "invoices", rowFilters: [{ column: "branch", op: "eq", value: "{unit.branch}" }] }] }] }) });
  put("unit", { id: "hr", tenantId: "t1", parentId: "root", name: "HR", code: "HR", profile: p({ grants: [{ connectionId: "c-hr", objects: [{ object: "employees", columns: { national_id: "mask" } }] }] }) });
  put("unit", { id: "exec", tenantId: "t1", parentId: "root", name: "Executive", code: "EXEC", profile: p({ grants: [{ connectionId: "c-hr", objects: [{ object: "employees", columns: { base_salary: "aggregate", national_id: "deny" } }] }] }) });
  for (const [id, name] of [["u-op", "Operator"], ["u-mgr", "Manager"], ["u-view", "Viewer"], ["u-hr", "HR"], ["u-dir", "Dir"], ["u-x", "X"]]) {
    put("user", { id, tenantId: "t1", email: `${id}@t.example`, name, title: name, attributes: {}, platformRoles: [], active: true });
  }
  setMembership({ userId: "u-op", unitId: "ar-east", role: "operator" });
  setMembership({ userId: "u-mgr", unitId: "fin", role: "approver" });
  setMembership({ userId: "u-view", unitId: "ar-east", role: "viewer" });
  setMembership({ userId: "u-hr", unitId: "hr", role: "operator" });
  setMembership({ userId: "u-dir", unitId: "exec", role: "approver" });
  setMembership({ userId: "u-x", unitId: "ar-nobranch", role: "operator" });
  put("action", { id: "a1", tenantId: "t1", name: "A1", description: "", connectionId: "c-erp", object: "invoices", op: "insert", fields: [], risk: "low", owner: "AR", receiptPrefix: "A" });
  put("action", { id: "a2", tenantId: "t1", name: "A2", description: "", connectionId: "c-erp", object: "invoices", op: "insert", fields: [], risk: "low", owner: "AR", receiptPrefix: "B" });
  put("route", { id: "ext", tenantId: "t1", label: "Ext", provider: "claude-login", model: "sonnet", backend: "claude-sdk", external: true, fallbacks: [], inputPer1M: 1, outputPer1M: 1, active: true });
  put("route", { id: "local", tenantId: "t1", label: "Local", provider: "ollama", model: "q", backend: "litellm", external: false, fallbacks: [], inputPer1M: 0, outputPer1M: 0, active: true });
  return store;
}
