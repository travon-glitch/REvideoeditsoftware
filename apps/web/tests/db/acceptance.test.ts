/*
 * STAGE 3 ACCEPTANCE TEST — admin-controlled accounts and per-project isolation.
 *
 * Runs the real migrations on PGlite (embedded Postgres) and simulates Supabase
 * requests (SET ROLE authenticated + JWT sub). Storage reads are checked on
 * storage.objects, which is what Supabase evaluates before it will create a
 * signed (download) URL for a file.
 *
 *  1. Super Admin is bootstrapped; creates an Administrator.
 *  2. The Administrator creates two employee accounts (Alice, Bob) + a viewer.
 *  3. Each employee makes their own private project with photos and an export.
 *  4. The Administrator assigns DIFFERENT company projects to each employee.
 *  5. Project lists, photos, exports, revisions and assignments stay isolated.
 *  6. The Super Admin (and Administrator, read-only) can see both.
 *  7. Suspension, permissions, limits and the audit trail are verified.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");
let db: PGlite;

const U = { superAdmin: randomUUID(), admin: randomUUID(), alice: randomUUID(), bob: randomUUID(), vera: randomUUID() };
let org = "";
const P: Record<string, string> = {}; // projects
const L: Record<string, string> = {}; // listings
const files: Record<string, string> = {};

async function as<T>(role: "authenticated" | "service_role", userId: string | null, fn: (tx: Transaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}
const asUser = <T>(id: string, fn: (tx: Transaction) => Promise<T>) => as("authenticated", id, fn);
const asServer = <T>(fn: (tx: Transaction) => Promise<T>) => as("service_role", null, fn);

async function rejects(p: Promise<unknown>, pattern?: RegExp) {
  let error: unknown = null;
  try { await p; } catch (e) { error = e; }
  expect(error, "expected the database to refuse").not.toBeNull();
  if (pattern) expect(String((error as Error).message)).toMatch(pattern);
}

/** What the server action does: Supabase Auth invites the email, then create_user_profile() runs as the service role. */
async function createUser(actor: string, id: string, first: string, last: string, role: string, opts: { download?: boolean; ai?: boolean; maxVideos?: number | null } = {}) {
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [id, `${first.toLowerCase()}@acme.test`]);
  return asServer((tx) => tx.query(
    `select (public.create_user_profile($1, $2, $3, $4, $5, $6, $7::public.app_role, $8, $9, $10, null)).id`,
    [actor, id, `${first.toLowerCase()}@acme.test`, first, last, "Agent", role, opts.download ?? true, opts.ai ?? true, opts.maxVideos ?? null]));
}

const projectIds = (user: string) =>
  asUser(user, (tx) => tx.query<{ id: string }>(`select id from public.video_projects order by created_at`)).then((r) => r.rows.map((x) => x.id).sort());
const visibleFiles = (user: string, bucket: string) =>
  asUser(user, (tx) => tx.query<{ name: string }>(`select name from storage.objects where bucket_id = $1`, [bucket])).then((r) => r.rows.map((x) => x.name).sort());
const sorted = (...xs: string[]) => [...xs].sort();

