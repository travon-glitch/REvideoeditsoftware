#!/usr/bin/env node
/*
 * Builds supabase/setup.sql: every migration, in order, in ONE file you can paste into the
 * Supabase dashboard (SQL Editor → New query → Run) to create the whole database for a new project.
 * Each migration runs in its own transaction, exactly like `supabase db push`.
 *
 *   node scripts/build-setup-sql.mjs          (re-run after adding a migration; CI checks it's current)
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const parts = files.map((f) => {
  const sql = readFileSync(join(dir, f), "utf8").trim();
  return `-- ════════ ${f} ════════\nbegin;\n\n${sql}\n\ncommit;\n`;
});
const body = parts.join("\n");
const header = `-- ════════════════════════════════════════════════════════════════════════════
-- Listing Video Studio — complete database setup (generated: do not edit by hand)
--
-- FOR A NEW, EMPTY SUPABASE PROJECT. Run it once:
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- It creates every table, access rule (Row-Level Security), function and the six
-- private storage buckets. It is the same as running the ${files.length} files in
-- supabase/migrations/ in order (\`npx supabase db push\` does that too).
--
-- Don't run it twice on the same project. For later updates, run only the new
-- migration files (see docs/VERCEL.md, "Updating").
--
-- Migrations included: ${files[0]} … ${files.at(-1)}
-- Checksum: ${createHash("sha256").update(body).digest("hex").slice(0, 16)}
-- ════════════════════════════════════════════════════════════════════════════

`;
writeFileSync(join(root, "supabase", "setup.sql"), header + body);
console.log(`supabase/setup.sql: ${files.length} migrations, ${(Buffer.byteLength(header + body) / 1024).toFixed(0)} KB`);
