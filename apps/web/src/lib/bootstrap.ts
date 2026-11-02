/*
 * One-time Super Admin setup helpers (pure functions; no I/O).
 * The code is random, shown once to the operator, and only its SHA-256 hash is
 * stored in the database. See supabase/migrations/*_foundation.sql.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { CODE_ALPHABET, SETUP_CODE_GROUPS, SETUP_CODE_GROUP_LEN, normalizeSetupCode } from "./setup-code.ts";

export { normalizeSetupCode, SETUP_CODE_GROUPS, SETUP_CODE_GROUP_LEN };

/** 30 random symbols from a 32-symbol alphabet = 150 bits, e.g. "K7QPM-...". */
export function generateSetupCode(): string {
  const bytes = randomBytes(SETUP_CODE_GROUPS * SETUP_CODE_GROUP_LEN);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < SETUP_CODE_GROUPS; i++) {
    groups.push(chars.slice(i * SETUP_CODE_GROUP_LEN, (i + 1) * SETUP_CODE_GROUP_LEN).join(""));
  }
  return groups.join("-");
}

export function hashSetupCode(code: string): string {
  const normalized = normalizeSetupCode(code);
  if (!normalized) throw new Error("Invalid setup code format");
  return createHash("sha256").update(`lvs-setup:${normalized}`).digest("hex");
}

export function setupCodeMatches(code: string, expectedHash: string): boolean {
  const normalized = normalizeSetupCode(code);
  if (!normalized || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const a = Buffer.from(hashSetupCode(normalized), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** URL-safe company slug from a name ("Acme Realty, LLC" → "acme-realty-llc"). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : `company-${slug || "hq"}`;
}
