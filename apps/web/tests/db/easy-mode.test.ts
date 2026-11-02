/*
 * STAGE 6 (database layer): photo thumbnails and the Easy Mode styles.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "";
let alice: Session, bob: Session;
let listing = "";
let other = "";

beforeAll(async () => {
  db = await freshDatabase();
  const c = await company(db, { alice: "editor", bob: "editor" });
  org = c.org;
  alice = signedIn(db, c.ids.alice!);
  bob = signedIn(db, c.ids.bob!);
  const mk = (as: Session) => as((tx) => tx.query<{ id: string }>(
    `insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [org]));
  listing = (await mk(alice)).rows[0]!.id;
  other = (await mk(bob)).rows[0]!.id;
});

async function addPhoto(listingId: string, thumb: string | null) {
  const id = randomUUID();
  const path = `${org}/listings/${listingId}/${id}.jpg`;
  return alice(async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, auth.uid()::text)`, [path]);
    if (thumb) await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, auth.uid()::text)`, [thumb]);
    return tx.query<{ id: string; thumbnail_path: string | null }>(
      `insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, thumbnail_path, file_name, mime_type, size_bytes)
       values ($1, $2, auth.uid(), 'photo', 'listing-media', $3, $4, 'a.jpg', 'image/jpeg', 1000) returning id, thumbnail_path`,
      [org, listingId, path, thumb]);
  });
}

describe("photo thumbnails", () => {
  it("are stored next to the photo, in the same listing folder", async () => {
    const thumb = `${org}/listings/${listing}/${randomUUID()}.thumb.jpg`;
    const r = await addPhoto(listing, thumb);
    expect(r.rows[0]!.thumbnail_path).toBe(thumb);
    expect((await addPhoto(listing, null)).rows[0]!.thumbnail_path).toBeNull();
  });

  it("can't point at another listing's or company's files", async () => {
    await rejects(addPhoto(listing, `${org}/listings/${other}/${randomUUID()}.thumb.jpg`));
    await rejects(addPhoto(listing, `${randomUUID()}/listings/${listing}/${randomUUID()}.thumb.jpg`));
    await rejects(addPhoto(listing, `${org}/listings/${listing}/${randomUUID()}.png`));
  });

  it("are private like the photos: another employee can't read them", async () => {
    const thumb = `${org}/listings/${listing}/${randomUUID()}.thumb.jpg`;
    await addPhoto(listing, thumb);
    const seen = await bob((tx) => tx.query(`select name from storage.objects where name = $1`, [thumb]));
    expect(seen.rows).toHaveLength(0);
  });
});

describe("Easy Mode styles", () => {
  it("are the six built-in templates, in order", async () => {
    const r = await alice((tx) => tx.query<{ slug: string; name: string }>(
      `select slug, name from public.video_templates where is_active and organization_id is null order by sort_order`));
    expect(r.rows.map((t) => t.name)).toEqual(["Luxury Cinematic", "Modern", "Just Listed", "Open House", "Social Media Reel", "Property Highlights"]);
  });
});
