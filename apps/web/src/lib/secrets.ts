import "server-only";
/*
 * Encryption for company secrets (the Claude API key) — AES-256-GCM with a key
 * that exists only on the app server (LVS_SECRETS_KEY: 32 random bytes, base64).
 * The database stores only ciphertext + the last 4 characters.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.LVS_SECRETS_KEY;
  if (!raw) throw new Error("LVS_SECRETS_KEY is not set on the server");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("LVS_SECRETS_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function secretsConfigured(): boolean {
  try { key(); return true; } catch { return false; }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
