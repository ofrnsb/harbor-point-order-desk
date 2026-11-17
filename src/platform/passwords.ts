// Passwords are stored only as salted scrypt hashes: "scrypt$<salt>$<hash>", both base64url.
import crypto from "node:crypto";
import { PASSWORD } from "../config/server.ts";

const PREFIX = "scrypt";
const derive = (plain: string, salt: Buffer) =>
  crypto.scryptSync(plain, salt, PASSWORD.keyBytes, { N: PASSWORD.cost, r: PASSWORD.blockSize, p: PASSWORD.parallel });

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(PASSWORD.saltBytes);
  return [PREFIX, salt.toString("base64url"), derive(plain, salt).toString("base64url")].join("$");
}

/** Whether the password matches the stored hash, compared in constant time. A malformed hash never matches. */
export function verifyPassword(plain: string, stored: string): boolean {
  const [prefix, salt, hash] = stored.split("$");
  if (prefix !== PREFIX || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = derive(plain, Buffer.from(salt, "base64url"));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
