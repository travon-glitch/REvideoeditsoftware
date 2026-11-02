# Open-Source Audit — Stage 1

**Audit date:** 2026-11-02
**Scope:** Read-only review of three candidate upstreams for a private, company-owned AI real-estate video generator.
**Method:** Shallow clones (`--depth 50`) into `reference/`, then reading README, LICENSE, manifests, lockfiles and source. Upstream test suites were **not executed** in this stage (running third-party code was out of scope for a read-only audit; it is scheduled for Stage 2 inside a sandbox).

---

## 1. Starting state of the project folder

- `/home/user` was **empty** and **not a git repository**. No existing project to preserve or migrate.
- Reference clones were placed in `reference/` (must be git-ignored; never commit upstream trees wholesale into the product repo).

| Directory | Purpose |
|---|---|
| `reference/FableCut` | Repository A |
| `reference/open-generative-ai` | Repository B (as requested: the `avoltaire` fork) |
| `reference/ffmpeg.wasm` | Repository C |
| `reference/_upstream/*` | Upstream of B and B's three git submodules, cloned only to resolve licensing |

## 2. Exact upstream revisions

| Repo | Remote | Branch | Commit | Commit date | Version |
|---|---|---|---|---|---|
| FableCut | `https://github.com/ronak-create/FableCut` | `main` | `579b08ec1a789baec5cbf06d7430373460508d09` | 2026-10-30 | `1.18.0` (CHANGELOG 2026-10-28) |
| open-generative-ai (fork) | `https://github.com/avoltaire/open-generative-ai` | `main` | `958897e180dc098f3849dd4c31e5890602058753` | 2026-05-19 | `1.0.11` |
| Open-Generative-AI (upstream of fork) | `https://github.com/Anil-matcha/Open-Generative-AI` | `main` | `84b29a55ff8bd536c7fdda5d80e2f120cac9d6e1` | 2026-11-01 | — |
| ffmpeg.wasm | `https://github.com/ffmpegwasm/ffmpeg.wasm` | `main` | `f876f907c7e9b9bf51d4ed0b913a855a63ae63fc` | 2025-09-16 | `git describe`: `v12.15-34-gf876f90` |

Submodules pinned by the fork (gitlinks at `958897e`; **not populated** by a normal clone):

| Path | Upstream | Pinned commit | Upstream HEAD checked |
|---|---|---|---|
| `packages/Vibe-Workflow` | `SamurAIGPT/Vibe-Workflow` | `41a2da7d713d4bc92180ef248dad3cec8c3b0bea` | `121bde4e…` |
| `packages/Open-Poe-AI` | `Anil-matcha/Open-Poe-AI` | `cb12973823b15a50329ff34ed28491c73681a2ab` | `3e21ebc9…` |
| `packages/Open-AI-Design-Agent` | `Anil-matcha/Open-AI-Design-Agent` | `f1b16aec5efd4d472740ff827cbdae1d00612df9` | `f029d0d7…` |

**Fork relationship:** `avoltaire@958897e` is a strict ancestor of `Anil-matcha/Open-Generative-AI@84b29a5`; upstream is **304 commits ahead**. The fork adds nothing of its own. → Track the **upstream**, not the fork.

---

## 3. Repository A — FableCut

### 3.1 Summary
A zero-npm-dependency, browser-based NLE (non-linear editor). The browser does all compositing on `<canvas>`; a small Node HTTP server (`server.js`) persists `project.json`, serves media, runs ffmpeg/ffprobe, and encodes exported frames. AI agents drive it by editing `project.json`, via REST, or via a stdio MCP server. ~42 k lines of JS (of which `app.js` = 20.5 k). 50 test files using `node --test`.

**License:** MIT, © 2026 ronak-create. Bundled fonts: SIL OFL 1.1 (Google Fonts). Bundled SVGs/elements: described as self-authored (covered by repo MIT).

### 3.2 Component review

