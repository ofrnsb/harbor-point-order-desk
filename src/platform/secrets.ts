// Database credentials are encrypted at rest with AES-256-GCM under one master key.
// Production reads SIMPUL_MASTER_KEY (32 bytes, base64); development creates data/master.key once (mode 0600).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../lib/data-dir.ts";
import type { Credentials } from "./contract.ts";
import { putSecretBlob } from "./store.ts";
import { env } from "../config/env.ts";
import { ERR } from "../copy/server.ts";
import { KEY_BYTES } from "../config/server.ts";

let cached: Buffer | null = null;

export function masterKey(): Buffer {
  if (cached) return cached;
  const key = env.masterKey;
  if (key) {
    const k = Buffer.from(key, "base64");
    if (k.length !== KEY_BYTES) throw new Error(ERR.simpulMasterKeyMust);
    return (cached = k);
  }
  if (env.production) throw new Error(ERR.simpulMasterKeyRequired);
  const file = path.join(DATA_DIR, "master.key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(KEY_BYTES).toString("base64"), { mode: 0o600 });
  }
  return (cached = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64"));
}

export function seal(plain: string, key = masterKey()): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function open(blob: string, key = masterKey()): string {
  const [v, iv, tag, body] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error(ERR.unknownSecretFormat);
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

export function storeCredentials(tenantId: string, creds: Credentials, id = `sec_${crypto.randomUUID().slice(0, 12)}`): string {
  putSecretBlob(id, tenantId, seal(JSON.stringify(creds)));
  return id;
}
