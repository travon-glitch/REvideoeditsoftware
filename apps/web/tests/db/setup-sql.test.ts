/*
 * supabase/setup.sql — the one file pasted into the Supabase SQL Editor to create the database —
 * must be current and must build exactly the same database as the migrations applied one by one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ROOT = join(__dirname, "..", "..", "..", "..");
const SETUP = join(ROOT, "supabase", "setup.sql");

const catalog = async (db: PGlite) => {
  const q = async (sql: string) => (await db.query<{ x: string }>(sql)).rows.map((r) => r.x).join("\n");
  return {
    tables: await q(`select table_schema || '.' || table_name x from information_schema.tables where table_schema in ('public','private') order by 1`),
    columns: await q(`select table_name || '.' || column_name || ':' || data_type x from information_schema.columns where table_schema = 'public' order by 1`),
    functions: await q(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') order by 1`),
    policies: await q(`select schemaname || '.' || tablename || '.' || policyname || ':' || cmd x from pg_policies order by 1`),
    triggers: await q(`select event_object_table || '.' || trigger_name x from information_schema.triggers order by 1`),
    buckets: await q(`select id || ':' || public::text x from storage.buckets order by 1`),
    templates: await q(`select slug x from public.video_templates order by 1`),
  };
};

describe("supabase/setup.sql", () => {
  it("is up to date with supabase/migrations (run: node scripts/build-setup-sql.mjs)", () => {
    const before = readFileSync(SETUP, "utf8");
    execFileSync(process.execPath, [join(ROOT, "scripts", "build-setup-sql.mjs")], { stdio: "ignore" });
    expect(readFileSync(SETUP, "utf8")).toBe(before);
  });

  it("pasted as one script, builds the same database as the migrations one by one", async () => {
    const pasted = new PGlite();
    await pasted.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
    await pasted.exec(readFileSync(SETUP, "utf8")); // one multi-statement query, like the SQL Editor
    const reference = await freshDatabase();
    expect(await catalog(pasted)).toEqual(await catalog(reference));
  }, 120_000);
});
