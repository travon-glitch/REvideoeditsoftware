import "server-only";
/*
 * Encryption for company secrets (Claude and video-AI keys saved in Admin → AI control panel):
 * AES-256-GCM. The database stores only ciphertext + the last 4 characters.
 *
 * The encryption key exists only on the server:
 *   • LVS_SECRETS_KEY (32 random bytes, base64) when it's set — saved as "v1:…";
 *   • otherwise derived (HKDF-SHA256) from SUPABASE_SERVICE_ROLE_KEY, which the server always has
 *     and which is itself a server-only master secret — saved as "v2s:…".
 * So keys can be typed in from the admin panel without any extra setup. The AI worker reads them the
 * same way (packages/ai-motion/src/secrets.ts). If the service-role key is rotated, saved keys made
 * with it must be entered again (set LVS_SECRETS_KEY to avoid that).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function explicitKey(): Buffer | null {
  const raw = process.env.LVS_SECRETS_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("LVS_SECRETS_KEY must be 32 bytes, base64-encoded");
  return k;
}

function derivedKey(): Buffer | null {
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sr || sr.length < 20) return null;
  return Buffer.from(hkdfSync("sha256", sr, "lvs-secrets", "lvs-provider-keys-v2", 32));
}

function keyFor(version: string): Buffer {
  const k = version === "v1" ? explicitKey() : version === "v2s" ? derivedKey() : null;
  if (!k) throw new Error(version === "v1" ? "LVS_SECRETS_KEY is not set on the server" : "SUPABASE_SERVICE_ROLE_KEY is not set on the server");
  return k;
}

export function secretsConfigured(): boolean {
  try { return !!(explicitKey() ?? derivedKey()); } catch { return false; }
}

export function encryptSecret(plain: string): string {
  const version = explicitKey() ? "v1" : "v2s";
  if (version === "v2s" && !derivedKey()) throw new Error("LVS_SECRETS_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set on the server");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(version), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [version, iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, data] = blob.split(":");
  if ((v !== "v1" && v !== "v2s") || !iv || !tag || !data) throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", keyFor(v), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
