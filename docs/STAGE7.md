# Stage 7 — Cinematic Camera Control Studio

`/camera-studio` turns a property photo into a cinematic clip. It opens in **Easy camera** for
Easy Mode users and **Advanced camera** for Advanced users (either can switch).

Screenshots: `docs/screenshots/stage7-*.png` / `.jpg`.

## What people can do
1. **Pick or upload a photo.** Choose a listing and one of its photos, or upload a photo straight
   from the studio (a draft listing is made if needed).
2. **Easy camera**: six animated cards — **Move Closer, Move Back, Move Left, Move Right, Look Around,
   Reveal Property** — each playing a live sample on *your* photo. Choose **Intensity** (Gentle /
   Normal / Dramatic), **Duration** (3 / 5 / 8 s) and press **Apply**.
3. **Advanced camera** (tabs):
   - **Movement**: Push In, Pull Out, Dolly In/Out, Truck Left/Right, Pan Left/Right, Tilt Up/Down,
     Crane Up/Down, Orbit Left/Right, Arc Left/Right, Zoom, Parallax, Simulated Drone Reveal —
     every move shows an honest badge (see "Two rendering methods").
   - **Presets & lens**: Architectural Wide Angle, Luxury Cinematic, Smooth Interior Tour, Exterior
     Reveal, Slow Drone-Style Reveal, Detailed Room Focus; lens-inspired styles **14 / 24 / 35 / 50 / 85 mm**.
   - **Settings**: duration, motion strength, speed, movement distance, direction, zoom, rotation,
     depth intensity, motion blur (shutter angle), easing, reverse, target point (click the photo).
   - **Frames & keyframes**: exact **starting and ending frame** (taken from the preview or typed),
     and **custom keyframes** (add at the preview time; edit time, position, zoom, rotation, easing).
4. **Live preview** of the move before anything is rendered — play, pause, scrub, loop.
   The preview evaluates *the same FableCut keyframes with FableCut's own interpolation* that the
   export uses, so it is frame-accurate (verified by the acceptance test).
5. **Apply** saves the move on the photo (new and Easy Mode videos of that listing use it), or —
   when opened from the editor (**Camera** button on each scene) — applies it to that scene.
6. **Export MP4 clip**: a 1080p MP4 (Wide, Tall or Square) through the normal render worker.
7. **AI Enhanced**: *Make AI depth version* / *Make generative AI version* (see below).
8. **Your clips**: exported clips with player and download; AI clips **side by side with the
   original photo**, the automatic accuracy check, **Looks right** / **Report a problem** (audited),
   and **Use in scene N** when opened from a video.
9. Undo / Redo (buttons and Ctrl+Z / Ctrl+Shift+Z) for every camera change.

## Two rendering methods
| | METHOD 1 — STANDARD | METHOD 2 — AI ENHANCED |
|---|---|---|
| How | Deterministic keyframes on the photo (x, y, scale, rotation, motion blur) rendered by FableCut | **AI depth**: a neural depth model (MiDaS v2.1 small, MIT) estimates depth on our own server; a virtual camera moves through a 3D mesh of the photo (real parallax). **Generative**: an image-to-video model through a provider (MuAPI adapter, as used by Open Generative AI) |
| Exact for | Zoom, Push In / Pull Out (scale toward a point) | — |
| Close match for | Pan, Tilt (small turns) | — |
| 2D stand-in only for | Dolly, Truck, Crane — and **Orbit, Arc, Parallax, Simulated Drone Reveal (labelled "Needs AI")** | Depth: dolly, truck, crane, pan/tilt, small orbits/arcs, parallax, small rise-and-pull-back. Generative: large orbits and aerial-style reveals |

Labels shown in the UI: *Standard: exact*, *Standard: close*, *Standard: 2D stand-in*, *Needs AI*.
For stand-in moves the preview says: "Preview: 2D stand-in. A real orbit right needs AI depth … or
Generative AI video." **No 2D move is presented as a 3D orbit.**

**Lens styles are simulated** framing and motion feel (and the field of view of the virtual camera
in AI depth). The UI says so; nothing is written into the photo or any metadata.

**No black edges**: the engine checks every moment of the move and zooms in just enough
(the preview tells you by how much). AI depth does the same ("edge guard").