| Area | Where | Findings | Reusable for multi-user? |
|---|---|---|---|
| **Timeline architecture** | `app.js` (`state` @L550, `drawFrame` @L11648), `edit-ops.js` (1015 L), `project-ops.js` (1359 L), `sequences.js`, `comp.js` | Tracks V*n*…V1 / A1…A*n*; clips have `start/in/duration`, link groups (AV stems), locked/untargeted tracks; ripple/roll/slip/slide/3-point edits; nested comps; multiple sequences. `edit-ops.js` / `project-ops.js` are **UMD-style** (run in browser *and* Node). | **Yes, high value.** The pure-function ops modules can run server-side to build/modify timelines programmatically. |
| **Project JSON schema** | `CLAUDE.md` §"project.json schema" (L265–520) | Rich, well documented, `revision` field for optimistic concurrency, `panSchema` migration flag. Not formalised as JSON-Schema/Zod. | **Yes.** Adopt as our canonical timeline format; we must write a formal schema + validator. |
| **Video compositor** | `app.js` `drawFrame`, `drawClip`, `drawClipPicture`, `applyTransition` (L10914); `color.js`, `mask.js` | Canvas 2D compositor; one code path for preview and export (frame-exact). Monolithic and DOM-coupled (`state` global, 841 `state.` refs). | **Yes, as-is inside a browser** (user's tab or headless Chromium). Not extractable to Node without major work. |
| **Image/video clip handling** | `mp4-demux.js` + WebCodecs `VideoDecoder`; `media-probe.js`; `proxy.js` | Frame-exact MP4/MOV decode; fallback to `<video>`; ffprobe metadata; proxy generation. | Yes. |
| **Camera & keyframes** | `motion.js` (803 L), keyframes in clip JSON | 2D transforms only: x, y, scale, rotation, anchor, opacity, motion paths with bezier handles, motion blur, auto-orient, parenting/nulls, camera `shake`. Ease: linear/in/out/in-out. Ken Burns recipe exists (CLAUDE.md L2442). **No 3D camera / parallax / depth.** | **Yes** — Ken-Burns-style "camera moves" on listing photos map directly to `scale`/`x`/`y` keyframes. 3D/parallax moves must come from AI I2V (Repo B pattern). |
| **Effects & transitions** | `color.js`, `audio-fx.js`, `mask.js`, `tracker.js`, `reframe.js`, transitions in `app.js` | 14 filter presets, full grade, masks, track mattes, chroma key, MediaPipe person cut-out, motion tracking; transitions: fade, slide×4, zoom, wipe×4, iris, spin, blur, whip, glitch, pop. | Yes. |
| **Audio** | `audio-fx.js`, `loudness.js`, `ducking.js`, `denoise.js`, `beats.js`, `silence.js`, worklets | Track/bus mixer, EBU R128 normalisation, auto-duck, denoise, beat detection & snapping. | **Yes, high value** (music bed + voice-over ducking for listing videos). |
| **Text overlays** | `app.js` text renderer, `captions.js`, `templates.js` | 13 text animations, 9 title styles, Google-Fonts auto-load, captions (SRT/VTT, karaoke), templates/presets. | **Yes** — price/address/beds-baths lower-thirds and agent branding. |
| **FFmpeg rendering** | `export-jobs.js`, `encode-profiles.js`, `delivery.js`, server `/api/export/*` | Browser renders frames → POSTs JPEG/RGBA/Annex-B + WAV → server spawns ffmpeg (argv array, no shell). Delivery presets (YouTube, Reels, TikTok…). Headless Chrome/Edge render path for agents. **One export at a time** per server. | **Yes, pattern reusable**: run as a headless-Chromium render worker per job. Must lift the single-export limit by running N workers. |
| **REST endpoints** | `server.js` (1472 L) | ~40 endpoints: `/api/project` (409 on stale revision), media, upload, import-url, proxy, projects, versions, transcript, denoise, analyze, frame, scopes, export, SSE `/api/events`. | **Contract reusable; implementation not.** Single-tenant, file-backed, unauthenticated. |
| **MCP integration** | `mcp-server.js` (2056 L), 24 tools, stdio JSON-RPC | Auto-starts local server, talks to it over HTTP with `X-FableCut-Client: mcp`. `fablecut_patch_project` with `baseRevision` is a good merge-safe pattern. | **Pattern reusable** for an internal "AI assistant edits my video" feature, but must be re-hosted behind our auth (remote MCP / tool calls scoped to one project). Do not expose the stdio server. |
| **Projects / versions** | `projects.js`, `history.js` | Multiple projects but **one "open" project at a time** (`./project.json` is always the open one); versions saved on disk. | Concept reusable; storage must move to DB + object storage. |

### 3.3 Security assumptions (from `SECURITY.md` and code)
FableCut is explicitly designed for **one trusted local user**. Its own policy states it is **not hardened for untrusted networks or multi-tenant use**. Specific findings:

| # | Finding | Location | Severity in a multi-user deployment |
|---|---|---|---|
| F1 | No authentication or authorisation on any `/api/*` route. | `server.js` | **Critical** |
| F2 | Global singleton state: one `project.json`, one `media/`, one `exports/` per process. Any user can read/overwrite everyone's work. | `paths.js` | **Critical** |
| F3 | `GET /api/frame?path=` reads **any file on the host** (via ffmpeg) when header `X-FableCut-Client: mcp` is present. The header only stops browsers (CORS preflight); any curl/script can send it. | `server.js` ~L1284 | **Critical** (arbitrary file read) |
| F4 | `readBody()` buffers the entire request body in memory, no size limit → memory-exhaustion DoS via `/api/upload` and JSON endpoints. | `server.js` L165 | High |
| F5 | Uploads: no MIME/magic-byte validation; extension preserved by `safeName`. Local `.svg` is served same-origin as `image/svg+xml` → **stored XSS** across users if SVG upload is allowed. (Remote SVG import is correctly refused.) | `server.js` L915, SECURITY.md | High |
| F6 | ffmpeg/ffprobe run on user-supplied media with no CPU/memory/time sandbox (some calls have timeouts). Malformed media is a classic ffmpeg attack surface. | `analyze.js`, `denoise.js`, `server.js`, `export-jobs.js` | High |
| F7 | Host + Origin allowlists and 127.0.0.1 bind are good **local** defences, but are bypassed by design once we put it behind a reverse proxy. | `server.js` L63–72 | Medium (needs re-config) |
| F8 | Runtime third-party CDN loads: `@huggingface/transformers@4.3.1` (jsDelivr), `@mediapipe/selfie_segmentation` (jsDelivr), Google Fonts (arbitrary family names fetched). Supply-chain + privacy (client IPs leak to CDNs; no SRI). | `transcribe.js`, `app.js` | Medium |
| F9 | Headless Chrome launched by the server to render; browser must be sandboxed and must not be able to reach internal networks. | `export-jobs.js` | Medium |
| F10 | SSRF protection on `import-url` is solid (HTTPS-only, private/CGNAT/link-local blocked incl. post-DNS and redirects). DNS-rebinding between check and connect should be re-verified in Stage 2. | `import-url.js` | Low (good baseline) |
| ✓ | ffmpeg always spawned with an argv array (no shell) — no command injection found. Atomic writes (tmp + rename). Dot-files refused by static server. | — | Positive |

---

## 4. Repository B — Open Generative AI

### 4.1 Summary
A Next.js 15 / React 19 web app (+ Electron desktop build) offering Image, Video, Cinema, Lip-Sync, Marketing, Workflow, Agent and "Apps" studios. **Almost every generation call goes to one commercial aggregator, `https://api.muapi.ai`.** Local inference exists only in the Electron build (sd.cpp binary for images; optional Wan2GP Gradio server for video).

Dependency versions resolved from `package-lock.json`: `next 15.5.15`, `react 19.2.5`, `axios 1.15.2`, `electron 33.4.11`.

### 4.2 Component review

| Area | Where | Findings | Adaptable? |
|---|---|---|---|
| **Video Studio** | `packages/studio/src/components/VideoStudio.jsx` (1815 L); legacy vanilla `src/components/VideoStudio.js` | T2V / I2V / V2V modes; start/end-frame inputs; uploads via Muapi presigned URL; history (last 30) in `localStorage`. Large single component, tightly bound to `muapi.js`. | **Pattern only.** Rebuild a smaller component against our own provider API. |
| **Cinema Studio** | `CinemaStudio.jsx` (1030 L), `src/lib/promptUtils.js` | Camera body / lens / focal length / aperture **scroll-wheel pickers**. It does **not** drive real camera motion — it **compiles descriptive text into the prompt** (`buildNanoBananaPrompt`) and calls an **image** model (`nano-banana`). | **Yes (concept + small code).** Prompt-builder tables are ~90 lines; easy to re-implement and extend with real-estate moves (dolly-in, orbit, crane, drone reveal). |
| **Camera presets / lens controls** | `CAMERA_MAP`, `LENS_MAP`, `FOCAL_PERSPECTIVE`, `APERTURE_EFFECT` | 6 cameras, 11 lenses, 6 focal lengths, 3 apertures, with preview `.webp` assets in `public/assets/cinema/`. | Text tables: yes (MIT, attribute). **Preview images: do not reuse** until provenance is confirmed (likely AI-generated; may depict real camera brands' trade dress). |
| **Image-to-video workflows** | `models.js` `i2vModels` (61 entries), `generateI2V()` in `muapi.js` | Each model has `id`, `endpoint`, typed `inputs` (enum, min/max, default) and optional `lastImageField` for start/end-frame models. Good **schema-driven UI** pattern. | **Yes (pattern).** Our provider adapters should expose the same "input schema" shape so one form renderer works for all models. |
| **AI model adapters** | `src/lib/muapi.js` (544 L), `packages/studio/src/muapi.js` (656 L) | Not real adapters: one client, endpoint = Muapi slug. Submit → `request_id` → poll `/predictions/{id}/result` every 2 s, ~60 attempts. 43 T2V + 61 I2V model slugs, mostly proprietary (Kling, Veo, Sora, Runway, Seedance, Hailuo, Pixverse, Vidu…) resold via Muapi. | **Replace.** Write a provider-neutral interface; keep submit/poll/normalise semantics. |
| **Generation history** | `localStorage` keys `muapi_pending_jobs`, `muapi_uploads`, per-studio `PERSIST_KEY` | Browser-only, per-device, no server record, no ownership. | **No.** Move to DB (`generation_jobs` table) with owner, cost, inputs, outputs. |
| **Async generation handling** | `pendingJobs.js` + `onRequestId` callback | Persists request id before polling so a page reload can resume — good idea. Polling from the browser; no webhooks; no cancellation; no retries with backoff. | **Concept yes**; move to server-side queue + provider webhooks. |
| **Next.js components** | `app/`, `components/StandaloneShell.js`, `packages/studio` (built with Babel/Tailwind) | App Router pages for studio/agents/workflow; studio is a separate workspace package. | Selected UI pieces (pickers, model selector, upload picker) can be ported. |
| **API routes / middleware** | `middleware.js`, `app/api/**` | Middleware rewrites `/api/v1/*` → `api.muapi.ai`; routes proxy agent/workflow/app APIs to Muapi. | **No.** See security findings. |
| **External services** | — | `api.muapi.ai` (all generation, uploads, agents, workflows); S3 presigned uploads issued by Muapi; Hugging Face model downloads (Electron local AI); Wan2GP (optional, self-hosted). | Remove Muapi lock-in entirely. |

### 4.3 Security findings (Repo B)

| # | Finding | Location | Severity |
|---|---|---|---|
| G1 | **Open proxy / SSRF**: `/api/upload-binary` and `/api/v1/upload-binary` POST form data to whatever URL is in the `x-proxy-target-url` field, unauthenticated. | `app/api/upload-binary/route.js`, `app/api/v1/upload-binary/route.js` | **Critical** |
| G2 | API key stored in `localStorage` / `window.__MUAPI_KEY__` and in a `muapi_key` cookie; sent from the browser. Single shared key model; XSS = key theft; no per-user quotas. | `muapi.js`, `api/api/v1/route.js` | High |
| G3 | Unauthenticated pass-through of all `/api/v1/*` to Muapi via middleware rewrite → anyone reaching the app can spend the configured key. | `middleware.js` | High |
| G4 | Logs partial API keys and full payloads (`console.log` of prompts, URLs, key prefix). | multiple | Medium |
| G5 | Proprietary-model ToS: content generated via a reseller may carry use restrictions (commercial use, likeness, real-estate misrepresentation rules). | — | Legal/Medium |
| G6 | Model catalog includes NSFW-oriented endpoints (e.g. `wan2.2-spicy-image-to-video`). Must be excluded from a company product. | `models.js` | Policy |

---

## 5. Repository C — ffmpeg.wasm

| Package | Version | License |
|---|---|---|
| `@ffmpeg/ffmpeg` (JS wrapper, worker messaging) | 0.12.15 | MIT |
| `@ffmpeg/util` | 0.12.2 | MIT |
| `@ffmpeg/types` | 0.12.4 | MIT |
| `@ffmpeg/core` (single-thread WASM build) | 0.12.10 | **GPL-2.0-or-later** |
| `@ffmpeg/core-mt` (multi-thread WASM build) | 0.12.10 | **GPL-2.0-or-later** |

- Root LICENSE is MIT (© 2019 Jerome Wu) and the README shows an MIT badge, but the **published cores are GPL** because `Dockerfile` configures FFmpeg with `--enable-gpl --enable-libx264 --enable-libx265`.
- Repo activity: last commit 2025-09-16 (~14 months before this audit) — maintenance is slow.
- Multi-thread core needs `SharedArrayBuffer` → requires COOP/COEP headers site-wide, which conflicts with embedding third-party content and with some CDN media.
- Performance: WASM ffmpeg is roughly an order of magnitude slower than native; memory is capped (~2 GB in 32-bit wasm). FableCut already avoids it by using **WebCodecs** in-browser + **native ffmpeg** server-side.

**Verdict:** Not needed for v1. Optional later for small client-side tasks (thumbnail extraction, quick trims of uploads before upload). If used, build a **custom LGPL-only core** (no `--enable-gpl`, no x264/x265; use libvpx/aom/opus) or accept GPL obligations for the shipped WASM.

---

## 6. Feature inventory — already implemented upstream

See `FEATURE_MATRIX.md` for the full mapping. Headline: FableCut already delivers ~80 % of the **editing/rendering** needs of a listing-video product (photo sequencing, Ken Burns, transitions, titles, music, ducking, captions, social presets). Open Generative AI delivers the **UX patterns** for AI generation (schema-driven model forms, camera/lens prompt builder, start/end-frame I2V, resumable jobs) but its **backend is a thin client for a single commercial reseller** and should not be adopted as-is.

## 7. Recommended integration approach (summary)

1. **Do not merge the two applications.** Build a new secure **Platform** app (auth, orgs, listings, projects, assets, jobs, admin, billing/quotas).
2. **Vendor FableCut** at `579b08e` into `packages/fablecut-core` as a patched fork; embed the editor UI on an **isolated origin** and replace its `server.js` with a tenant-scoped **FableCut-compatible gateway** backed by Postgres + object storage. Reuse `edit-ops.js` / `project-ops.js` / `templates.js` server-side to auto-assemble listing videos.
3. **Re-implement** the AI generation layer as a provider-neutral `ai-providers` package with server-side jobs and webhooks; **port selected patterns/code** from Open-Generative-AI **upstream** (MIT, `Anil-matcha/Open-Generative-AI` ≥ `1ff3667`), with attribution. No Muapi dependency.
4. **Render** in sandboxed headless-Chromium workers running FableCut's Fast export + native ffmpeg.
5. **Skip ffmpeg.wasm** in v1.

Details: `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `LICENSES.md`.

## 8. Open items to verify in Stage 2
- Populate B's submodules at the pinned commits and read their source/licences (only their HEADs were checked).
- Run FableCut's and B's test suites in a sandboxed container (blocked in this stage).
- `npm audit` / OSV scan of B's lockfile (16.8 k lines) and confirm Next.js 15.5.x has no open advisories at time of adoption.
- Confirm provenance of B's `public/assets/cinema/*.webp` preview images.
- Re-verify DNS-rebinding resistance in FableCut `import-url.js` (resolve-then-connect pinning).
- Legal review of terms for any AI video provider chosen (commercial use, output ownership, likeness/consent, MLS/advertising rules on AI-altered property imagery).
