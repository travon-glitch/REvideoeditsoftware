/*
 * Runs supabase/migrations/*.sql on PGlite (embedded Postgres 17) and checks
 * tenant isolation, roles, the admin RPC, storage policies and the one-time
 * Super Admin bootstrap. Requests are simulated the way PostgREST does it:
 * SET ROLE authenticated + request.jwt.claim.sub = <user id>.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

let db: PGlite;
const ids = {
  superAdmin: randomUUID(), admin: randomUUID(), editor: randomUUID(), editor2: randomUUID(),
  viewer: randomUUID(), inactive: randomUUID(), outsider: randomUUID(),
};
let orgA = "";
let orgB = "";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

type Role = "authenticated" | "service_role" | "anon";
async function as<T>(role: Role, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}
const asUser = <T>(userId: string, fn: (tx: Transaction) => Promise<T>) => as("authenticated", userId, fn);
const asService = <T>(fn: (tx: Transaction) => Promise<T>) => as("service_role", null, fn);

async function rejects(p: Promise<unknown>, pattern?: RegExp) {
  let error: unknown = null;
  try { await p; } catch (e) { error = e; }
  expect(error, "expected the database to refuse").not.toBeNull();
  if (pattern) expect(String((error as Error).message)).toMatch(pattern);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  for (const [name, id] of Object.entries(ids)) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`]);
  }
});

describe("migration", () => {
  it("creates the built-in templates and private buckets", async () => {
    const t = await db.query<{ n: number }>(`select count(*)::int n from public.video_templates where organization_id is null`);
    expect(t.rows[0]!.n).toBe(5);
    const b = await db.query<{ id: string; public: boolean }>(`select id, public from storage.buckets order by id`);
    expect(b.rows).toEqual([
      { id: "brand-assets", public: false }, { id: "listing-media", public: false },
      { id: "project-media", public: false }, { id: "video-exports", public: false },
    ]);
  });

  it("enables RLS on every public table", async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });
});

describe("one-time Super Admin bootstrap", () => {
  const code = "lvs-setup:AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";

  it("cannot be called by signed-in or anonymous users", async () => {
    await rejects(asUser(ids.editor, (tx) => tx.query(`select public.bootstrap_create_token($1, 60)`, [hash("x")])), /permission denied/);
    await rejects(as("anon", null, (tx) => tx.query(`select public.bootstrap_is_complete()`)), /permission denied/);
  });

  it("rejects an expired code", async () => {
    await asService((tx) => tx.query(`select public.bootstrap_create_token($1, 5)`, [hash("old")]));
    await db.query(`update private.bootstrap_tokens set expires_at = now() - interval '1 minute' where token_hash = $1`, [hash("old")]);
    const ok = await asService((tx) => tx.query<{ v: boolean }>(`select public.bootstrap_check_token($1) v`, [hash("old")]));
    expect(ok.rows[0]!.v).toBe(false);
    await rejects(asService((tx) => tx.query(
      `select public.bootstrap_complete($1, $2, 'sa@example.test', 'Sam Admin', 'Acme Realty', 'acme-realty')`,
      [hash("old"), ids.superAdmin])), /not valid or has expired/);
  });

  it("creates the company, Super Admin and brand kit exactly once", async () => {
    await asService((tx) => tx.query(`select public.bootstrap_create_token($1, 60)`, [hash(code)]));
    const valid = await asService((tx) => tx.query<{ v: boolean }>(`select public.bootstrap_check_token($1) v`, [hash(code)]));
    expect(valid.rows[0]!.v).toBe(true);
    await rejects(asService((tx) => tx.query(
      `select public.bootstrap_complete($1, $2, 'sa@example.test', 'Sam', 'Acme', 'acme')`, [hash("wrong"), ids.superAdmin])));

    const res = await asService((tx) => tx.query<{ org: string }>(
      `select public.bootstrap_complete($1, $2, 'SA@Example.test', 'Sam Admin', 'Acme Realty', 'acme-realty') org`,
      [hash(code), ids.superAdmin]));
    orgA = res.rows[0]!.org;

    const p = await db.query<{ role: string; email: string; organization_id: string }>(`select role, email, organization_id from public.profiles where id = $1`, [ids.superAdmin]);
    expect(p.rows[0]).toEqual({ role: "super_admin", email: "sa@example.test", organization_id: orgA });
    const kit = await db.query<{ n: number }>(`select count(*)::int n from public.brand_kits where organization_id = $1 and is_default`, [orgA]);
    expect(kit.rows[0]!.n).toBe(1);

    // closed for good: the code is burned and no new code can be issued
    await rejects(asService((tx) => tx.query(
      `select public.bootstrap_complete($1, $2, 'x@example.test', 'X', 'Other', 'other')`, [hash(code), ids.outsider])), /already complete/);
    await rejects(asService((tx) => tx.query(`select public.bootstrap_create_token($1, 60)`, [hash("again")])), /already complete/);
    const done = await asService((tx) => tx.query<{ v: boolean }>(`select public.bootstrap_is_complete() v`));
    expect(done.rows[0]!.v).toBe(true);
  });

  it("set up the rest of the test company and a second company", async () => {
    const add = (id: string, org: string, role: string, active = true) =>
      db.query(`insert into public.profiles (id, organization_id, email, first_name, last_name, role, status) values ($1,$2,$3,$4,'Test',$5,$6)`,
        [id, org, `${id}@example.test`, role, role, active ? "active" : "suspended"]);
    await add(ids.admin, orgA, "admin");
    await add(ids.editor, orgA, "editor");
    await add(ids.editor2, orgA, "editor");
    await add(ids.viewer, orgA, "viewer");
    await add(ids.inactive, orgA, "admin", false);
    const b = await db.query<{ id: string }>(`insert into public.organizations (name, slug) values ('Other Co', 'other-co') returning id`);
    orgB = b.rows[0]!.id;
    await add(ids.outsider, orgB, "super_admin");
  });
});

describe("company data isolation", () => {
  let listingA = "";
  let listingB = "";

  it("lets creators add listings only to their own company, as themselves", async () => {
    const r = await asUser(ids.editor, (tx) => tx.query<{ id: string }>(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, $2, '1 Main St') returning id`, [orgA, ids.editor]));
    listingA = r.rows[0]!.id;
    await rejects(asUser(ids.editor, (tx) => tx.query(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, $2, '2 Main St')`, [orgB, ids.editor])), /row-level security/);
    await rejects(asUser(ids.editor, (tx) => tx.query(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, $2, '3 Main St')`, [orgA, ids.editor2])), /row-level security/);
    const b = await asUser(ids.outsider, (tx) => tx.query<{ id: string }>(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, $2, '9 Other Rd') returning id`, [orgB, ids.outsider]));
    listingB = b.rows[0]!.id;
  });

  it("never shows another company's rows", async () => {
    const seen = await asUser(ids.editor, (tx) => tx.query<{ id: string }>(`select id from public.listings`));
    expect(seen.rows.map((r) => r.id)).toEqual([listingA]);
    const people = await asUser(ids.outsider, (tx) => tx.query<{ id: string }>(`select id from public.profiles`));
    expect(people.rows.map((r) => r.id)).toEqual([ids.outsider]);
    const upd = await asUser(ids.outsider, (tx) => tx.query(`update public.listings set city = 'X' where id = $1`, [listingA]));
    expect(upd.affectedRows).toBe(0);
    const orgs = await asUser(ids.editor, (tx) => tx.query<{ id: string }>(`select id from public.organizations`));
    expect(orgs.rows.map((r) => r.id)).toEqual([orgA]);
    expect(listingB).not.toBe("");
  });

  it("viewers see nothing until assigned, and cannot create", async () => {
    const seen = await asUser(ids.viewer, (tx) => tx.query(`select id from public.listings`));
    expect(seen.rows.length).toBe(0);
    await rejects(asUser(ids.viewer, (tx) => tx.query(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, $2, '4 Main St')`, [orgA, ids.viewer])), /row-level security/);
  });

  it("editors edit only their own listings; admins read them; the Super Admin edits any", async () => {
    const other = await asUser(ids.editor2, (tx) => tx.query(`update public.listings set city = 'Nope' where id = $1`, [listingA]));
    expect(other.affectedRows).toBe(0);
    const own = await asUser(ids.editor, (tx) => tx.query(`update public.listings set city = 'Austin' where id = $1`, [listingA]));
    expect(own.affectedRows).toBe(1);
    const adminRead = await asUser(ids.admin, (tx) => tx.query(`select id from public.listings where id = $1`, [listingA]));
    expect(adminRead.rows.length).toBe(1);
    const admin = await asUser(ids.admin, (tx) => tx.query(`update public.listings set state = 'TX' where id = $1`, [listingA]));
    expect(admin.affectedRows).toBe(0);
    const sa = await asUser(ids.superAdmin, (tx) => tx.query(`update public.listings set state = 'TX' where id = $1`, [listingA]));
    expect(sa.affectedRows).toBe(1);
    const moved = asUser(ids.superAdmin, (tx) => tx.query(`update public.listings set organization_id = $1 where id = $2`, [orgB, listingA]));
    await rejects(moved, /row-level security/);
  });

  it("shuts out deactivated people and anonymous visitors", async () => {
    const seen = await asUser(ids.inactive, (tx) => tx.query(`select id from public.listings`));
    expect(seen.rows).toEqual([]);
    await rejects(as("anon", null, (tx) => tx.query(`select id from public.listings`)), /permission denied/);
  });

  it("records an activity log entry that only admins can read", async () => {
    const forEditor = await asUser(ids.editor, (tx) => tx.query(`select id from public.audit_log`));
    expect(forEditor.rows).toEqual([]);
    const forAdmin = await asUser(ids.admin, (tx) => tx.query<{ action: string }>(`select action from public.audit_log order by id`));
    expect(forAdmin.rows.map((r) => r.action)).toContain("listings.insert");
    expect(forAdmin.rows.map((r) => r.action)).toContain("bootstrap.completed");
    await rejects(asUser(ids.admin, (tx) => tx.query(`insert into public.audit_log (organization_id, action) values ($1, 'fake')`, [orgA])), /permission denied/);
  });
});

describe("roles and permissions", () => {
  it("people cannot change their own role, status, permissions or company directly", async () => {
    await rejects(asUser(ids.editor, (tx) => tx.query(`update public.profiles set role = 'super_admin' where id = $1`, [ids.editor])), /permission denied/);
    await rejects(asUser(ids.editor, (tx) => tx.query(`update public.profiles set status = 'active' where id = $1`, [ids.editor])), /permission denied/);
    await rejects(asUser(ids.editor, (tx) => tx.query(`update public.profiles set can_download = true where id = $1`, [ids.editor])), /permission denied/);
    await rejects(asUser(ids.editor, (tx) => tx.query(`update public.profiles set organization_id = $1 where id = $2`, [orgB, ids.editor])), /permission denied/);
    const name = await asUser(ids.editor, (tx) => tx.query(`update public.profiles set first_name = 'Casey', ui_mode = 'advanced' where id = $1`, [ids.editor]));
    expect(name.affectedRows).toBe(1);
    const full = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [ids.editor]);
    expect(full.rows[0]!.full_name).toBe("Casey Test");
    const otherName = await asUser(ids.editor, (tx) => tx.query(`update public.profiles set first_name = 'Hacked' where id = $1`, [ids.editor2]));
    expect(otherName.affectedRows).toBe(0);
  });

  it("ordinary users can only see their own profile", async () => {
    const seen = await asUser(ids.editor, (tx) => tx.query<{ id: string }>(`select id from public.profiles`));
    expect(seen.rows.map((r) => r.id)).toEqual([ids.editor]);
    const admin = await asUser(ids.admin, (tx) => tx.query<{ id: string }>(`select id from public.profiles`));
    expect(admin.rows.length).toBe(6);
  });

  const setRole = (actor: string, target: string, role: string) =>
    asUser(actor, (tx) => tx.query(`select (public.admin_update_user($1, 'Pat', 'Test', null, $2::public.app_role, true, true, null, null)).role`, [target, role]));

  it("admins manage editors and viewers", async () => {
    await setRole(ids.admin, ids.editor2, "viewer");
    const r = await db.query<{ role: string }>(`select role from public.profiles where id = $1`, [ids.editor2]);
    expect(r.rows[0]!.role).toBe("viewer");
    await setRole(ids.admin, ids.editor2, "editor");
  });

  it("only the Super Admin manages administrators, and nobody grants Super Admin", async () => {
    await rejects(setRole(ids.admin, ids.editor2, "admin"), /Only the Super Admin/);
    await rejects(setRole(ids.editor, ids.viewer, "editor"), /Only administrators/);
    await rejects(setRole(ids.superAdmin, ids.editor2, "super_admin"), /cannot be granted/);
    await rejects(setRole(ids.admin, ids.superAdmin, "viewer"), /cannot be granted or changed/);
    await rejects(setRole(ids.admin, ids.admin, "editor"), /your own/);
    await rejects(setRole(ids.outsider, ids.editor, "viewer"), /not found/);
    await setRole(ids.superAdmin, ids.editor2, "admin");
    await setRole(ids.superAdmin, ids.editor2, "editor");
  });

  it("editors may queue AI jobs but cannot fake results", async () => {
    await asUser(ids.editor, (tx) => tx.query(
      `insert into public.generation_jobs (organization_id, requested_by, kind, provider, model) values ($1, $2, 'image_to_video', 'mock', 'm1')`, [orgA, ids.editor]));
    await rejects(asUser(ids.editor, (tx) => tx.query(
      `insert into public.generation_jobs (organization_id, requested_by, kind, provider, model, status) values ($1, $2, 'image_to_video', 'mock', 'm1', 'succeeded')`, [orgA, ids.editor])), /row-level security/);
    await rejects(asUser(ids.editor, (tx) => tx.query(`update public.generation_jobs set status = 'succeeded'`)), /permission denied/);
  });

  it("only admins change branding", async () => {
    const editor = await asUser(ids.editor, (tx) => tx.query(`update public.brand_kits set primary_color = '#000000'`));
    expect(editor.affectedRows).toBe(0);
    const admin = await asUser(ids.admin, (tx) => tx.query(`update public.brand_kits set primary_color = '#112233'`));
    expect(admin.affectedRows).toBe(1);
  });
});

describe("storage", () => {
  const put = (user: string, bucket: string, name: string) =>
    asUser(user, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`, [bucket, name, user]));
  let mine = "";

  it("uploads only into a listing you can edit, in your own company's folder", async () => {
    const r = await asUser(ids.editor, (tx) => tx.query<{ id: string }>(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, $2, '5 Elm St') returning id`, [orgA, ids.editor]));
    mine = r.rows[0]!.id;
    await put(ids.editor, "listing-media", `${orgA}/listings/${mine}/photo.jpg`);
    await rejects(put(ids.editor2, "listing-media", `${orgA}/listings/${mine}/sneaky.jpg`), /row-level security/);
    await rejects(put(ids.editor, "listing-media", `${orgB}/listings/${mine}/photo.jpg`), /row-level security/);
    await rejects(put(ids.editor, "listing-media", `photo.jpg`), /row-level security/);
    await rejects(put(ids.editor, "listing-media", `${orgA}/listings/not-a-uuid/photo.jpg`), /row-level security/);
    await rejects(put(ids.viewer, "listing-media", `${orgA}/listings/${mine}/v.jpg`), /row-level security/);
  });

  it("brand files need an admin and exports are worker-only", async () => {
    await rejects(put(ids.editor, "brand-assets", `${orgA}/brand/logo.png`), /row-level security/);
    await put(ids.admin, "brand-assets", `${orgA}/brand/logo.png`);
    await rejects(put(ids.admin, "video-exports", `${orgA}/projects/${randomUUID()}/v.mp4`), /row-level security/);
  });

  it("never lists another company's or colleague's files", async () => {
    await db.query(`insert into storage.objects (bucket_id, name) values ('listing-media', $1)`, [`${orgB}/listings/${randomUUID()}/secret.jpg`]);
    const seen = await asUser(ids.editor2, (tx) => tx.query<{ name: string }>(`select name from storage.objects where bucket_id = 'listing-media'`));
    expect(seen.rows).toEqual([]);
    const own = await asUser(ids.editor, (tx) => tx.query<{ name: string }>(`select name from storage.objects where bucket_id = 'listing-media'`));
    expect(own.rows.map((r) => r.name)).toEqual([`${orgA}/listings/${mine}/photo.jpg`]);
  });

  it("media metadata must point inside the company folder", async () => {
    await rejects(asUser(ids.editor, (tx) => tx.query(
      `insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, $3, 'photo', 'listing-media', $4, 'a.jpg', 'image/jpeg', 10)`, [orgA, mine, ids.editor, `${orgB}/listings/x/a.jpg`])), /check constraint/);
  });
});
