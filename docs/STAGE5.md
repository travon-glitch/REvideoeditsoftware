# Stage 5 — FableCut video editor and rendering

**Status:** complete (2026-11-05). Stopped before Stage 6 as instructed.

## How it fits together

```
 Browser (signed in)                         Web app (Next.js)                         Render worker (separate process)
 ───────────────────                         ─────────────────                         ────────────────────────────────
 Editor: scenes, moves, text,  ──autosave──▶  PUT /api/projects/:id/plan                claim_render_job()  (service role)
 music, format, preview            │          • session + project edit right (RLS)        │
                                   │          • every photo/music must be the project's   ▼
                                   │          • plan → FableCut project.json             check document: only this project's
                                   │          • FableCut checkProject()                   listing photos / music, /media/<uuid>.ext
                                   │          • revision check (409 on conflict)          │
 Export ───────────────────────────┼────────▶ POST /api/projects/:id/renders              ▼
                                   │          one render_jobs row per format            throwaway folder + private FableCut
                                   │          (document snapshot + 16:9 / 9:16 / 1:1)   server on 127.0.0.1:<random>, no secrets
 Download ◀────────────────────────┴───────── GET …/renders/:rid/download                FableCut headless export → Chrome
                                              signed link created as the user:            compositor → FFmpeg → MP4 1080p
                                              Storage checks access + download right      │
                                                                                          ▼
                                                                                         upload to video-exports/<org>/projects/<p>/
                                                                                         record media_asset, mark job succeeded
```

## FableCut capabilities used (unchanged upstream code)

| Capability | How it's used |
|---|---|
| JSON project structure | Every save produces a FableCut `project.json` (stored in `video_projects.document`, with revision history) and is validated by FableCut's own `checkProject`. |
| Timeline editing | Scenes become image clips on V1 with timings; text clips on V2/V3; music on A1. |
| Image clips · keyframes · camera movement | Each photo gets `scale`/`x`/`y` keyframes for its camera move (push in, pull out, pans, rise, orbit/drone as a simple version), or "Still". |
| Transitions | Fade, slide, zoom, wipe, whip between scenes; fade-out at the end. |
| Text overlays | Big title, caption box, brand-colored banner; top/center/bottom; brand fonts. |
| Audio | Uploaded music with volume and fade-out keyframes. |
| Video preview | Instant in-browser preview using the same timing, keyframes, fades and text placement. |
| FFmpeg export | FableCut's own headless export (its compositor in Chrome + FFmpeg), "master" preset at the project size → **1080p H.264/AAC MP4**. |

Video clips (uploaded footage) are supported by FableCut and by the worker's file checks, but the editor only offers
listing photos in this stage.

## Editing workflow

1. **Create Video** → choose the listing, a style and the first shape → the app builds the **automatic timeline**:
   every photo (main photo first), varied camera moves, about **30 seconds**, address title on the first scene,
   price/specs, open house (if set), agent and contact card on the last scene.
2. **Editor** (`/videos/:id/edit`): preview · drag or arrows to **reorder scenes** · **camera move** and length per
   scene · add/remove photos · **text** (which scene — or always first/last —, style, position, how long) ·
   **music** (upload MP3/M4A/AAC/WAV, volume, fade-out) · transition · shape (16:9 / 9:16 / 1:1) ·
   "Fit to 30 seconds". Changes **save automatically**; a save from another tab is detected (no silent overwrites).
