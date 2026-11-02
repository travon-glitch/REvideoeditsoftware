# Feature Matrix

Legend — **Reuse**: use upstream code largely as-is (patched) · **Adapt**: port/rewrite pattern or small code with attribution · **Build**: our own code · **—**: not available.

Target capabilities are our own interpretation of a modern AI listing-video product (the kind of workflow Rendy.io offers); they are not a copy of any product's feature list.

## 1. Core listing-video workflow

| Capability | FableCut (A) | Open Gen AI (B) | ffmpeg.wasm (C) | Decision |
|---|---|---|---|---|
| Upload listing photos/videos | ✅ `/api/upload`, `import-url` (SSRF-safe) | ✅ via Muapi presigned S3 | — | **Build** (presigned uploads to our bucket, AV/MIME scan) |
| Import from listing URL / MLS feed | Partial (`import-url` single file) | — | — | **Build** (MLS/IDX/RESO adapter, later stage) |
| Auto-assemble photos → timed slideshow | ✅ via `edit-ops.js` `insert`/`overwrite` ops (Node-callable) | — | — | **Reuse** ops + **Build** "listing → project.json" generator |
| Ken Burns / 2D camera moves on photos | ✅ `scale`/`x`/`y` keyframes, easing, motion blur, CLAUDE.md "Ken Burns" recipe | — | — | **Reuse** + preset library (push-in, pull-out, pan L/R, tilt) |
| AI camera motion (dolly, orbit, drone, parallax) from a photo | — (2D only) | ✅ I2V via 61 Muapi models; start/end-frame support | — | **Adapt** (schema-driven model forms) + **Build** provider adapters |
| Camera / lens "look" presets | — | ✅ Cinema Studio prompt tables (camera, lens, focal, aperture) | — | **Adapt** tables, extend with real-estate moves |
| AI image enhancement (sky replace, virtual staging, declutter) | — | ✅ I2I models via Muapi | — | **Build** adapters (later stage; ⚠ disclosure rules) |
| Transitions | ✅ 18 types | — | — | **Reuse** |
| Text overlays: price, address, beds/baths, agent | ✅ 13 animations, 9 title styles, templates | — | — | **Reuse** + our branded templates |
| Brand kit (logo, colours, fonts, outro card) | Partial (templates/presets, fonts) | — | — | **Build** brand-kit model → injects into templates |
| Background music + beat sync | ✅ `beats.js`, markers, snap | — | — | **Reuse** + licensed music library (**Build**) |
| AI voice-over (TTS) from listing description | — | Partial (Muapi audio models; lip-sync studio) | — | **Build** TTS adapter |
| Script generation from listing data (LLM) | — (MCP lets an agent edit) | Agents studio (Muapi) | — | **Build** (LLM call → script + shot list) |
| Voice/music ducking, loudness | ✅ `ducking.js`, `loudness.js` (EBU R128) | — | — | **Reuse** |
| Auto captions | ✅ Whisper in browser, SRT/VTT, karaoke styles | — | — | **Reuse** (self-host model) or server-side Whisper (**Build**) |
| Multiple aspect ratios (16:9, 9:16, 1:1, 4:5) | ✅ sequences + `reframe.js` subject-follow | — | — | **Reuse** |
| Social delivery presets | ✅ YouTube, Shorts, Reels, TikTok, X, LinkedIn… | — | — | **Reuse** |
| Manual fine-tuning in a timeline editor | ✅ full NLE | — | — | **Reuse** (embedded, isolated origin) |
| Server-side render to MP4 | ✅ headless Chrome + native ffmpeg (1 job/server) | — | — | **Reuse** in scaled worker pool |
| Client-side transcode/trim | WebCodecs | — | ✅ (GPL core) | **Skip v1** |

## 2. AI generation infrastructure

| Capability | A | B | Decision |
|---|---|---|---|
| Provider-neutral model registry with typed input schemas | — | ✅ `models.js` (`inputs` with enum/min/max/default) — Muapi-specific slugs | **Adapt** schema shape; **Build** registry |
| Submit → poll → normalise result | — | ✅ `pollForResult` (2 s, 60 tries) | **Adapt** into server worker with backoff + webhooks |
| Resume jobs after reload | — | ✅ `pendingJobs.js` (localStorage) | **Build** server-side (`generation_jobs` table) |
| Generation history | — | ✅ localStorage, 30 items/device | **Build** (DB, per user/org, searchable) |
| Cancellation, retries, timeouts | — | ✗ | **Build** |
| Cost tracking / quotas | — | ✗ | **Build** |
| Self-hosted open-weight video model | — | Partial (Electron Wan2GP Gradio client) | **Build** later (GPU worker), licence-gated |
| Content safety filter | — | ✗ (catalog includes NSFW endpoint) | **Build** (allowlisted models, prompt policy) |

## 3. Platform (all **Build**)

| Capability | A | B |
|---|---|---|
| Authentication (SSO/OIDC, MFA) | ✗ unauthenticated by design | ✗ (API-key modal only) |
| Organisations, teams, roles (admin / agent / editor / viewer) | ✗ | ✗ |
| Per-user project ownership & sharing | ✗ single global `project.json` | ✗ |
| Listings (address, price, specs, photos) data model | ✗ | ✗ |
| Asset storage (S3-compatible), signed URLs | ✗ local disk | Muapi S3 |
| Job queue (generation, render) | Export queue, 1 at a time | ✗ (browser polling) |
| Versioning | ✅ file-based versions (`history.js`) — **Adapt** to DB | ✗ |
| Admin console (users, usage, model allowlist, audit log) | ✗ | ✗ |
| Audit trail of AI prompts/outputs | ✗ | ✗ |
| AI assistant that edits a video by chat | ✅ MCP tools (local stdio) — **Adapt** as server-side tools scoped to one project | Agents (Muapi) |

## 4. Coverage summary

| Layer | Reused | Adapted | Built |
|---|---|---|---|
| Timeline / editor / compositor / render | ~85 % (FableCut) | ops server-side, storage | gateway, workers |
| AI video generation | 0 % code as-is | ~25 % (UI patterns, prompt tables, schema shape) | adapters, jobs, history, safety |
| Platform (auth, data, admin) | 0 % | versions concept | ~100 % |
