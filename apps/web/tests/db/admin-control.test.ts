/*
 * Stage 13 security: the admin control center.
 *
 * Every administrative action is a database function that checks the caller.
 * These tests call them as ordinary people, as an Administrator and as the
 * Super Admin, and check that ordinary people cannot change limits, assign roles,
 * read company settings or secrets, or get to another employee's private files.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, server, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "";
let ids: Record<string, string> = {};
let owner: Session, adam: Session, alice: Session, bob: Session, vera: Session;
let aliceListing = "", aliceProject = "", alicePhoto = "";
const files = { photo: "", narration: "", video: "" };

const one = <T>(s: Session, sql: string, params: unknown[] = []) => s((tx) => tx.query<T>(sql, params)).then((r) => r.rows[0]!);
const rows = <T>(s: Session, sql: string, params: unknown[] = []) => s((tx) => tx.query<T>(sql, params)).then((r) => r.rows);
const updateUser = (s: Session, user: string, role: string, maxVideos: number | null, download = true) =>
  s((tx) => tx.query(`select public.admin_update_user($1, 'X', 'Y', null, $2::public.app_role, $3, true, $4, null)`, [user, role, download, maxVideos]));

beforeAll(async () => {
  db = await freshDatabase();
  ({ org, ids } = await company(db, { adam: "admin", alice: "editor", bob: "editor", vera: "viewer" }));
  owner = signedIn(db, ids.superAdmin!); adam = signedIn(db, ids.adam!);
  alice = signedIn(db, ids.alice!); bob = signedIn(db, ids.bob!); vera = signedIn(db, ids.vera!);

  // Alice's private listing, photo, video project, narration and finished export
  aliceListing = (await one<{ id: string }>(alice, `insert into public.listings (organization_id, created_by, address_line) values ($1, auth.uid(), '12 Oak Lane') returning id`, [org])).id;
  aliceProject = (await one<{ id: string }>(alice, `insert into public.video_projects (organization_id, listing_id, created_by, title) values ($1, $2, auth.uid(), '12 Oak Lane tour') returning id`, [org, aliceListing])).id;
  files.photo = `${org}/listings/${aliceListing}/${randomUUID()}.jpg`;
  files.narration = `${org}/projects/${aliceProject}/${randomUUID()}.m4a`;
  files.video = `${org}/projects/${aliceProject}/${randomUUID()}.mp4`;
  await alice(async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, auth.uid()::text), ('project-media', $2, auth.uid()::text)`, [files.photo, files.narration]);
    alicePhoto = (await tx.query<{ id: string }>(`insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
      values ($1, $2, auth.uid(), 'photo', 'listing-media', $3, 'front.jpg', 'image/jpeg', 2000000) returning id`, [org, aliceListing, files.photo])).rows[0]!.id;
    await tx.query(`insert into public.media_assets (organization_id, project_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
      values ($1, $2, auth.uid(), 'audio', 'project-media', $3, 'Narration.m4a', 'audio/mp4', 300000)`, [org, aliceProject, files.narration]);
  });
  const render = (await one<{ id: string }>(server(db), `insert into public.render_jobs (organization_id, project_id, revision, preset, requested_by, document) values ($1, $2, 1, 'master-1080p', $3, '{"clips":[]}') returning id`, [org, aliceProject, ids.alice])).id;
  await server(db)(async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('video-exports', $1, null)`, [files.video]);
    await tx.query(`update public.render_jobs set status = 'succeeded', output_path = $2, finished_at = now() where id = $1`, [render, files.video]);
  });
});

describe("ordinary employees cannot use admin controls", () => {
  it("cannot change anyone's limits, role, status, downloads or assignments", async () => {
    for (const s of [alice, vera]) {
      await rejects(updateUser(s, ids.bob!, "editor", 0), /Only administrators/);
      await rejects(updateUser(s, ids.bob!, "admin", null), /Only administrators|Super Admin/);
      await rejects(s((tx) => tx.query(`select public.admin_set_user_status($1, 'suspended')`, [ids.bob])));
      await rejects(s((tx) => tx.query(`select public.admin_assign_project($1, $2, 'editor')`, [aliceProject, ids.bob])));
      await rejects(s((tx) => tx.query(`select public.admin_assign_listing($1, $2, 'editor')`, [aliceListing, ids.bob])));
      await rejects(s((tx) => tx.query(`select public.admin_set_batch_permission($1, false)`, [ids.bob])));
    }
    // nor raise their own limits or role by writing to their profile directly
    await alice((tx) => tx.query(`update public.profiles set role = 'super_admin', max_videos_per_month = null, can_download = true where id = auth.uid()`)).catch(() => null);
    const me = await one<{ role: string }>(server(db), `select role from public.profiles where id = $1`, [ids.alice]);
    expect(me.role).toBe("editor");
    const bobRow = await one<{ status: string; max_videos_per_month: number | null }>(server(db), `select status, max_videos_per_month from public.profiles where id = $1`, [ids.bob]);
    expect(bobRow).toEqual({ status: "active", max_videos_per_month: null });
  });

  it("cannot read or change company AI settings, spending ceilings or provider keys", async () => {
    await server(db)((tx) => tx.query(`insert into public.organization_secrets (organization_id, name, ciphertext, last4) values ($1, 'muapi_api_key', 'v1:aaaaaaaaaaaaaaaaaaaaaaaa', 'abcd')`, [org]));
    for (const s of [alice, vera]) {
      expect(await rows(s, `select * from public.organization_settings`)).toEqual([]);
      const changed = await rows(s, `update public.organization_settings set monthly_ai_budget_cents = 999999, ai_enabled = true, daily_ai_budget_cents = null returning 1`);
      expect(changed).toEqual([]);
      await rejects(s((tx) => tx.query(`select * from public.organization_secrets`)), /permission denied/);
      expect((await one<{ k: unknown }>(s, `select public.provider_key_status() k`)).k).toBeNull();
      await rejects(s((tx) => tx.query(`select public.record_admin_action('ai.settings_updated', '{}')`)), /Only administrators|Only the Super Admin/);
    }
    // even an Administrator can't see the stored key, only the Super Admin sees its last 4 characters
    expect((await one<{ k: unknown }>(adam, `select public.provider_key_status() k`)).k).toBeNull();
    expect((await one<{ k: Record<string, { last4: string }> }>(owner, `select public.provider_key_status() k`)).k.muapi_api_key!.last4).toBe("abcd");
    await rejects(owner((tx) => tx.query(`select ciphertext from public.organization_secrets`)), /permission denied/);
  });

  it("cannot open the dashboard, people's activity, the AI usage log or system health", async () => {
    for (const s of [alice, vera]) {
      for (const fn of ["public.admin_dashboard()", "public.admin_user_activity()", "public.admin_ai_usage()", "public.admin_system_health()"]) {
        await rejects(s((tx) => tx.query(`select * from ${fn}`)), /Only administrators|Only the Super Admin/);
      }
      await rejects(s((tx) => tx.query(`select public.worker_heartbeat('w', 'render', 'h', '{}', null, 0, null)`)), /permission denied/);
    }
  });

  it("cannot archive, reassign, restrict or delete videos — not even their own", async () => {
    await rejects(alice((tx) => tx.query(`select public.admin_archive_project($1, true)`, [aliceProject])), /Only administrators/);
    await rejects(alice((tx) => tx.query(`select public.admin_reassign_project($1, $2)`, [aliceProject, ids.bob])), /Only administrators/);
    await rejects(alice((tx) => tx.query(`select public.admin_set_project_access($1, true, false)`, [aliceProject])), /Only administrators/);
    await rejects(alice((tx) => tx.query(`select public.admin_delete_project($1, '12 Oak Lane tour')`, [aliceProject])), /Only administrators/);
    // and not by writing the columns directly
    for (const sql of [
      `update public.video_projects set created_by = '${ids.bob}' where id = $1`,
      `update public.video_projects set restricted = true where id = $1`,
      `update public.video_projects set locked = false, archived_at = null where id = $1 and locked`,
      `update public.video_projects set archived_at = now() where id = $1`,
    ]) {
      await alice((tx) => tx.query(sql, [aliceProject])).catch(() => null);
    }
    const p = await one<{ created_by: string; restricted: boolean; archived_at: string | null }>(server(db), `select created_by, restricted, archived_at from public.video_projects where id = $1`, [aliceProject]);
    expect(p).toEqual({ created_by: ids.alice, restricted: false, archived_at: null });
  });

  it("cannot get to another employee's private listing, photos, narration or finished video", async () => {
    expect(await rows(bob, `select id from public.video_projects where id = $1`, [aliceProject])).toEqual([]);
    expect(await rows(bob, `select id from public.listings where id = $1`, [aliceListing])).toEqual([]);
    expect(await rows(bob, `select id from public.media_assets where listing_id = $1 or project_id = $2`, [aliceListing, aliceProject])).toEqual([]);
    expect(await rows(bob, `select id from public.render_jobs where project_id = $1`, [aliceProject])).toEqual([]);
    // Supabase checks storage.objects before it signs a download link
    const visible = await rows<{ name: string }>(bob, `select name from storage.objects where name = any($1)`, [Object.values(files)]);
    expect(visible).toEqual([]);
    expect(await rows(vera, `select name from storage.objects where name = any($1)`, [Object.values(files)])).toEqual([]);
    // the owner can
    expect((await rows(alice, `select name from storage.objects where name = any($1)`, [Object.values(files)])).length).toBe(3);
  });
});

describe("Administrators", () => {
  it("see the dashboard and everyone's activity, but not spending or the AI usage log", async () => {
    const d = await one<{ d: Record<string, any> }>(adam, `select public.admin_dashboard() d`);
    expect(d.d.users).toMatchObject({ total: 5, active: 5, suspended: 0 });
    expect(d.d.listings).toBe(1);
    expect(d.d.videos.total).toBe(1);
    expect(Number(d.d.storage.bytes)).toBe(2300000);
    expect(d.d.spend).toBeNull();
    const people = await rows<{ email: string; projects_owned: string; storage_bytes: string; videos_rendered: string; last_activity: string | null }>(adam, `select * from public.admin_user_activity()`);
    const a = people.find((p) => p.email === "alice@acme.test")!;
    expect([Number(a.projects_owned), Number(a.videos_rendered), Number(a.storage_bytes)]).toEqual([1, 1, 2300000]);
    expect(a.last_activity).toBeTruthy();
    await rejects(adam((tx) => tx.query(`select * from public.admin_ai_usage()`)), /Only the Super Admin/);
  });

  it("can set an employee's limits and downloads, suspend them, but not make admins", async () => {
    await updateUser(adam, ids.bob!, "editor", 3, false);
    expect(await one(server(db), `select max_videos_per_month, can_download from public.profiles where id = $1`, [ids.bob])).toEqual({ max_videos_per_month: 3, can_download: false });
    await rejects(updateUser(adam, ids.bob!, "admin", 3), /Only the Super Admin/);
    await adam((tx) => tx.query(`select public.admin_set_user_status($1, 'suspended')`, [ids.bob]));
    expect((await one<{ d: any }>(adam, `select public.admin_dashboard() d`)).d.users.suspended).toBe(1);
    await adam((tx) => tx.query(`select public.admin_set_user_status($1, 'active')`, [ids.bob]));
    await updateUser(adam, ids.bob!, "editor", null, true);
  });

  it("can lock a video read-only, but only the Super Admin restricts, archives, reassigns or deletes", async () => {
    await adam((tx) => tx.query(`select public.admin_set_project_access($1, false, true)`, [aliceProject]));
    expect(await rows(alice, `update public.video_projects set title = 'changed' where id = $1 returning id`, [aliceProject])).toEqual([]);
    await adam((tx) => tx.query(`select public.admin_set_project_access($1, false, false)`, [aliceProject]));
    expect((await rows(alice, `update public.video_projects set title = '12 Oak Lane tour' where id = $1 returning id`, [aliceProject])).length).toBe(1);
    await rejects(adam((tx) => tx.query(`select public.admin_set_project_access($1, true, false)`, [aliceProject])), /Only the Super Admin/);
    await rejects(adam((tx) => tx.query(`select public.admin_archive_project($1, true)`, [aliceProject])), /Only the Super Admin/);
    await rejects(adam((tx) => tx.query(`select public.admin_reassign_project($1, $2)`, [aliceProject, ids.bob])), /Only the Super Admin/);
    await rejects(adam((tx) => tx.query(`select public.admin_delete_project($1, '12 Oak Lane tour')`, [aliceProject])), /Only the Super Admin/);
    await rejects(adam((tx) => tx.query(`update public.organization_settings set ai_voiceover_enabled = false returning 1`)).then((r) => { if (!r.rows.length) throw new Error("refused"); }));
  });
});

describe("the Super Admin", () => {
  it("sees spending, the AI usage log and system health with worker heartbeats", async () => {
    await owner((tx) => tx.query(`update public.organization_settings set ai_enabled = true, video_ai_clip_cost_cents = 120 where organization_id = $1`, [org]));
    // a request can't lower its own price below the company's estimate
    await alice((tx) => tx.query(`insert into public.generation_jobs (organization_id, listing_id, source_asset_id, requested_by, kind, provider, model, cost_estimate_cents)
      values ($1, $2, $3, auth.uid(), 'image_to_video', 'muapi', 'kling-v2.1-standard-i2v', 0)`, [org, aliceListing, alicePhoto]));
    const d = (await one<{ d: any }>(owner, `select public.admin_dashboard() d`)).d;
    expect(Number(d.spend.month_cents)).toBe(120);
    expect(Number(d.spend.by_provider.muapi)).toBe(120);
    const log = await rows<{ kind: string; provider: string; cost_cents: string }>(owner, `select * from public.admin_ai_usage()`);
    expect(log.map((l) => [l.kind, l.provider, Number(l.cost_cents)])).toEqual([["video_clip", "muapi", 120]]);

    await server(db)((tx) => tx.query(`select public.worker_heartbeat('render-1', 'render', 'box-1', '{}', null, 4, null)`));
    const h = (await one<{ h: any }>(adam, `select public.admin_system_health() h`)).h;
    expect(h.workers).toHaveLength(1);
    expect(h.workers[0]).toMatchObject({ id: "render-1", kind: "render", jobs_done: 4, busy: false });
    expect(h.render.succeeded_24h).toBe(1);
  });

  it("the daily spending ceiling stops paid AI; switching AI camera moves off stops local depth too", async () => {
    await owner((tx) => tx.query(`update public.organization_settings set daily_ai_budget_cents = 200 where organization_id = $1`, [org]));
    const job = (provider: string) => alice((tx) => tx.query(`insert into public.generation_jobs (organization_id, listing_id, source_asset_id, requested_by, kind, provider, model)
      values ($1, $2, $3, auth.uid(), 'image_to_video', $4, 'm')`, [org, aliceListing, alicePhoto, provider]));
    await rejects(job("muapi"), /Daily AI spending limit reached/);
    await job("local-depth");
    await owner((tx) => tx.query(`update public.organization_settings set ai_depth_motion_enabled = false, ai_voiceover_enabled = false where organization_id = $1`, [org]));
    await rejects(job("local-depth"), /row-level security/);
    await rejects(alice((tx) => tx.query(`select public.start_local_ai('voiceover', $1, 'kokoro')`, [aliceProject])), /AI narration is switched off/);
    const ok = (await one<{ id: string }>(alice, `select public.start_local_ai('transcription', $1, 'zipformer') id`, [aliceProject])).id;
    await alice((tx) => tx.query(`select public.finish_local_ai($1, true, null, '{"words": 12}')`, [ok]));
    await rejects(bob((tx) => tx.query(`select public.start_local_ai('transcription', $1, 'zipformer')`, [aliceProject])), /can't edit this video/);
    await owner((tx) => tx.query(`update public.organization_settings set ai_depth_motion_enabled = true, ai_voiceover_enabled = true, daily_ai_budget_cents = null where organization_id = $1`, [org]));
  });

  it("restricting a video hides it from other administrators; the owner keeps it", async () => {
    await owner((tx) => tx.query(`select public.admin_set_project_access($1, true, false)`, [aliceProject]));
    expect(await rows(adam, `select id from public.video_projects where id = $1`, [aliceProject])).toEqual([]);
    expect(await rows(adam, `select name from storage.objects where name = $1`, [files.video])).toEqual([]);
    expect((await rows(alice, `select id from public.video_projects where id = $1`, [aliceProject])).length).toBe(1);
    await owner((tx) => tx.query(`select public.admin_set_project_access($1, false, false)`, [aliceProject]));
    expect((await rows(adam, `select id from public.video_projects where id = $1`, [aliceProject])).length).toBe(1);
  });

  it("archiving makes a video read-only; reassigning moves it to another employee", async () => {
    await owner((tx) => tx.query(`select public.admin_archive_project($1, true)`, [aliceProject]));
    expect(await rows(alice, `update public.video_projects set title = 'x' where id = $1 returning id`, [aliceProject])).toEqual([]);
    await owner((tx) => tx.query(`select public.admin_archive_project($1, false)`, [aliceProject]));

    await rejects(owner((tx) => tx.query(`select public.admin_reassign_project($1, $2)`, [aliceProject, ids.vera])), /active Editor/);
    await owner((tx) => tx.query(`select public.admin_reassign_project($1, $2)`, [aliceProject, ids.bob]));
    expect(await rows(alice, `select id from public.video_projects where id = $1`, [aliceProject])).toEqual([]);
    expect((await rows(bob, `select id from public.video_projects where id = $1`, [aliceProject])).length).toBe(1);
    expect((await rows(bob, `select name from storage.objects where name = $1`, [files.video])).length).toBe(1);
  });

  it("deleting needs the exact title, returns the stored files, and is audited", async () => {
    await rejects(owner((tx) => tx.query(`select public.admin_delete_project($1, 'wrong title')`, [aliceProject])), /Type the video's title exactly/);
    const out = await one<{ f: { bucket: string; path: string }[] }>(owner, `select public.admin_delete_project($1, '  12 Oak Lane tour ') f`, [aliceProject]);
    expect(out.f.map((x) => x.path).sort()).toEqual([files.narration, files.video].sort());
    expect(await rows(server(db), `select id from public.video_projects where id = $1`, [aliceProject])).toEqual([]);
    const audit = await rows<{ action: string; actor_id: string }>(server(db), `select action, actor_id from public.audit_log where target_id = $1 and action like 'project.%' order by id`, [aliceProject]);
    expect(audit.map((a) => a.action)).toEqual(["project.access_changed", "project.access_changed", "project.access_changed", "project.access_changed",
      "project.archived", "project.unarchived", "project.reassigned", "project.deleted"]);
    expect(audit.at(-1)!.actor_id).toBe(ids.superAdmin);
  });
});
