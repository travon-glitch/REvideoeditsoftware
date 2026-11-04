/*
 * Stage 14 security audit of the database itself (catalog checks on the real migrations):
 * every table protected by Row-Level Security, nothing open to anonymous visitors,
 * and every privileged (security definer) function pinned to a safe search path.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

let db: PGlite;
beforeAll(async () => { db = await freshDatabase(); });

describe("database catalog", () => {
  it("every table in public has Row-Level Security switched on", async () => {
    const r = await db.query<{ t: string }>(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    expect(r.rows.map((x) => x.t)).toEqual([]);
  });

  it("anonymous visitors have no table privileges", async () => {
    const r = await db.query<{ t: string; p: string }>(`select table_name t, privilege_type p from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public' order by 1, 2`);
    expect(r.rows).toEqual([]);
  });

  it("anonymous visitors can't run any database function they can reach", async () => {
    const r = await db.query<{ f: string }>(`select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_schema_privilege('anon', n.oid, 'usage') and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(r.rows.map((x) => x.f)).toEqual([]);
  });

  it("every access rule applies to signed-in people only", async () => {
    const r = await db.query<{ p: string }>(`select tablename || '.' || policyname p from pg_policies
      where schemaname in ('public', 'storage') and not (roles = '{authenticated}') order by 1`);
    expect(r.rows.map((x) => x.p)).toEqual([]);
  });

  it("every security definer function sets its search_path", async () => {
    const r = await db.query<{ f: string }>(`select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1`);
    expect(r.rows.map((x) => x.f)).toEqual([]);
  });

  it("worker-only functions can't be called by signed-in people", async () => {
    for (const f of ["claim_render_job(text)", "requeue_stale_render_jobs(integer)", "claim_generation_job(text,text[])", "requeue_stale_generation_jobs(integer)",
      "worker_heartbeat(text,text,text,text[],uuid,integer,text)", "bootstrap_create_token(text,integer)", "bootstrap_complete(text,uuid,text,text,text,text)"]) {
      const r = await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.${f}', 'execute') ok`);
      expect(r.rows[0]!.ok, f).toBe(false);
    }
  });

  it("storage buckets are private", async () => {
    const r = await db.query<{ id: string; public: boolean }>(`select id, public from storage.buckets order by id`);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.filter((b) => b.public)).toEqual([]);
  });
});
