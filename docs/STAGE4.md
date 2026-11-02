# Stage 4 — Real-estate listings and photo uploads

**Status:** complete (2026-11-04). Stopped before Stage 5 as instructed.

## The three-part listing screen (`/listings/[id]`)

| Part | What people do |
|---|---|
| **1. Property Information** | Address, city, state, ZIP, price, bedrooms, bathrooms, square footage, property type, description, agent name, brokerage, contact phone and email, open-house date and times. (Advanced Mode adds MLS number and listing status.) **Saves automatically** about a second after each change, on tab switch and before moving to another step; a status line says "Saving… / All changes saved". |
| **2. Upload Photos** | Drag-and-drop or choose several files at once; live previews while uploading (3 in parallel); 5–30 photos; full-size preview with arrow keys; rearrange by dragging or with ← → buttons; ★ main photo; replace; remove. |
| **3. Save and Continue** | A checklist (only the address and 5–30 photos are required; the rest are marked optional), then **Save and create a video** or **Save draft and finish later**. |

**Create listing** starts an empty draft straight away — nothing is required to save it. Drafts show a "Draft" badge
in My Listings with the main photo as the thumbnail and a photo count.

Everything typed is stored on the listing record and reused automatically by **Create Video**: the main photo opens
the video, then the photos in the chosen order; the address/price/specs cards, an **open-house card** when a date is
set, and a closing card with agent, brokerage and contact details. A video needs at least 5 photos and an address.

## Storage and records

- Photos upload **directly from the browser to the private `listing-media` bucket** at
  `<company>/listings/<listing>/<random-id>.<ext>` (never the user's file name). The server then verifies each path,
  type, size and that the file really exists before writing the `media_assets` record.
- Thumbnails and previews use **signed links that expire after 1 hour**, created as the signed-in person.
- **Replace** uploads the new file, points the same record (same position) at it and deletes the old file.
- **Remove** deletes the record and the file; if it was the main photo, the main photo is cleared.
- **Reorder** is one database call that must list every photo exactly once (no partial or stale orders).

## Company permissions

- Listings belong to the company and record `created_by` (and `updated_by` on every change).
- People can open only listings they **created**, listings **assigned to them** (new: Admin → Users → person →
  *Listings*), or listings used by a **project assigned to them**. Admins see all; the Super Admin can edit all.
- View-only assignments can see photos but cannot upload, reorder, replace or delete. Viewers are always view-only.
- Assignments and photo deletions are written to the activity log.

## Rules enforced by the database (migration `20261104000100_listings_photos.sql`)

| Rule | How |
|---|---|
| Draft can be saved empty | address check applies only to `ready` listings |
| Maximum 30 photos | trigger, with a row lock so parallel uploads can't exceed it |
| "Ready" needs an address + 5–30 photos | trigger on the listing |
| Main photo must belong to the listing | trigger |
| Photo records stay in their own listing's folder | check constraint |
| Upload / open / delete files only with listing access | storage policies (from Stage 3, now including direct assignments) |
| Full, exact reorder only, by someone who can edit | `reorder_listing_photos()` |

## Acceptance tests

**Database acceptance — ✅ passes** (`apps/web/tests/db/listings.test.ts`, 14 tests, real migrations on PGlite):

1. An empty draft is saved; every listing field is filled in.
2. **20 photographs** are uploaded (file + record each).
3. Photos are rearranged, a main photo is picked, one photo is replaced, the listing is marked ready.
4. **New session for the same user ("log out / log back in")**: every field, the main photo, the exact photo order,
   the replaced photo and all 20 files are exactly as saved.
5. Limits: a 31st photo is refused; "ready" needs 5 photos and an address; bad reorders and a main photo from
   another listing are refused; records can't be moved to another listing's folder.
6. **Secure access and deletion:** a colleague cannot see, open, change, reorder, upload to or delete the listing or
   its photos; a view-only assignment can open photos but not change or delete them; the owner's deletion removes
   record and file, clears the main photo and is audited; un-assigning removes access again; the Super Admin keeps
   access; deleting the listing removes all photo records.

**Browser acceptance — written, not run here** (`apps/web/tests/e2e/listing-roundtrip.e2e.mjs`): the same flow in a
real browser against your Supabase project — sign in, create listing, fill every field, upload 20 real JPEGs, pick
the main photo, reorder, save, **sign out**, confirm the listing is unreachable while signed out, **sign back in**,
verify every value and all 20 photos, confirm photos are **not publicly reachable**, delete a photo and confirm its
link stops working, then delete the test listing. Run it once Supabase is connected:

```bash
E2E_BASE_URL=https://your-app E2E_EMAIL=editor@yourcompany.com E2E_PASSWORD='…' npm run test:e2e -w @lvs/web
```

It skips itself when those variables are not set (as in this environment, where no Supabase project exists).

## Verification run

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm test` | ✅ 120 tests (web 110: unit 61 + database 49 · camera-presets 6 · fablecut-core 4) |
| `next build` | ✅ |
| Listing pages and server actions without a session | ✅ redirect to `/login` |
| Browser E2E | ⏭ skipped — needs a Supabase project |

## Not verified here

- The listing screens were type-checked and built but not rendered in a browser (they need a signed-in session,
  which needs Supabase). Drag-and-drop and upload behavior will be exercised by the E2E test above.
- HEIC photos upload and are stored, but most browsers other than Safari can't show HEIC previews; converting HEIC
  to JPEG belongs to the media-processing worker in a later stage.