## Property accuracy
- The **original photo is never changed** and is always shown next to an AI clip.
- Every AI clip gets an **automatic review** (`media_assets.ai_review`):
  - AI depth: share of the picture **stretched** where near and far objects meet (flag over 4 %),
    and edge fill if the camera moved past the photo.
  - Generative: how closely the **first frame** matches the photo (SSIM; flag under 0.6), and big
    later changes (flag) — "Check walls, windows, roof lines and landscaping for AI changes."
- People **approve** a clip or **report a problem** (`review_ai_clip()`, audited). A clip with a
  reported problem can't be used in a scene from the studio.
- Generative prompts always include the guardrail: "keep the property exactly as photographed: do not
  add, remove or change furniture, fixtures, walls, windows, views or landscaping".
- AI clips can't be created, relabelled or "un-flagged" by people — only the AI worker writes them
  (database trigger + policies).

## Architecture
- `packages/camera-presets/src/studio.ts` — the camera engine (moves, easy moves, presets, lens
  styles, settings, start/end frames, custom keyframes, FableCut keyframes, edge guard, FableCut's
  easing/interpolation, AI depth camera poses).
- `packages/ai-motion` — AI worker: `depth.ts` (MiDaS via onnxruntime-node), `depth-render.ts`
  (mesh + z-buffer rasteriser), `depth-clip.ts`, `accuracy.ts`, `providers/muapi.ts`,
  `process-job.ts` (security checks), `worker.ts` (queue loop).
- Plan model: scenes may carry `camera` (a studio move) and `clipAssetId` (an AI clip, played as a
  video clip). `composeDocument`, the editor preview and the video page all understand both.
- Migration `20261107000100_camera_studio.sql`: `ai-clips` private bucket, `media_assets.camera_spec /
  source_asset_id / generation_job_id / ai_review / ai_decision`, protections, `review_ai_clip()`,
  `generation_jobs` queue (`claim_generation_job`, `requeue_stale_generation_jobs`), stricter insert
  rule (photo must belong to the listing; generative providers only when the company switched AI on),
  `render_jobs.label`.
- API: `POST /api/camera/export`, `POST /api/camera/ai`, `POST /api/camera/apply`,
  `PUT /api/camera/photos/:id`, `GET /api/camera/listings/:id`, `POST /api/camera/clips/:id/review`.

## Running the AI worker
```bash
npm run fetch-model -w @lvs/ai-motion      # downloads MiDaS small (66 MB, SHA-256 checked)
npm start -w @lvs/ai-motion                # needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```
Generative video (optional): set `MUAPI_API_KEY` (and optionally `MUAPI_I2V_MODEL`) on the worker,
`LVS_GENERATIVE_PROVIDER=muapi` on the web app, and an administrator must switch **AI on** for the
company (photos leave your servers and it costs money).

## Tests
| Test | Result |
|---|---|
| Camera engine (`packages/camera-presets`) | 16 passed — all 19 moves/presets/lenses in all 3 shapes never show an edge; directions; target stays fixed; FableCut interpolation; honest AI labels |
| AI motion (`packages/ai-motion`) | 8 passed — security (other listing/company photos refused), MuAPI flow (mocked), a mismatching generative clip **is flagged**, and a **real MiDaS orbit clip** (1080p) |
| Web unit + DB | incl. `tests/db/camera-studio.test.ts`: photo camera access, AI job rules, only the worker creates AI clips, reviews can't be erased, audit, storage privacy |
| **Stage 7 acceptance** (`npm run test:render -w @lvs/web`, `camera-studio.acceptance.test.ts`) | Exterior photo → **Push In, Pull Out, Truck Right, Tilt Up**: each previewed (preview frames match the MP4, SSIM > 0.85 at 3 moments), exported through the real FableCut worker to **1920×1080 H.264, 5.0 s**, decodes cleanly, moves the right way; Push In **plays in Chrome**. **Real AI motion: AI depth Orbit Left** (MiDaS) → 1080p clip, stretched area < 5 %; that AI clip **used in a video scene renders through FableCut** (its frames appear in the video). Stage 5/6 render tests still pass (15/15). |
| Generative provider (real call) | **Skipped** — no provider key is configured here, and this environment can't reach AI provider hosts. Runs automatically with `MUAPI_API_KEY` set. |
