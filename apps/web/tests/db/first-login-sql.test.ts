/* supabase/first-login.sql gives a setup code the app's /setup page accepts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashSetupCode } from "@/lib/bootstrap";
import { freshDatabase, rejects } from "./helpers";

const FILE = join(__dirname, "..", "..", "..", "..", "supabase", "first-login.sql");

describe("supabase/first-login.sql", () => {
  it("prints a one-time code whose hash the setup page will accept", async () => {
    const db = await freshDatabase();
    // Supabase has pgcrypto in the "extensions" schema; this test database gets an equivalent
    await db.exec(`create schema if not exists extensions;
      create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as
      $$ select substring(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex') from 1 for n) $$;`);
    const r = await db.query<{ "Your one-time setup code": string; "Valid until": string }>(readFileSync(FILE, "utf8"));
    const code = r.rows[0]!["Your one-time setup code"];
    expect(code).toMatch(/^([A-HJ-NP-Z2-9]{5}-){5}[A-HJ-NP-Z2-9]{5}$/);
    expect(new Date(r.rows[0]!["Valid until"]).getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);
    const ok = await db.query<{ ok: boolean }>(`select public.bootstrap_check_token($1) ok`, [hashSetupCode(code)]);
    expect(ok.rows[0]!.ok).toBe(true);
    // a second run replaces the first code
    const again = (await db.query<{ "Your one-time setup code": string }>(readFileSync(FILE, "utf8"))).rows[0]!["Your one-time setup code"];
    expect((await db.query<{ ok: boolean }>(`select public.bootstrap_check_token($1) ok`, [hashSetupCode(code)])).rows[0]!.ok).toBe(false);
    expect((await db.query<{ ok: boolean }>(`select public.bootstrap_check_token($1) ok`, [hashSetupCode(again)])).rows[0]!.ok).toBe(true);
    // once setup is complete it refuses
    await db.query(`insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'o@x.test')`);
    await db.query(`select public.bootstrap_complete($1, '11111111-1111-4111-8111-111111111111', 'o@x.test', 'Olivia Owner', 'Acme Realty', 'acme')`, [hashSetupCode(again)]);
    await rejects(db.query(readFileSync(FILE, "utf8")), /Setup is already complete/);
  });
});
