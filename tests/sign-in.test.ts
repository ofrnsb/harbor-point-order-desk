// Passwords are hashed and compared in constant time; sign-in answers the same for every failure and pauses an email
// after repeated failures, then reopens once the window has passed.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { seedFixture } from "./fixtures/tenant.ts";
import { hashPassword, verifyPassword } from "../src/platform/passwords.ts";
import { SIGN_IN_LIMIT } from "../src/config/server.ts";

let store: Awaited<ReturnType<typeof seedFixture>>;
let auth: typeof import("../src/platform/sign-in.ts");
const PW = "correct-horse-battery-1";

before(async () => {
  store = await seedFixture();
  auth = await import("../src/platform/sign-in.ts");
  store.setPasswordHash("u-op", hashPassword(PW));
  store.setPasswordHash("u-x", hashPassword(PW));
  const x = store.get("user", "u-x")!;
  store.put("user", { ...x, active: false });
});
const tenant = () => store.get("tenant", "t1")!;

test("a hash verifies only its own password, salts differ, and a malformed hash never matches", () => {
  const a = hashPassword(PW), b = hashPassword(PW);
  assert.notEqual(a, b, "each hash has its own salt");
  assert.equal(verifyPassword(PW, a), true);
  assert.equal(verifyPassword(`${PW}!`, a), false);
  const [prefix, salt, hash] = a.split("$");
  const tampered = [prefix, salt, (hash[0] === "A" ? "B" : "A") + hash.slice(1)].join("$");
  assert.equal(verifyPassword(PW, tampered), false, "a tampered hash fails");
  for (const bad of ["", "scrypt$", "md5$abc$def", PW]) assert.equal(verifyPassword(PW, bad), false, bad);
});

test("sign-in takes the email in any case and the right password only", () => {
  assert.equal(auth.signIn(tenant(), "U-OP@T.EXAMPLE ", PW)?.id, "u-op");
  assert.equal(auth.signIn(tenant(), "u-op@t.example", "wrong-password-1"), null);
});

test("unknown emails, users without a password and inactive users all fail the same way", () => {
  assert.equal(auth.signIn(tenant(), "nobody@t.example", PW), null);
  assert.equal(auth.signIn(tenant(), "u-mgr@t.example", PW), null, "no password set");
  assert.equal(auth.signIn(tenant(), "u-x@t.example", PW), null, "inactive");
});

test("repeated failures pause one email for the window, then it reopens; success clears the count", () => {
  const t0 = 1_000_000, email = "u-view@t.example";
  store.setPasswordHash("u-view", hashPassword(PW));
  for (let i = 0; i < SIGN_IN_LIMIT.failures; i++) auth.signIn(tenant(), email, "wrong-password-1", t0 + i);
  assert.ok(auth.pausedFor(email, t0 + 10) > 0, "paused after the limit");
  assert.equal(auth.pausedFor("u-op@t.example", t0 + 10), 0, "other emails stay open");
  assert.equal(auth.pausedFor(email, t0 + SIGN_IN_LIMIT.windowMs + 1), 0, "reopens after the window");
  auth.signIn(tenant(), email, "wrong-password-1", t0 + SIGN_IN_LIMIT.windowMs + 2);
  assert.equal(auth.signIn(tenant(), email, PW, t0 + SIGN_IN_LIMIT.windowMs + 3)?.id, "u-view");
  assert.equal(auth.pausedFor(email, t0 + SIGN_IN_LIMIT.windowMs + 4), 0);
});
