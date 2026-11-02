/*
 * STAGE 4 ACCEPTANCE (database layer): listings and photos.
 *
 *  "A user must be able to upload 20 photographs, save the listing, log out,
 *   log back in, and reopen the project with all data preserved."
 *  + secure image access and deletion.
 *
 * Each `alice(...)` call is a separate request with a fresh transaction; "logging
 * out and back in" is a new session for the same user id — nothing is carried
 * over except what the database stored. Storage objects are rows in
 * storage.objects, which is what Supabase checks before uploads, downloads
 * (signed URLs) and deletions.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { company, freshDatabase, rejects, signedIn, type Session } from "./helpers";

let db: PGlite;
let org = "";
let ids: Record<string, string> = {};
let alice: Session, bob: Session, admin: Session, vera: Session, owner: Session;
let listing = "";
const photoIds: string[] = [];
const paths: string[] = [];

const LISTING_FIELDS = {
  address_line: "742 Evergreen Terrace", city: "Springfield", state: "OR", postal_code: "97403",
  price: 525000, bedrooms: 4, bathrooms: 2.5, square_feet: 2150, property_type: "single_family",
  description: "Bright family home with a big backyard.", agent_name: "Alice Test", brokerage: "Acme Realty",
  contact_phone: "555-0100", contact_email: "alice@acme.test",
  open_house_date: "2026-11-15", open_house_start: "13:00:00", open_house_end: "15:00:00",
};

async function uploadPhoto(as: Session, listingId: string, name: string) {
  const path = `${org}/listings/${listingId}/${randomUUID()}.jpg`;
  return as(async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, auth.uid()::text)`, [path]);
    const r = await tx.query<{ id: string }>(
      `insert into public.media_assets (organization_id, listing_id, uploaded_by, kind, bucket, storage_path, file_name, mime_type, size_bytes, width, height, sort_order)
       values ($1, $2, auth.uid(), 'photo', 'listing-media', $3, $4, 'image/jpeg', 250000, 4000, 3000,
               (select count(*) from public.media_assets where listing_id = $2))
       returning id`, [org, listingId, path, name]);
    return { id: r.rows[0]!.id, path };
  });
}

beforeAll(async () => {
  db = await freshDatabase();
  ({ org, ids } = await company(db, { adam: "admin", alice: "editor", bob: "editor", vera: "viewer" }));
  alice = signedIn(db, ids.alice!);
  bob = signedIn(db, ids.bob!);
  admin = signedIn(db, ids.adam!);
  vera = signedIn(db, ids.vera!);
  owner = signedIn(db, ids.superAdmin!);
});

describe("Stage 4 acceptance: 20 photos survive sign-out and sign-in", () => {
  it("saves a draft with nothing filled in", async () => {
    const r = await alice((tx) => tx.query<{ id: string; workflow_state: string; created_by: string; organization_id: string }>(
      `insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id, workflow_state, created_by, organization_id`, [org]));
    listing = r.rows[0]!.id;
    expect(r.rows[0]).toMatchObject({ workflow_state: "draft", created_by: ids.alice, organization_id: org });
  });

  it("fills in the property information", async () => {
    const cols = Object.keys(LISTING_FIELDS);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    const r = await alice((tx) => tx.query(`update public.listings set ${sets} where id = $1`, [listing, ...Object.values(LISTING_FIELDS)]));
    expect(r.affectedRows).toBe(1);
  });

  it("uploads 20 photographs", async () => {
    for (let i = 1; i <= 20; i++) {
      const p = await uploadPhoto(alice, listing, `photo-${String(i).padStart(2, "0")}.jpg`);
      photoIds.push(p.id);
      paths.push(p.path);
    }
    const n = await alice((tx) => tx.query<{ n: number }>(`select count(*)::int n from public.media_assets where listing_id = $1`, [listing]));
    expect(n.rows[0]!.n).toBe(20);
  });

  it("rearranges, picks the main photo, replaces one, and marks the listing ready", async () => {
    const reversed = [...photoIds].reverse();
    await alice((tx) => tx.query(`select public.reorder_listing_photos($1, $2::uuid[])`, [listing, reversed]));
    await alice((tx) => tx.query(`update public.listings set cover_asset_id = $2 where id = $1`, [listing, photoIds[6]]));

    // replace photo #3 in place: new object, same record and position, old object removed
    const newPath = `${org}/listings/${listing}/${randomUUID()}.jpg`;
    await alice(async (tx) => {
      await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('listing-media', $1, auth.uid()::text)`, [newPath]);
      const u = await tx.query(`update public.media_assets set storage_path = $2, file_name = 'photo-03-retouched.jpg' where id = $1`, [photoIds[2], newPath]);
      expect(u.affectedRows).toBe(1);
      const d = await tx.query(`delete from storage.objects where bucket_id = 'listing-media' and name = $1`, [paths[2]]);
      expect(d.affectedRows).toBe(1);
    });
    paths[2] = newPath;

    await alice((tx) => tx.query(`update public.listings set workflow_state = 'ready' where id = $1`, [listing]));
  });

  it("after signing out and back in, everything is exactly as saved", async () => {
    const again = signedIn(db, ids.alice!); // new session
    const l = await again((tx) => tx.query<Record<string, unknown>>(`select * from public.listings where id = $1`, [listing]));
    const row = l.rows[0]!;
    for (const [k, v] of Object.entries(LISTING_FIELDS)) {
      const got = row[k] instanceof Date ? (row[k] as Date).toISOString().slice(0, 10) : row[k];
      if (typeof v === "number") expect(Number(got), k).toBe(v);
      else expect(String(got), k).toBe(v);
    }
    expect(row.workflow_state).toBe("ready");
    expect(row.cover_asset_id).toBe(photoIds[6]);
    expect(row.created_by).toBe(ids.alice);

    const photos = await again((tx) => tx.query<{ id: string; storage_path: string; file_name: string }>(
      `select id, storage_path, file_name from public.media_assets where listing_id = $1 order by sort_order`, [listing]));
    expect(photos.rows.map((p) => p.id)).toEqual([...photoIds].reverse());
    expect(photos.rows.find((p) => p.id === photoIds[2])).toMatchObject({ storage_path: paths[2], file_name: "photo-03-retouched.jpg" });

    // every saved photo can still be opened (signed URL needs SELECT on storage.objects)
    const files = await again((tx) => tx.query<{ name: string }>(`select name from storage.objects where bucket_id = 'listing-media'`));
    expect(files.rows.map((f) => f.name).sort()).toEqual([...paths].sort());
  });
});

describe("photo rules", () => {
  it("allows at most 30 photos", async () => {
    for (let i = 21; i <= 30; i++) await uploadPhoto(alice, listing, `extra-${i}.jpg`);
    await rejects(uploadPhoto(alice, listing, "one-too-many.jpg"), /at most 30 photos/);
  });

  it("needs 5 photos and an address before a listing is ready", async () => {
    const draft = (await alice((tx) => tx.query<{ id: string }>(
      `insert into public.listings (organization_id, created_by, address_line) values ($1, auth.uid(), '1 Short St') returning id`, [org]))).rows[0]!.id;
    for (let i = 0; i < 4; i++) await uploadPhoto(alice, draft, `p${i}.jpg`);
    await rejects(alice((tx) => tx.query(`update public.listings set workflow_state = 'ready' where id = $1`, [draft])), /needs 5 to 30 photos/);
    await uploadPhoto(alice, draft, "p4.jpg");
    await alice((tx) => tx.query(`update public.listings set workflow_state = 'ready' where id = $1`, [draft]));
    const empty = (await alice((tx) => tx.query<{ id: string }>(
      `insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [org]))).rows[0]!.id;
    for (let i = 0; i < 5; i++) await uploadPhoto(alice, empty, `e${i}.jpg`);
    await rejects(alice((tx) => tx.query(`update public.listings set workflow_state = 'ready' where id = $1`, [empty])), /address_line_check/);
  });

  it("refuses a reorder that drops or invents photos, and a main photo from another listing", async () => {
    const some = photoIds.slice(0, 5);
    await rejects(alice((tx) => tx.query(`select public.reorder_listing_photos($1, $2::uuid[])`, [listing, some])), /every photo/);
    await rejects(alice((tx) => tx.query(`select public.reorder_listing_photos($1, $2::uuid[])`, [listing, [...photoIds, randomUUID()]])), /every photo/);
    const other = (await alice((tx) => tx.query<{ id: string }>(`insert into public.listings (organization_id, created_by) values ($1, auth.uid()) returning id`, [org]))).rows[0]!.id;
    const foreign = await uploadPhoto(alice, other, "x.jpg");
    await rejects(alice((tx) => tx.query(`update public.listings set cover_asset_id = $2 where id = $1`, [listing, foreign.id])), /main photo/);
  });

  it("keeps every photo record inside its own listing's folder", async () => {
    await rejects(alice((tx) => tx.query(`update public.media_assets set storage_path = $2 where id = $1`,
      [photoIds[0], `${org}/listings/${randomUUID()}/moved.jpg`])), /media_assets_listing_folder/);
  });
});

describe("secure image access and deletion", () => {
  it("a colleague cannot see, open, change or delete the listing or its photos", async () => {
    expect((await bob((tx) => tx.query(`select id from public.listings where id = $1`, [listing]))).rows).toEqual([]);
    expect((await bob((tx) => tx.query(`select id from public.media_assets where listing_id = $1`, [listing]))).rows).toEqual([]);
    expect((await bob((tx) => tx.query(`select name from storage.objects where name = $1`, [paths[0]]))).rows).toEqual([]);
    expect((await bob((tx) => tx.query(`delete from storage.objects where name = $1`, [paths[0]]))).affectedRows).toBe(0);
    expect((await bob((tx) => tx.query(`delete from public.media_assets where id = $1`, [photoIds[0]]))).affectedRows).toBe(0);
    expect((await bob((tx) => tx.query(`update public.listings set price = 1 where id = $1`, [listing]))).affectedRows).toBe(0);
    await rejects(bob((tx) => tx.query(`select public.reorder_listing_photos($1, $2::uuid[])`, [listing, photoIds])), /cannot change/);
    await rejects(uploadPhoto(bob, listing, "planted.jpg"), /row-level security/);
    // the photo is still there for its owner
    expect((await alice((tx) => tx.query(`select name from storage.objects where name = $1`, [paths[0]]))).rows.length).toBe(1);
  });

  it("an administrator can assign the listing; view-only stays view-only", async () => {
    await admin((tx) => tx.query(`select public.admin_assign_listing($1, $2, 'viewer')`, [listing, ids.bob]));
    expect((await bob((tx) => tx.query(`select id from public.listings where id = $1`, [listing]))).rows.length).toBe(1);
    expect((await bob((tx) => tx.query(`select name from storage.objects where name = $1`, [paths[0]]))).rows.length).toBe(1);
    expect((await bob((tx) => tx.query(`delete from storage.objects where name = $1`, [paths[0]]))).affectedRows).toBe(0);
    expect((await bob((tx) => tx.query(`update public.listings set price = 1 where id = $1`, [listing]))).affectedRows).toBe(0);
    await rejects(bob((tx) => tx.query(`select public.admin_assign_listing($1, $2, 'editor')`, [listing, ids.bob])), /Only administrators/);

    await admin((tx) => tx.query(`select public.admin_assign_listing($1, $2, 'editor')`, [listing, ids.vera]));
    const v = await admin((tx) => tx.query<{ access: string }>(`select access from public.listing_members where user_id = $1`, [ids.vera]));
    expect(v.rows[0]!.access).toBe("viewer");
    expect((await vera((tx) => tx.query(`update public.listings set city = 'x' where id = $1`, [listing]))).affectedRows).toBe(0);

    const audit = await admin((tx) => tx.query<{ action: string }>(`select action from public.audit_log where target_id = $1`, [listing]));
    expect(audit.rows.map((a) => a.action)).toContain("listing.assigned");
  });

  it("the owner deletes a photo: record and file are gone, the main photo is cleared, and it's audited", async () => {
    await alice(async (tx) => {
      const d = await tx.query(`delete from public.media_assets where id = $1`, [photoIds[6]]);
      expect(d.affectedRows).toBe(1);
      const f = await tx.query(`delete from storage.objects where bucket_id = 'listing-media' and name = $1`, [paths[6]]);
      expect(f.affectedRows).toBe(1);
    });
    const l = await alice((tx) => tx.query<{ cover_asset_id: string | null }>(`select cover_asset_id from public.listings where id = $1`, [listing]));
    expect(l.rows[0]!.cover_asset_id).toBeNull();
    expect((await bob((tx) => tx.query(`select name from storage.objects where name = $1`, [paths[6]]))).rows).toEqual([]);
    const audit = await admin((tx) => tx.query<{ action: string }>(`select action from public.audit_log where action = 'photo.deleted'`));
    expect(audit.rows.length).toBe(1);
  });

  it("removing the assignment removes access again; the Super Admin always has access", async () => {
    await admin((tx) => tx.query(`select public.admin_unassign_listing($1, $2)`, [listing, ids.bob]));
    expect((await bob((tx) => tx.query(`select id from public.listings where id = $1`, [listing]))).rows).toEqual([]);
    expect((await bob((tx) => tx.query(`select name from storage.objects where name = $1`, [paths[0]]))).rows).toEqual([]);
    expect((await owner((tx) => tx.query(`select id from public.listings where id = $1`, [listing]))).rows.length).toBe(1);
    expect((await owner((tx) => tx.query(`update public.listings set price = 530000 where id = $1`, [listing]))).affectedRows).toBe(1);
  });

  it("deleting the listing removes all of its photo records", async () => {
    await alice((tx) => tx.query(`delete from public.listings where id = $1`, [listing]));
    const left = await db.query<{ n: number }>(`select count(*)::int n from public.media_assets where listing_id = $1`, [listing]);
    expect(left.rows[0]!.n).toBe(0);
  });
});
