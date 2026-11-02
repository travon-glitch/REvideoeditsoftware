# Stage 8 — Generate 6 Videos

One click turns one listing into six different marketing videos, rendered in the background.

**Where:** sidebar **Generate 6 Videos** (`/generate`), or the **Generate 6 Videos** button on a listing.
Pick the listing, read **What we found**, press **Generate 6 Videos** → the batch dashboard opens.

## The six videos
| # | Video | Shape | Length | Structure |
|---|---|---|---|---|
| 1 | Cinematic Listing Tour | Wide 16:9 | ~50–60 s | Up to 16 photos, slow camera moves (24 mm-style, film motion blur), soft fades; hook “Step inside …”, agent card at the end |
| 2 | Just Listed Reel | Tall 9:16 | 15 s | 10 photos, fast whip cuts, strong moves; **JUST LISTED** banner + price up front, facts mid-way, “Book your showing” CTA |
| 3 | Property Highlights | Wide 16:9 | ~28 s | 7 photos, wipes; “N things to know about …”, then one **numbered fact per scene** (beds, baths, size, type, price) |
| 4 | Luxury-Style Video | Wide 16:9 | ~35 s | 7 long 5-second shots (prefers wide photos), slow push/pull (50 mm-style, 180° motion blur), understated titles, “Private showings by appointment” |
| 5 | Open House Promotion | Square 1:1 | ~24 s | 8 photos, zoom transitions; **OPEN HOUSE + date** first and again before the end. No date on the listing → “Ask us for a showing” (no date is invented) |
| 6 | Agent-Branded Listing Ad | Wide 16:9 | ~21 s | 6 photos, slides; “<Agent> presents”, “Listed by <agent · company>” lower thirds, contact end card in the brand colour |

**Automation:** listing analysis (photo count/orientation, price tier, facts, open house, agent/contact —
shown as plain-English notes) → photo selection per video (each starts on a different photo) →
six storyboards → camera moves (Camera Studio engine; a move saved on a photo is respected) →
text hooks → branding (company colours, fonts, agent, company name, outro) → six render jobs.
Only facts on the listing are used. Unit tests prove the six storyboards have different structures.

## Batch dashboard (`/batches/<id>`)
Each video: **title, thumbnail, duration, render progress, Preview** (plays in the page), **Download, Edit**
(opens the normal editor — it's an ordinary project), **Regenerate** (new photo choice and camera order,
re-rendered) and **Retry** (appears only when that video failed). Top: **Download all as ZIP** and
**Save all to company library**. Updates live while rendering.

## Downloads and library
- Individual MP4 downloads (as before, with the person's download permission).
- **ZIP**: `/api/batches/<id>/zip` streams all finished videos one at a time (each read as the signed-in
  person, so Storage still checks access and download permission).
- **Company Library** (`/library`, new in the sidebar): finished videos saved for everyone in the company —
  watch, download (with download permission), remove (whoever saved it, or an admin). Another company
  never sees them (database policy + storage policy).

## Super Admin controls (Admin Panel → System settings, and each person's page)
| Control | Where it's enforced |
|---|---|
| Maximum batch size (1–12, default 6) | `start_video_batch()` caps the batch |
| Concurrent render limit (per company, default 3) | `claim_render_job()` won't start more than that many at once (other companies keep going) |
| Daily generation limit (per person, optional) | `start_video_batch()` and a trigger on every new video |
| Per-person batch permission | `profiles.can_batch_generate`, changed only with `admin_set_batch_permission()` (Super Admin, audited) |
| AI generation spending ceiling ($/month) | trigger on `generation_jobs`: paid AI jobs stop at the ceiling (the free local depth method still works) |

Admins (not Super Admin) can't change any of these — tested.

## Reliability
- Each video is its own project with its own render job in the background queue (`render_jobs`), processed
  by the render worker(s). A failure (or a limit) affects only that video.
- **Retry** re-queues only that failed video's storyboard; finished videos are untouched.
- Batch creation itself continues past a video that can't be created and reports it on the dashboard.

## Database — `20261108000100_video_batches.sql`
`video_batches`, `video_projects.batch_id / batch_type / batch_variation`, batch settings on
`organization_settings`, `profiles.can_batch_generate`, `start_video_batch()`, `admin_set_batch_permission()`,
daily-limit and AI-budget triggers, concurrency-aware `claim_render_job()`, `library_videos` + policies,
storage policy for library files.

## Tests
| Test | Result |
|---|---|
| `src/lib/__tests__/batch.test.ts` | analysis; six valid, renderable storyboards; six different structures, hooks and opening photos; facts only; few photos; saved camera moves; regenerate differs |
| `src/lib/__tests__/zip.test.ts` | CRC-32, ZIP opens and verifies with Python's zipfile, safe names |
| `tests/db/batches.test.ts` | permissions, batch size cap, daily limit, Super-Admin-only settings, batch ownership, **concurrency limit + failure isolation in the real queue**, AI spending ceiling, company library visibility and file access |
| **`tests/render/batch.acceptance.test.ts`** | see below |

**Acceptance (real renders):** 20 photos → six storyboards → six background render jobs through the real
FableCut worker. One job's first attempt hits a storage error on purpose: the other five finish, and
retrying only that job succeeds. All six MP4s: correct shape (1920×1080 / 1080×1920 / 1080×1080) and
length, H.264, decode cleanly, all play in Chrome, and are genuinely different (lengths, shapes, opening
frames). All six zipped with the download route's ZIP writer: the ZIP verifies and the extracted files play.
