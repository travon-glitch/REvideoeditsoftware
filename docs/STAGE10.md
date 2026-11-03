# Stage 10 — Six-Video Automatic Generator

One click turns one listing into six different property marketing videos. Each is a real MP4,
rendered in the background, **vertical 1080×1920 by default**.

**Where:** sidebar **Generate 6 Videos** (`/generate`) or the button on a listing. Choose the listing,
the shape and the storyboard planner, read **Expected usage**, press **Generate 6 Videos**. The batch
dashboard opens.

## The six videos
Each video has its own opening photo, pacing and marketing emphasis (`src/lib/video/batch.ts`):

| # | Video | Opens on | Pacing | Transition | Emphasis | Music mood |
|---|---|---|---|---|---|---|
| 1 | Cinematic Property Tour | the cover photo | up to 14 scenes × 3.2 s (≤ 48 s), slow moves | fade | the flow of the home, room to room | inspiring |
| 2 | Just Listed Reel | photo 2 | 10 quick cuts, 15 s | whip | **JUST LISTED** + price up front | upbeat |
| 3 | Luxury Highlights | the first wide photo after the opener | 7 long shots × 5 s | fade | quality, one key fact at a time | elegant |
| 4 | Open House Promotion | photo 4 | 8 × 3 s | zoom | **OPEN HOUSE + date** first and again at the end. No date on the listing → "Ask us for a showing" (no date is made up) | warm |
| 5 | Short Social Media Reel | the last photo | 8 fastest cuts, 12 s | slide | price as the hook | upbeat |
| 6 | Agent-Branded Advertisement | photo 5 | 6 × 3.5 s | wipe | "<Agent> presents", the agent and company, a contact end card | calm |

**Every video has:**
- the **address and price** overlays (when the listing has a price);
- the **company logo** in the top-right corner (from the brand kit);
- the company colours and fonts;
- a **licensed music track** for its mood, a different track for each video where the library allows.

Camera moves come from the Camera Studio engine, and a move saved on a photo is respected. Only facts
on the listing are used. Unit tests prove the six storyboards are different (structure, opener, hook,
transitions).

## Storyboard planner and expected usage (nothing expensive runs without being shown first)

**Standard (default).** Storyboards are built by rules from the photos and listing facts. AI cost: $0.

**AI Director (optional).** This option appears only when the Super Admin has connected Claude and the person
has AI access. Claude analyses the photos **once**, then writes one storyboard per video with that video's
brief. Each storyboard goes through the Stage 9 compiler and fact-checker. If a storyboard fails, that
one video falls back to the Standard storyboard. Cost and usage are recorded on a `director_runs` row (style `batch`).

**Expected usage panel** (before anything starts):
- the number of videos;
- videos left today and this month (the person's limits);
- an estimate of render time at the company's concurrency;
- the AI cost.

For the AI Director the panel shows the estimated cost (generous: one photo analysis plus six storyboards
at the configured model's prices) and the company's AI budget left. The button stays disabled until the
person ticks **"I understand this uses Claude and will cost about $X"**. The server **re-computes** the
estimate and refuses (409) unless the confirmed amount covers it, so a request can't skip the step.
Limits that don't cover six videos disable the button and are enforced again by the database.

## Batch dashboard (`/batches/<id>`)
There are six cards. Each card shows:
- title and thumbnail (vertical preview);
- the music track used;
- live render progress;
- **Preview** (plays in the page), **Download**, **Edit** (the normal editor) and **Regenerate** (new photo
  choice and camera order; keeps the shape, music and logo);
- **Retry**, shown only when that video failed.

At the top are **Download All as ZIP** and **Save all to company library**.

## Licensed music library (Admin Panel → Music library)
- **Built-in tracks:** five original tracks (Elegant Evening, Bright Open House, Calm Morning, Warm Welcome,
  Inspiring Skyline). They were composed by the repository's own synthesizer (`tools/music/generate.mjs`)
  and contain no samples or third-party recordings. They are owned by the company and cleared for commercial use.
  They are added to each company's library the first time it is used.
- **Uploaded tracks:** admins can upload tracks with the title, artist, mood and licence type
  (royalty-free, licensed, company-owned), licence details and a link. A track is offered for videos
  **only after an admin ticks "commercial use verified"**; the database records who verified it and when.
  An admin can withdraw or remove a track. Built-in tracks can't be changed or deleted.
- Database policies: everyone in the company can read the library; only admins can write to it; other
  companies never see it. The render worker accepts library audio and brand-logo assets of the same company only.

## Job management
- Each video is its own project with its own job in the background render queue. The company's concurrent
  render limit is respected by `claim_render_job()`.
- A failure affects only that video. **Retry** re-queues only that video.
- Super Admin limits apply: batch permission, maximum batch size, daily and monthly video limits, AI access,
  and the AI spending ceiling. `my_generation_allowance()` gives the page the person's current numbers.

## Database — `20261110000100_music_and_batch_v2.sql`
This migration adds:
- the `music-library` bucket and its policies;
- the `music_tracks` table (licence, verification and policies);
- `video_batches.aspect` and `video_batches.planner`;
- the new `start_video_batch(listing, size, analysis, aspect, planner)`;
- `my_generation_allowance()`;
- the `batch` director-run style.

## Acceptance test
`apps/web/tests/render/batch.acceptance.test.ts`. Run it with:

```bash
LVS_RENDER_TESTS=1 npx vitest run tests/render/batch.acceptance.test.ts
```

Run it from `apps/web`.

It uses one listing with 20 photos, the brand logo and the built-in music library. It checks:
1. The six storyboards are built by the same code as the button: six types, all 9:16, six different openers
   and structures, and address, price, logo and music on each.
2. Six background jobs go through the real render worker. One is forced to fail; the other five finish,
   and retrying only that one succeeds.
3. **All six outputs are checked:**
   - 1080×1920;
   - the planned length;
   - H.264 video;
   - AAC music that isn't silent;
   - a clean decode;
   - the logo visible in the corner;
   - the address and price in the document;
   - playback in Chrome;
   - the six are different (lengths and opening frames).
4. Download All as ZIP: the ZIP is written with the route's ZIP writer, then opened and verified.

**Result (2026-11-03): 7/7 passed in 8 min.**

| Video | Size | Length | Codecs |
|---|---|---|---|
| Cinematic Property Tour | 1080×1920 | 44.8 s | H.264 + AAC |
| Just Listed Reel | 1080×1920 | 15.0 s | H.264 + AAC |
| Luxury Highlights | 1080×1920 | 35.0 s | H.264 + AAC |
| Open House Promotion (forced failure, then retried) | 1080×1920 | 24.0 s | H.264 + AAC |
| Short Social Media Reel | 1080×1920 | 12.0 s | H.264 + AAC |
| Agent-Branded Advertisement | 1080×1920 | 21.0 s | H.264 + AAC |

Screenshots:
- `docs/screenshots/stage10-six-openers.png`: the opening frame of each of the six videos;
- `docs/screenshots/stage10-generate-usage.png`: the shape choice and expected usage;
- `docs/screenshots/stage10-ai-confirm.png`: the AI Director cost confirmation.

The AI Director batch planner was not run end to end in this stage: this environment has no Claude API key, and it has no simulated-response test yet (the Stage 9 director pieces it reuses do).
The Standard planner, which the acceptance test uses, makes no AI calls.