async function makeOwnProject(user: string, key: string) {
  await asUser(user, async (tx) => {
    L[key] = (await tx.query<{ id: string }>(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, $2, $3) returning id`, [org, user, `${key} Street`])).rows[0]!.id;
    P[key] = (await tx.query<{ id: string }>(
      `insert into public.video_projects (organization_id, listing_id, created_by, title) values ($1, $2, $3, $4) returning id`, [org, L[key], user, `${key} video`])).rows[0]!.id;
    await tx.query(`insert into public.project_revisions (project_id, revision, organization_id, document, author_id) values ($1, 1, $2, '{}', $3)`, [P[key], org, user]);
    files[`${key}.photo`] = `${org}/listings/${L[key]}/${randomUUID()}.jpg`;
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, $2)`, [files[`${key}.photo`], user]);
    await tx.query(
      `insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, $3, 'photo', 'listing-media', $4, 'front.jpg', 'image/jpeg', 1000)`, [org, L[key], user, files[`${key}.photo`]]);
  });
  // finished video written by the render worker (service role)
  files[`${key}.export`] = `${org}/projects/${P[key]}/final.mp4`;
  await asServer((tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('video-exports', $1)`, [files[`${key}.export`]]));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
});

describe("Stage 3 acceptance: admin-controlled accounts and isolated projects", () => {
  it("1. bootstraps the Super Admin, who creates an Administrator", async () => {
    const code = createHash("sha256").update("setup").digest("hex");
    await db.query(`insert into auth.users (id, email) values ($1, 'owner@acme.test')`, [U.superAdmin]);
    await asServer((tx) => tx.query(`select public.bootstrap_create_token($1, 60)`, [code]));
    org = (await asServer((tx) => tx.query<{ o: string }>(
      `select public.bootstrap_complete($1, $2, 'owner@acme.test', 'Olivia Owner', 'Acme Realty', 'acme') o`, [code, U.superAdmin]))).rows[0]!.o;
    await createUser(U.superAdmin, U.admin, "Adam", "Admin", "admin");
    await asUser(U.admin, (tx) => tx.query(`select public.activate_self()`));
    const p = await db.query<{ role: string; status: string; full_name: string }>(`select role, status, full_name from public.profiles where id = $1`, [U.admin]);
    expect(p.rows[0]).toEqual({ role: "admin", status: "active", full_name: "Adam Admin" });
  });

  it("2. only administrators create accounts; admins cannot create admins; no Super Admins", async () => {
    await createUser(U.admin, U.alice, "Alice", "Agent", "editor");
    await createUser(U.admin, U.bob, "Bob", "Broker", "editor");
    await createUser(U.admin, U.vera, "Vera", "Viewer", "viewer", { download: false, ai: false });
    for (const id of [U.alice, U.bob, U.vera]) await asUser(id, (tx) => tx.query(`select public.activate_self()`));

    const extra = randomUUID();
    await rejects(createUser(U.alice, extra, "Eve", "Editor", "editor"), /Only administrators/);
    await rejects(createUser(U.admin, extra, "Eve", "Admin", "admin"), /Only the Super Admin/);
    await rejects(createUser(U.superAdmin, extra, "Eve", "Super", "super_admin"), /cannot be granted/);
    // the backend function is not callable from a browser session at all
    await rejects(asUser(U.admin, (tx) => tx.query(
      `select public.create_user_profile($1, $2, 'x@acme.test', 'X', 'Y', null, 'editor', true, true, null, null)`, [U.admin, extra])), /permission denied/);
    // there is no way to sign yourself up: no profile, no access
    const strangerId = randomUUID();
    await db.query(`insert into auth.users (id, email) values ($1, 'stranger@acme.test')`, [strangerId]);
    const stranger = await asUser(strangerId, (tx) => tx.query(`select id from public.video_projects`));
    expect(stranger.rows).toEqual([]);
  });

  it("3. each employee makes a private project with photos and an export", async () => {
    await makeOwnProject(U.alice, "alice");
    await makeOwnProject(U.bob, "bob");
    // two company projects owned by the Super Admin, to be assigned
    await asUser(U.superAdmin, async (tx) => {
      P.harbor = (await tx.query<{ id: string }>(`insert into public.video_projects (organization_id, created_by, title) values ($1, $2, 'Harbor View') returning id`, [org, U.superAdmin])).rows[0]!.id;
      P.maple = (await tx.query<{ id: string }>(`insert into public.video_projects (organization_id, created_by, title) values ($1, $2, 'Maple Court') returning id`, [org, U.superAdmin])).rows[0]!.id;
    });
    for (const k of ["harbor", "maple"]) {
      files[`${k}.export`] = `${org}/projects/${P[k]}/final.mp4`;
      await asServer((tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('video-exports', $1)`, [files[`${k}.export`]]));
    }
  });

  it("4. the Administrator assigns different projects to each employee", async () => {
    await asUser(U.admin, (tx) => tx.query(`select public.admin_assign_project($1, $2, 'editor')`, [P.harbor, U.alice]));
    await asUser(U.admin, (tx) => tx.query(`select public.admin_assign_project($1, $2, 'viewer')`, [P.maple, U.bob]));
    await rejects(asUser(U.alice, (tx) => tx.query(`select public.admin_assign_project($1, $2, 'editor')`, [P.maple, U.alice])), /Only administrators/);
    await rejects(asUser(U.admin, (tx) => tx.query(`insert into public.project_members (project_id, user_id, organization_id) values ($1, $2, $3)`, [P.bob, U.alice, org])), /permission denied/);
  });

  it("5a. project lists are isolated", async () => {
    expect(await projectIds(U.alice)).toEqual(sorted(P.alice!, P.harbor!));
    expect(await projectIds(U.bob)).toEqual(sorted(P.bob!, P.maple!));
    const aliceListings = await asUser(U.alice, (tx) => tx.query<{ id: string }>(`select id from public.listings`));
    expect(aliceListings.rows.map((r) => r.id)).toEqual([L.alice]);
  });

  it("5b. downloaded files are isolated (photos and finished videos)", async () => {
    expect(await visibleFiles(U.alice, "listing-media")).toEqual([files["alice.photo"]]);
    expect(await visibleFiles(U.bob, "listing-media")).toEqual([files["bob.photo"]]);
    expect(await visibleFiles(U.alice, "video-exports")).toEqual(sorted(files["alice.export"]!, files["harbor.export"]!));
    expect(await visibleFiles(U.bob, "video-exports")).toEqual(sorted(files["bob.export"]!, files["maple.export"]!));
    const media = await asUser(U.alice, (tx) => tx.query<{ storage_path: string }>(`select storage_path from public.media_assets`));
    expect(media.rows.map((r) => r.storage_path)).toEqual([files["alice.photo"]]);
  });

  it("5c. direct attempts on a colleague's project are refused", async () => {
    const byId = await asUser(U.alice, (tx) => tx.query(`select id from public.video_projects where id = $1`, [P.bob]));
    expect(byId.rows).toEqual([]);
    const access = await asUser(U.alice, (tx) => tx.query<{ a: string }>(`select public.project_access($1) a`, [P.bob]));
    expect(access.rows[0]!.a).toBe("none");
    const upd = await asUser(U.alice, (tx) => tx.query(`update public.video_projects set title = 'mine now' where id = $1`, [P.bob]));
    expect(upd.affectedRows).toBe(0);
    const del = await asUser(U.alice, (tx) => tx.query(`delete from public.video_projects where id = $1`, [P.bob]));
    expect(del.affectedRows).toBe(0);
    const revs = await asUser(U.alice, (tx) => tx.query(`select * from public.project_revisions where project_id = $1`, [P.bob]));
    expect(revs.rows).toEqual([]);
    await rejects(asUser(U.alice, (tx) => tx.query(
      `insert into public.project_revisions (project_id, revision, organization_id, document, author_id) values ($1, 2, $2, '{}', $3)`, [P.bob, org, U.alice])), /row-level security/);
    await rejects(asUser(U.alice, (tx) => tx.query(
      `insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, $2)`, [`${org}/listings/${L.bob}/planted.jpg`, U.alice])), /row-level security/);
    const rm = await asUser(U.alice, (tx) => tx.query(`delete from storage.objects where name = $1`, [files["bob.photo"]]));
    expect(rm.affectedRows).toBe(0);
    await rejects(asUser(U.alice, (tx) => tx.query(
      `insert into public.video_projects (organization_id, listing_id, created_by, title) values ($1, $2, $3, 'stolen listing')`, [org, L.bob, U.alice])), /row-level security/);
    const members = await asUser(U.alice, (tx) => tx.query<{ project_id: string }>(`select project_id from public.project_members`));
    expect(members.rows.map((r) => r.project_id)).toEqual([P.harbor]);
  });

  it("5d. assignment access levels hold: viewer access cannot edit", async () => {
    expect((await asUser(U.alice, (tx) => tx.query(`update public.video_projects set title = 'Harbor View (edited)' where id = $1`, [P.harbor]))).affectedRows).toBe(1);
    expect((await asUser(U.bob, (tx) => tx.query(`update public.video_projects set title = 'nope' where id = $1`, [P.maple]))).affectedRows).toBe(0);
  });

  it("6. the Super Admin sees both employees' projects and files; the Administrator can see but not edit", async () => {
    const all = sorted(P.alice!, P.bob!, P.harbor!, P.maple!);
    expect(await projectIds(U.superAdmin)).toEqual(all);
    expect(await visibleFiles(U.superAdmin, "listing-media")).toEqual(sorted(files["alice.photo"]!, files["bob.photo"]!));
    expect((await visibleFiles(U.superAdmin, "video-exports")).length).toBe(4);
    expect((await asUser(U.superAdmin, (tx) => tx.query(`update public.video_projects set status = 'approved' where id = $1`, [P.bob]))).affectedRows).toBe(1);

    expect(await projectIds(U.admin)).toEqual(all);
    expect((await asUser(U.admin, (tx) => tx.query(`update public.video_projects set title = 'x' where id = $1`, [P.alice]))).affectedRows).toBe(0);
  });

  it("7a. viewers see only assigned projects and download only when permitted", async () => {
    await asUser(U.admin, (tx) => tx.query(`select public.admin_assign_project($1, $2, 'editor')`, [P.harbor, U.vera]));
    expect(await projectIds(U.vera)).toEqual([P.harbor]);
    const level = await db.query<{ access: string }>(`select access from public.project_members where user_id = $1`, [U.vera]);
    expect(level.rows[0]!.access).toBe("viewer"); // viewers are always downgraded to view-only
    expect(await visibleFiles(U.vera, "video-exports")).toEqual([]);
    await rejects(asUser(U.vera, (tx) => tx.query(`insert into public.video_projects (organization_id, created_by, title) values ($1, $2, 'v')`, [org, U.vera])), /row-level security/);

    await asUser(U.admin, (tx) => tx.query(`select public.admin_update_user($1, 'Vera', 'Viewer', 'Assistant', 'viewer', true, false, null, null)`, [U.vera]));
    expect(await visibleFiles(U.vera, "video-exports")).toEqual([files["harbor.export"]]);
  });

  it("7b. monthly limits are enforced by the database", async () => {
    await asUser(U.admin, (tx) => tx.query(`select public.admin_update_user($1, 'Alice', 'Agent', 'Agent', 'editor', true, true, 1, 0)`, [U.alice]));
    await rejects(asUser(U.alice, (tx) => tx.query(`insert into public.video_projects (organization_id, created_by, title) values ($1, $2, 'second')`, [org, U.alice])), /Monthly video limit/);
    await rejects(asUser(U.alice, (tx) => tx.query(
      `insert into public.generation_jobs (organization_id, requested_by, kind, provider, model) values ($1, $2, 'image_to_video', 'mock', 'm')`, [org, U.alice])), /Monthly AI limit/);
    await rejects(asUser(U.vera, (tx) => tx.query(
      `insert into public.generation_jobs (organization_id, requested_by, kind, provider, model) values ($1, $2, 'image_to_video', 'mock', 'm')`, [org, U.vera])), /row-level security/);
  });

  it("7c. suspended and deactivated accounts lose access immediately", async () => {
    await asUser(U.admin, (tx) => tx.query(`select public.admin_set_user_status($1, 'suspended')`, [U.bob]));
    expect(await projectIds(U.bob)).toEqual([]);
    expect(await visibleFiles(U.bob, "listing-media")).toEqual([]);
    await asUser(U.admin, (tx) => tx.query(`select public.admin_set_user_status($1, 'active')`, [U.bob]));
    expect(await projectIds(U.bob)).toEqual(sorted(P.bob!, P.maple!));

    await asUser(U.admin, (tx) => tx.query(`select public.admin_set_user_status($1, 'deactivated')`, [U.bob]));
    expect(await projectIds(U.bob)).toEqual([]);
    await rejects(asUser(U.admin, (tx) => tx.query(`select public.admin_set_user_status($1, 'active')`, [U.bob])), /Only the Super Admin can restore/);
    await asUser(U.superAdmin, (tx) => tx.query(`select public.admin_set_user_status($1, 'active')`, [U.bob]));
    await rejects(asUser(U.admin, (tx) => tx.query(`select public.admin_set_user_status($1, 'suspended')`, [U.admin])), /your own/);
    await rejects(asUser(U.admin, (tx) => tx.query(`select public.admin_set_user_status($1, 'suspended')`, [U.superAdmin])), /cannot be granted or changed/);
  });

  it("7d. role changes, suspensions, assignments and permission changes are in the audit log", async () => {
    await asUser(U.admin, (tx) => tx.query(`select public.admin_update_user($1, 'Bob', 'Broker', 'Agent', 'viewer', true, true, null, null)`, [U.bob]));
    await asUser(U.admin, (tx) => tx.query(`select public.admin_record_access_reset($1)`, [U.bob]));
    await asUser(U.admin, (tx) => tx.query(`select public.admin_unassign_project($1, $2)`, [P.maple, U.bob]));

    const log = await asUser(U.admin, (tx) => tx.query<{ action: string; actor_id: string; target_id: string }>(
      `select action, actor_id, target_id from public.audit_log order by id`));
    const actions = log.rows.map((r) => r.action);
    for (const a of ["user.created", "user.activated", "user.role_changed", "user.suspended", "user.deactivated",
                     "user.permissions_changed", "user.access_reset", "project.assigned", "project.unassigned"]) {
      expect(actions, a).toContain(a);
    }
    expect(actions.filter((a) => a === "user.created").length).toBe(4);
    const suspension = log.rows.find((r) => r.action === "user.suspended")!;
    expect(suspension).toMatchObject({ actor_id: U.admin, target_id: U.bob });
    // employees cannot read or forge the audit log
    expect((await asUser(U.alice, (tx) => tx.query(`select id from public.audit_log`))).rows).toEqual([]);
    await rejects(asUser(U.alice, (tx) => tx.query(`insert into public.audit_log (organization_id, action) values ($1, 'x')`, [org])), /permission denied/);
  });
});
