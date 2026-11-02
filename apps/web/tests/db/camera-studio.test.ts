/*
 * STAGE 7 (database layer): camera moves on photos, AI clips and the AI job queue.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, server, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "";
let alice: Session, bob: Session, vera: Session, worker: Session;
let listing = "", photo = "", bobsListing = "", bobsPhoto = "";

async function addPhoto(as: Session, listingId: string) {
  const path = `${org}/listings/${listingId}/${randomUUID()}.jpg`;
  return (await as(async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, auth.uid()::text)`, [path]);
    return tx.query<{ id: string }>(
      `insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, auth.uid(), 'photo', 'listing-media', $3, 'front.jpg', 'image/jpeg', 1000) returning id`, [org, listingId, path]);
  })).rows[0]!.id;
}
const newListing = async (as: Session) => (await as((tx) => tx.query<{ id: string }>(
  `insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [org]))).rows[0]!.id;
const queueJob = (as: Session, over: Record<string, unknown> = {}) => as((tx) => tx.query<{ id: string }>(
  `insert into public.generation_jobs (organization_id, listing_id, source_asset_id, requested_by, kind, provider, model, camera_move, input)
   values ($1, $2, $3, auth.uid(), 'image_to_video', $4, 'midas', 'orbit_right', '{"duration":4}') returning id`,
  [org, over.listing ?? listing, over.photo ?? photo, over.provider ?? "local-depth"]));

beforeAll(async () => {
  db = await freshDatabase();
  const c = await company(db, { alice: "editor", bob: "editor", vera: "viewer" });
  org = c.org;
  alice = signedIn(db, c.ids.alice!); bob = signedIn(db, c.ids.bob!); vera = signedIn(db, c.ids.vera!);
  worker = server(db);
  listing = await newListing(alice);
  photo = await addPhoto(alice, listing);
  bobsListing = await newListing(bob);
  bobsPhoto = await addPhoto(bob, bobsListing);
});

describe("camera move saved on a photo", () => {
  it("the listing's editor can save one; others can't", async () => {
    await alice((tx) => tx.query(`update public.media_assets set camera_spec = '{"move":"push_in"}' where id = $1`, [photo]));
    const r = await bob((tx) => tx.query(`update public.media_assets set camera_spec = '{"move":"zoom"}' where id = $1 returning id`, [photo]));
    expect(r.rows).toHaveLength(0);
    const now = await alice((tx) => tx.query<{ camera_spec: { move: string } }>(`select camera_spec from public.media_assets where id = $1`, [photo]));
    expect(now.rows[0]!.camera_spec.move).toBe("push_in");
  });
});

describe("AI camera jobs", () => {
  it("an editor can queue the local depth method for a photo of their listing", async () => {
    expect((await queueJob(alice)).rows).toHaveLength(1);
  });

  it("can't use someone else's listing or photo, and viewers can't queue at all", async () => {
    await rejects(queueJob(alice, { listing: bobsListing, photo: bobsPhoto }));
    await rejects(queueJob(alice, { photo: bobsPhoto }));
    await rejects(queueJob(vera));
  });

  it("external generative providers need the company to switch AI on", async () => {
    await rejects(queueJob(alice, { provider: "muapi" }));
    await worker((tx) => tx.query(`update public.organization_settings set ai_enabled = true where organization_id = $1`, [org]));
    expect((await queueJob(alice, { provider: "muapi" })).rows).toHaveLength(1);
    await worker((tx) => tx.query(`update public.organization_settings set ai_enabled = false where organization_id = $1`, [org]));
  });

  it("people can't mark their own job finished; the worker claims jobs only for providers it serves", async () => {
    const { rows: [job] } = await queueJob(alice);
    const upd = await alice((tx) => tx.query(`update public.generation_jobs set status = 'succeeded' where id = $1 returning id`, [job!.id]).catch(() => ({ rows: [] })));
    expect(upd.rows).toHaveLength(0);
    await rejects(alice((tx) => tx.query(`select public.claim_generation_job('x', array['local-depth'])`)));
    const none = await worker((tx) => tx.query<{ id: string | null }>(`select (public.claim_generation_job('w1', array['nope'])).id`));
    expect(none.rows[0]!.id).toBeNull();
    const got = await worker((tx) => tx.query<{ id: string; status: string }>(`select (j).id, (j).status from (select public.claim_generation_job('w1', array['local-depth']) j) s`));
    expect(got.rows[0]!.status).toBe("running");
  });
});

describe("AI clips", () => {
  let clip = "";
  it("only the AI worker can create them, in the private ai-clips bucket", async () => {
    const path = `${org}/listings/${listing}/${randomUUID()}.mp4`;
    await rejects(alice((tx) => tx.query(
      `insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, auth.uid(), 'ai_clip', 'ai-clips', $3, 'x.mp4', 'video/mp4', 10)`, [org, listing, path])));
    const r = await worker((tx) => tx.query<{ id: string }>(
      `insert into public.media_assets (organization_id, listing_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, source_asset_id, ai_review)
       values ($1, $2, 'ai_clip', 'ai-clips', $3, 'Orbit.mp4', 'video/mp4', 10, $4, '{"flags":[{"code":"stretched_edges"}]}') returning id`, [org, listing, path, photo]));
    clip = r.rows[0]!.id;
    // an AI clip can't be put in the photo bucket, and a camera move only belongs on photos
    await rejects(worker((tx) => tx.query(
      `insert into public.media_assets (organization_id, listing_id, kind, bucket, storage_path, file_name, mime_type, size_bytes)
       values ($1, $2, 'ai_clip', 'listing-media', $3, 'x.mp4', 'video/mp4', 10)`, [org, listing, `${org}/listings/${listing}/y.mp4`])));
  });

  it("people can't erase the automatic review or relabel the clip", async () => {
    await rejects(alice((tx) => tx.query(`update public.media_assets set ai_review = '{"flags":[]}' where id = $1`, [clip])), /can't be changed/);
    await rejects(alice((tx) => tx.query(`update public.media_assets set kind = 'photo', bucket = 'listing-media' where id = $1`, [clip])));
  });

  it("the listing's editor can approve it or report a problem (audited); others can't", async () => {
    const d = await alice((tx) => tx.query<{ d: { status: string; note: string } }>(`select public.review_ai_clip($1, 'problem', 'Window frame bends') d`, [clip]));
    expect(d.rows[0]!.d).toMatchObject({ status: "problem", note: "Window frame bends" });
    await rejects(bob((tx) => tx.query(`select public.review_ai_clip($1, 'approved')`, [clip])));
    const log = await worker((tx) => tx.query(`select action from public.audit_log where target_id = $1`, [clip]));
    expect(log.rows).toEqual([{ action: "ai_clip.problem" }]);
  });

  it("storage: only people who can see the listing can read the clip file", async () => {
    const path = `${org}/listings/${listing}/${randomUUID()}.mp4`;
    await worker((tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('ai-clips', $1)`, [path]));
    expect((await alice((tx) => tx.query(`select name from storage.objects where name = $1`, [path]))).rows).toHaveLength(1);
    expect((await bob((tx) => tx.query(`select name from storage.objects where name = $1`, [path]))).rows).toHaveLength(0);
    await rejects(alice((tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('ai-clips', $1, auth.uid()::text)`, [`${org}/listings/${listing}/fake.mp4`])));
  });
});
