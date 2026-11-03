/*
 * Reads company provider keys saved by the Super Admin (encrypted by the web app
 * with AES-256-GCM, format "v1:iv:tag:data"). The key LVS_SECRETS_KEY must be the
 * same on the web server and on this worker; it never leaves those machines.
 */
import { createDecipheriv } from "node:crypto";

export function secretsKey(env = process.env): Buffer | null {
  const raw = env.LVS_SECRETS_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}

export function decryptSecret(blob: string, key: Buffer): string {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
