import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dir: string, prev: string, store: typeof import("../src/lib/store.ts");
before(async () => {
  prev = process.cwd();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "langit-store-"));
  process.chdir(dir);
  store = await import("../src/lib/store.ts");
});
after(async () => { process.chdir(prev); await fs.rm(dir, { recursive: true, force: true }); });

test("create, read back, list newest first, delete", async () => {
  const rina = { model: "claude-sonnet", userId: "usr_rina", unitId: "unit_ar_sby" };
  const a = await store.createChat("Order SO-24051 change", rina);
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.createChat("Stok SKU kurang", rina);
  const other = await store.createChat("December time off", { ...rina, userId: "usr_dewi", unitId: "unit_hr" });
  assert.equal((await store.getChat(a.id))?.title, "Order SO-24051 change");
  assert.equal((await store.getChat(a.id))?.unitId, "unit_ar_sby");
  assert.deepEqual((await store.listChats("usr_rina")).map((c) => c.id), [b.id, a.id]);
  assert.deepEqual((await store.listChats("usr_dewi")).map((c) => c.id), [other.id]);
  assert.equal(await store.deleteChat(a.id), true);
  assert.equal(await store.getChat(a.id), null);
  assert.equal(await store.deleteChat(a.id), false);
});

test("path traversal ids are refused", async () => {
  assert.equal(await store.getChat("../../etc/passwd"), null);
  assert.equal(store.isChatId("../x"), false);
  assert.equal(await store.deleteChat("../../x"), false);
});

test("a chat saved in an older shape still opens with defaults", async () => {
  await fs.mkdir(path.join(dir, "data", "chats"), { recursive: true });
  await fs.writeFile(path.join(dir, "data", "chats", "oldchat123.json"), JSON.stringify({
    id: "oldchat123", title: "", messages: [{ id: "m1", role: "agent", text: "hi", at: "2026-10-01T00:00:00Z" }],
  }));
  const c = await store.getChat("oldchat123");
  assert.equal(c?.title, "Untitled chat");
  assert.deepEqual(c?.notes, []);
  assert.equal(c?.userId, undefined);
  assert.deepEqual(await store.listChats("usr_rina").then((l) => l.some((x) => x.id === "oldchat123")), false);
  assert.equal(c?.model, "");
  assert.equal(c?.sessionId, null);
  const m = c!.messages[0];
  assert.ok(m.role === "agent" && Array.isArray(m.blocks) && Array.isArray(m.trace) && m.error === null);
});

test("a chat started in a project keeps its project through save, read and list", async () => {
  const c = await store.createChat("Time-off summary", { model: "claude-sonnet", userId: "usr_sari", unitId: "hr-ops", projectId: "prj_abc" });
  c.title = "Time-off summary Q4";
  await store.saveChat(c);
  assert.equal((await store.getChat(c.id))?.projectId, "prj_abc");
  assert.equal((await store.listChats("usr_sari")).find((x) => x.id === c.id)?.projectId, "prj_abc");
  const plain = await store.createChat("Tanpa project", { model: "claude-sonnet", userId: "usr_sari", unitId: "hr-ops" });
  assert.equal((await store.getChat(plain.id))?.projectId, undefined);
});
