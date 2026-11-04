/*
 * STAGE 8 (database layer): Generate 6 Videos — permissions, limits, the render
 * queue's concurrency limit, failure isolation, AI spending ceiling, company library.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, server, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "", otherOrg = "";
let ids: Record<string, string> = {};
let alice: Session, bob: Session, vera: Session, owner: Session, worker: Session, outsider: Session;
let listing = "";

const newListing = async (as: Session, o = org) => (await as((tx) => tx.query<{ id: string }>(
  `insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [o]))).rows[0]!.id;
const startBatch = (as: Session, size = 6, l = listing) => as((tx) => tx.query<{ id: string }>(`select (public.start_video_batch($1, $2)).id`, [l, size]));
const newProject = (as: Session, batchId: string | null, o = org, l: string | null = listing) => as((tx) => tx.query<{ id: string }>(
  `insert into public.video_projects (organization_id, listing_id, created_by, title, batch_id, batch_type) values ($1, $2, auth.uid(), 'v', $3, 'luxury') returning id`, [o, l, batchId]));
/** Renders are queued by the app server (service role) on the person's behalf, after its own checks. */
const queueRender = async (as: Session, project: string, o = org) => {
  const uid = (await as((tx) => tx.query<{ u: string }>(`select auth.uid()::text u`))).rows[0]!.u;
  return (await worker((tx) => tx.query<{ id: string }>(
    `insert into public.render_jobs (organization_id, project_id, revision, preset, requested_by, document) values ($1, $2, 1, 'master-1080p', $3, '{"clips":[]}') returning id`, [o, project, uid]))).rows[0]!.id;
};
const claim = async () => (await worker((tx) => tx.query<{ id: string | null; organization_id: string | null }>(`select (j).id, (j).organization_id from (select public.claim_render_job('w') j) s`))).rows[0]!;

beforeAll(async () => {
  db = await freshDatabase();
  const c = await company(db, { adam: "admin", alice: "editor", bob: "editor", vera: "viewer" });
  org = c.org; ids = c.ids;
  alice = signedIn(db, ids.alice!); bob = signedIn(db, ids.bob!); vera = signedIn(db, ids.vera!); owner = signedIn(db, ids.superAdmin!);
  worker = server(db);
  listing = await newListing(alice);
  // a second company (for isolation checks)
  const outsiderId = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, 'x@other.test')`, [outsiderId]);
  otherOrg = (await db.query<{ id: string }>(`insert into public.organizations (name, slug) values ('Other', 'other') returning id`)).rows[0]!.id;
  await db.query(`insert into public.organization_settings (organization_id) values ($1)`, [otherOrg]);
  await db.query(`insert into public.profiles (id, organization_id, email, first_name, last_name, role, status) values ($1, $2, 'x@other.test', 'X', 'Y', 'editor', 'active')`, [outsiderId, otherOrg]);
  outsider = signedIn(db, outsiderId);
});

describe("starting a batch", () => {
  it("an editor with batch permission can start one for a listing they edit", async () => {
    expect((await startBatch(alice)).rows[0]!.id).toBeTruthy();
  });
  it("viewers, other people's listings and batches over the size limit are refused", async () => {
    await rejects(startBatch(vera));
    await rejects(startBatch(bob), /can't make videos from this listing/);
    await worker((tx) => tx.query(`update public.organization_settings set max_batch_size = 4 where organization_id = $1`, [org]));
    const capped = await alice((tx) => tx.query<{ size: number }>(`select (public.start_video_batch($1, 6)).size`, [listing]));
    expect(capped.rows[0]!.size).toBe(4);   // the company maximum caps the batch
    await rejects(startBatch(alice, 0), /at least one/);
    await worker((tx) => tx.query(`update public.organization_settings set max_batch_size = 6 where organization_id = $1`, [org]));
  });
  it("only the Super Admin can switch batch generation off for a person", async () => {
    await rejects(signedIn(db, ids.adam!)((tx) => tx.query(`select public.admin_set_batch_permission($1, false)`, [ids.alice])), /Only the Super Admin/);
    await owner((tx) => tx.query(`select public.admin_set_batch_permission($1, false)`, [ids.alice]));
    await rejects(startBatch(alice), /isn't switched on for your account/);
    await owner((tx) => tx.query(`select public.admin_set_batch_permission($1, true)`, [ids.alice]));
    const audit = await worker((tx) => tx.query(`select count(*)::int n from public.audit_log where action = 'user.batch_permission'`));
    expect(audit.rows[0]).toEqual({ n: 2 });
  });
  it("only the Super Admin can change the batch settings", async () => {
    const admin = await signedIn(db, ids.adam!)((tx) => tx.query(`update public.organization_settings set concurrent_render_limit = 9 returning 1`));
    expect(admin.rows).toHaveLength(0);
    const sa = await owner((tx) => tx.query(`update public.organization_settings set concurrent_render_limit = 3 where organization_id = $1 returning 1`, [org]));
    expect(sa.rows).toHaveLength(1);
  });
  it("projects can join only your own batch", async () => {
    const { rows: [b] } = await startBatch(alice);
    expect((await newProject(alice, b!.id)).rows).toHaveLength(1);
    const bobsListing = await newListing(bob);
    await rejects(newProject(bob, b!.id, org, bobsListing), /belongs to someone else/);
  });
});

describe("daily generation limit", () => {
  it("counts every new video of the day", async () => {
    const fresh = await newListing(bob);
    await worker((tx) => tx.query(`update public.organization_settings set daily_video_limit = 3 where organization_id = $1`, [org]));
    await rejects(startBatch(bob, 6, fresh), /Daily video limit reached \(3 per day, 3 left today\)/);
    const { rows: [b] } = await startBatch(bob, 3, fresh);
    for (let i = 0; i < 3; i++) await newProject(bob, b!.id, org, fresh);
    await rejects(newProject(bob, null, org, fresh), /Daily video limit reached/);
    await worker((tx) => tx.query(`update public.organization_settings set daily_video_limit = null where organization_id = $1`, [org]));
  });
});

describe("render queue", () => {
  it("never runs more than the company's concurrent limit, and other companies keep going", async () => {
    await worker((tx) => tx.query(`update public.render_jobs set status = 'cancelled' where status in ('queued','running')`));
    await worker((tx) => tx.query(`update public.organization_settings set concurrent_render_limit = 2 where organization_id = $1`, [org]));
    const { rows: [b] } = await startBatch(alice);
    const jobs: string[] = [];
    for (let i = 0; i < 6; i++) jobs.push(await queueRender(alice, (await newProject(alice, b!.id)).rows[0]!.id));
    const outsiderListing = await newListing(outsider, otherOrg);
    const theirs = await queueRender(outsider, (await newProject(outsider, null, otherOrg, outsiderListing)).rows[0]!.id, otherOrg);

    const first = await claim(), second = await claim();
    expect([first.organization_id, second.organization_id]).toEqual([org, org]);
    const third = await claim();
    expect(third.id).toBe(theirs);           // limit reached for our company: the other company's job goes next
    expect((await claim()).id).toBeNull();   // nothing else may start yet

    // one video fails; the others carry on
    await worker((tx) => tx.query(`update public.render_jobs set status = 'failed', error_message = 'boom' where id = $1`, [first.id]));
    await worker((tx) => tx.query(`update public.render_jobs set status = 'succeeded' where id = $1`, [second.id]));
    const next = [await claim(), await claim()];
    expect(next.every((j) => j.organization_id === org)).toBe(true);
    const states = await worker((tx) => tx.query<{ status: string }>(`select status from public.render_jobs where id = any($1) order by created_at`, [jobs]));
    expect(states.rows.map((r) => r.status)).toEqual(["failed", "succeeded", "running", "running", "queued", "queued"]);
  });
});

describe("AI spending ceiling", () => {
  it("stops paid AI jobs once the monthly ceiling is reached; free local depth still works", async () => {
    const path = `${org}/listings/${listing}/${randomUUID()}.jpg`;
    const photo = (await alice(async (tx) => {
      await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, auth.uid()::text)`, [path]);
      return tx.query<{ id: string }>(`insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
        values ($1, $2, auth.uid(), 'photo', 'listing-media', $3, 'a.jpg', 'image/jpeg', 10) returning id`, [org, listing, path]);
    })).rows[0]!.id;
    const job = (provider: string, cents: number) => alice((tx) => tx.query(
      `insert into public.generation_jobs (organization_id, listing_id, source_asset_id, requested_by, kind, provider, model, cost_estimate_cents)
       values ($1, $2, $3, auth.uid(), 'image_to_video', $4, 'm', $5)`, [org, listing, photo, provider, cents]));
    await worker((tx) => tx.query(`update public.organization_settings set ai_enabled = true, monthly_ai_budget_cents = 500 where organization_id = $1`, [org]));
    await job("muapi", 300);
    await rejects(job("muapi", 300), /Monthly AI spending limit reached/);
    await job("local-depth", 0);
    await worker((tx) => tx.query(`update public.organization_settings set ai_enabled = false, monthly_ai_budget_cents = null where organization_id = $1`, [org]));
  });
});