3. **Export 1080p MP4** for one or more shapes → progress bar → **Download** (also on the video's page).

## Security

| Requirement | How |
|---|---|
| FableCut's local server not exposed to users | Only runs inside the render worker, per job, on 127.0.0.1 with a random port, then killed. The web app never starts or proxies it. |
| Authenticated server-side editing APIs | `/api/projects/:id/{plan,renders,renders/:rid/download,music}`: session required (401), same-origin check on writes (403), permission check, then all queries run **as the user** so database RLS applies again. |
| Media and projects stored per company/project | Photos: `listing-media/<org>/listings/<listing>/…`; music: `project-media/<org>/projects/<project>/…` (new private bucket); videos: `video-exports/<org>/projects/<project>/<render>.mp4`. Database constraints keep every record inside its own folder. |
| Validate asset paths | API: every scene/music id must be one of the project's own files. Worker: re-checks the document — every media item must be an allowed file of **this project's listing or this project**, with a `/media/<uuid>.<ext>` path; no `..`, URLs, library files, nested comps or extra sequences; size/length limits. |
| No access to unrelated server files | The FableCut instance sees only a fresh temp folder containing that job's files; it gets a minimal environment (no database/storage keys); upstream `server.js` and `mcp-server.js` are never loaded by the web app. |
| Isolated background rendering | Separate worker process (`npm run worker`), one job per sandbox, `SKIP LOCKED` job claiming, stuck jobs re-queued (3 attempts), progress reported to the job row. |
| Downloads | Signed link (2 minutes, one file) created as the user — Storage itself requires project access **and** the person's download permission. |

## Acceptance test — ✅ passed here (real render)

`npm run test:render -w @lvs/web` (`apps/web/tests/render/render.acceptance.test.ts`), run in this environment
with FFmpeg 6.1 and Chromium:

1. One listing with **15 photographs** (+ a music file) → automatic timeline: 15 scenes, **30.0 s**.
2. Edits: last photo moved to the front, third scene set to "Still", a text banner added to the first scene, music added.
3. The document went through the **production worker code** (file checks → isolated FableCut → FFmpeg) in **~63 s**.
4. The stored MP4 was "downloaded" and checked:
   - **1920×1080, 30.0 s, H.264 + AAC**, decodes with no errors, music audible (mean volume > −35 dB);
   - **edits are in the video:** frame colors prove the new scene order (Room 15 first, then Room 1, Room 2… Room 14
     last); the "Still" scene doesn't move while a push-in scene does; the banner appears on the first scene only;
     the agent/contact card stays on the last scene after reordering;
   - **plays in Google Chrome** (`<video>` reports 1920×1080, 30 s, playback advancing).
5. **9:16 → 1080×1920** and **1:1 → 1080×1080** MP4s.
6. Refusals: a photo from another listing of the same company, and a `../../etc/passwd` path, are rejected before rendering.

The browser end-to-end version (sign in → 15 uploads → editor → export → download → ffprobe) is in
`apps/web/tests/e2e/editor-export.e2e.mjs`; it needs your Supabase project and a running worker, and skips itself otherwise.

## Verification run

| Check | Result |
|---|---|
| `npm run typecheck` (web, camera-presets, render-worker) | ✅ 0 errors |
| `npm test` | ✅ 137 tests (web 127 incl. 60 database · camera-presets 6 · fablecut-core 4) |
| `npm run test:render -w @lvs/web` | ✅ 13 tests, real MP4 renders |
| `next build` | ✅ |
| Editor pages/APIs without a session | ✅ redirected to sign-in (401 JSON once Supabase is configured) |
| Editor UI | ✅ rendered with sample data in Chromium, no page errors (screenshots in `docs/screenshots/editor-*.png`) |

## Running the worker

See `docs/SETUP.md` → "Render worker". In short: a machine with **FFmpeg** and **Chrome/Chromium**, the same
`.env.local` values (it needs the service-role key — keep it off user-facing machines), then `npm run worker`.
Run more copies for more throughput; each renders one video at a time (~1–2× real time at 1080p here).

## Known limits / next stage

- The preview is an in-browser approximation of FableCut's compositor (same timing and moves; text rendering and
  the less common transitions can differ slightly). The exported MP4 is always rendered by FableCut itself.
- AI-only camera moves (orbit, rise, drone, walk-through) render as their simple Ken Burns version until an AI video
  service is connected (next stages).
- The full FableCut timeline UI (all of its advanced panels) is not exposed; the editor covers the listing-video
  workflow. Exposing it safely needs the separate-origin gateway planned in `docs/ARCHITECTURE.md`.
- No built-in music library yet — uploads only (licensing is the company's responsibility).
- Old Stage 2–4 test video projects without an edit plan get a fresh automatic timeline when opened.
