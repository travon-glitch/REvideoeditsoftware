/*
 * Reads company provider keys saved in the admin panel (encrypted by the web app with AES-256-GCM,
 * "v1:iv:tag:data" with LVS_SECRETS_KEY, or "v2s:…" with a key derived from SUPABASE_SERVICE_ROLE_KEY).
 * The worker needs the same LVS_SECRETS_KEY / SUPABASE_SERVICE_ROLE_KEY as the web server.
 */
import { createDecipheriv, hkdfSync } from "node:crypto";

export function secretsKey(env = process.env): Buffer | null {
  const raw = env.LVS_SECRETS_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}

export function derivedSecretsKey(env = process.env): Buffer | null {
  const sr = env.SUPABASE_SERVICE_ROLE_KEY;
  return sr && sr.length >= 20 ? Buffer.from(hkdfSync("sha256", sr, "lvs-secrets", "lvs-provider-keys-v2", 32)) : null;
}

/** Can this worker read saved keys at all? */
export function canReadSavedKeys(env = process.env): boolean {
  return !!(secretsKey(env) ?? derivedSecretsKey(env));
}

/** Decrypts a saved key; `key` overrides the key for "v1" blobs (tests). */
export function decryptSecret(blob: string, key?: Buffer | null, env = process.env): string {
  const [v, iv, tag, data] = blob.split(":");
  if ((v !== "v1" && v !== "v2s") || !iv || !tag || !data) throw new Error("Unknown secret format");
  const k = v === "v1" ? (key ?? secretsKey(env)) : derivedSecretsKey(env);
  if (!k) throw new Error(v === "v1" ? "LVS_SECRETS_KEY is not set on this worker" : "SUPABASE_SERVICE_ROLE_KEY is not set on this worker");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