describe("company library", () => {
  it("a finished video saved to the library is visible (and downloadable) to everyone in the company only", async () => {
    const p = (await newProject(alice, null)).rows[0]!.id;
    const r = await queueRender(alice, p);
    const path = `${org}/projects/${p}/${r}.mp4`;
    await rejects(alice((tx) => tx.query(`insert into public.library_videos (organization_id, render_job_id, project_id, title, aspect, output_path, saved_by) values ($1,$2,$3,'t','16:9',$4,auth.uid())`, [org, r, p, path])));
    await worker(async (tx) => {
      await tx.query(`update public.render_jobs set status = 'succeeded', output_path = $2 where id = $1`, [r, path]);
      await tx.query(`insert into storage.objects (bucket_id, name) values ('video-exports', $1)`, [path]);
    });
    // a path that isn't the render's own is refused
    await rejects(alice((tx) => tx.query(`insert into public.library_videos (organization_id, render_job_id, project_id, title, aspect, output_path, saved_by) values ($1,$2,$3,'t','16:9','${org}/projects/x/y.mp4',auth.uid())`, [org, r, p])));
    await alice((tx) => tx.query(`insert into public.library_videos (organization_id, render_job_id, project_id, title, aspect, output_path, saved_by) values ($1,$2,$3,'Luxury','16:9',$4,auth.uid())`, [org, r, p, path]));

    // bob can't see alice's project, but sees the library video and may read the file
    expect((await bob((tx) => tx.query(`select id from public.video_projects where id = $1`, [p]))).rows).toHaveLength(0);
    expect((await bob((tx) => tx.query(`select title from public.library_videos`))).rows).toEqual([{ title: "Luxury" }]);
    expect((await bob((tx) => tx.query(`select name from storage.objects where name = $1`, [path]))).rows).toHaveLength(1);
    // another company sees nothing
    expect((await outsider((tx) => tx.query(`select title from public.library_videos`))).rows).toHaveLength(0);
    expect((await outsider((tx) => tx.query(`select name from storage.objects where name = $1`, [path]))).rows).toHaveLength(0);
  });
});
