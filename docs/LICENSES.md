# Licenses & Third-Party Obligations

**Audit date:** 2026-11-02 · This is an engineering assessment, not legal advice. Items marked **⚠ Legal review** need sign-off from counsel before production.

## 1. Product licensing posture

The product is **private and company-owned** (proprietary). Therefore:

- **Permissive** licences (MIT, BSD, Apache-2.0, ISC, OFL for fonts) → **OK to incorporate**, keep notices.
- **Weak copyleft** (LGPL, MPL) → OK if dynamically linked / kept as separate files, with the licence's source obligations.
- **Strong copyleft** (GPL) → **Do not incorporate into code we distribute** (anything shipped to browsers or desktops). Server-side-only use of GPL programs (e.g. running a native `ffmpeg` binary as a separate process) is acceptable because GPL-2.0 has no network-use clause and we are not distributing it — but keep it as a separate executable, never linked into our code.
- **AGPL / SSPL / "community" / non-commercial model licences** → **Excluded** unless legal approves case by case.
- **No licence / unclear** → **Excluded** until resolved.

## 2. Upstream repositories

| Repo @ revision | Declared licence | Licence file present? | Verdict |
|---|---|---|---|
| FableCut @ `579b08e` | MIT (`package.json` + `LICENSE`, © 2026 ronak-create) | ✅ | **Compatible.** Vendor with LICENSE retained. |
| FableCut `library/fonts/*.woff2` (20 families) | SIL OFL 1.1 (`library/fonts/LICENSES.md`) | ⚠ Summary file only; per-family OFL texts not bundled | **Compatible.** Must ship the full OFL text + copyright line per family (fetch from Google Fonts) — OFL requires the licence accompany the font. Fonts may not be sold on their own. |
| FableCut `library/svg`, `library/elements` | Repo MIT (stated self-authored) | ✅ (repo) | Compatible. |
| avoltaire/open-generative-ai @ `958897e` | "MIT" stated only in README and `packages/studio/package.json` | ❌ **No LICENSE file** at this revision | **Do not copy from the fork.** A README line without the licence text/copyright notice is an incomplete grant. |
| Anil-matcha/Open-Generative-AI @ `84b29a5` (upstream) | MIT, "© 2026 Open Generative AI Contributors" | ✅ Added in commit `1ff3667` (2026-06-12, "Add root MIT license metadata") | **Compatible.** The fork's history is a strict ancestor of this commit, so the same code is available under an explicit MIT grant here. **Source any reused code from the upstream at ≥ `1ff3667`**, cite the upstream commit, keep the MIT notice. |
| Submodule `SamurAIGPT/Vibe-Workflow` | MIT, © 2024 Vibe Workflow Contributors | ✅ (at HEAD `121bde4`) | Compatible — but **not needed**; not planned for reuse. |
| Submodule `Anil-matcha/Open-Poe-AI` | "MIT" in README + `packages/agents/package.json` | ❌ No LICENSE file at HEAD `3e21ebc` | **Excluded** (unclear). Not needed. |
| Submodule `Anil-matcha/Open-AI-Design-Agent` | MIT, © 2023 Anil Chandra Naidu Matcha | ✅ (at HEAD `f029d0d`) | Compatible — not needed. |
| ffmpeg.wasm `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/types` | MIT | ✅ | Compatible. |
| ffmpeg.wasm `@ffmpeg/core`, `@ffmpeg/core-mt` 0.12.10 | **GPL-2.0-or-later** (FFmpeg built `--enable-gpl` with x264, x265) | ✅ | **Excluded from v1.** Serving the WASM to browsers is distribution → GPL source-offer obligations and copyleft risk for code bundled with it. If ever needed: custom **LGPL** build (no `--enable-gpl`, no x264/x265). |

## 3. Runtime / transitive third-party components

| Component | How it enters | Licence | Obligation / action |
|---|---|---|---|
| **FFmpeg (native binary)** on render/worker hosts | FableCut spawns `ffmpeg`/`ffprobe` | LGPL-2.1+ or GPL-2.0+ depending on build | Server-side separate process → acceptable. Prefer an **LGPL build** with `libopenh264`/hardware H.264 if we ever ship the binary to customers (e.g. desktop app). Record exact build config in `THIRD_PARTY_NOTICES`. |
| **H.264 / HEVC / AAC codecs** | Encoding exports | Patent pools (Via LA / Access Advance) | ⚠ Legal review. Usually covered for internal/free-distribution volumes; HEVC (x265) is the riskiest — **default to H.264 + AAC**, avoid HEVC encodes. |
| `@huggingface/transformers` 4.3.1 (Whisper in browser) | FableCut CDN load (jsDelivr) | Apache-2.0 | Self-host the bundle; include Apache NOTICE. Whisper weights: MIT (verify per model repo). |
| `@mediapipe/selfie_segmentation` | FableCut CDN load | Apache-2.0 | Self-host; include NOTICE. Model card terms to verify. |
| Google Fonts (on-demand by family name) | FableCut text renderer | Mostly OFL / Apache | Restrict to an allowlist we self-host; ship licences. |
| Next.js 15.5.x, React 19.2.x, axios 1.15.x | Repo B and our Platform | MIT | Compatible. |
| Electron 33 / electron-builder | Repo B desktop | MIT (Chromium bundles many licences) | Not planned. |
| `@xyflow/react`, `reactflow`, `lucide-react`, `react-icons`, `react-markdown`… | Repo B `packages/studio` | MIT / ISC (react-icons aggregates icon sets with mixed licences incl. CC-BY) | Only adopt what we use; if `react-icons` is used, check each icon set's licence. |
| sd.cpp binary (Repo B Electron local AI) | Downloaded at runtime | MIT | Not planned for v1. |

A full SBOM (CycloneDX) with licence scan will be generated in Stage 2 (`license-checker`/`osv-scanner`) over *our* lockfile, with a CI gate that fails on GPL/AGPL/unknown licences in shipped bundles.

## 4. AI models and generation services (⚠ Legal review)

Open source code licences do **not** cover model weights or API outputs. Each must be cleared separately.

| Option | Typical terms to check | Notes |
|---|---|---|
| **Muapi.ai** (Repo B default) | Reseller ToS + each underlying provider's ToS | **Rejected** as a hard dependency (lock-in, shared key model, unclear chain of rights). |
| Direct commercial APIs (e.g. Kling, Runway, Luma, Google Veo, OpenAI Sora, MiniMax, ByteDance Seedance) | Commercial-use rights, output ownership, data retention/training on our uploads, content policy | Choose 1–2 via adapters; review each contract. |
| Aggregators (fal.ai, Replicate) | Platform ToS **plus** per-model licence | Convenient; still need per-model clearance. |
| Self-hosted open-weight models (e.g. Wan 2.x, LTX-Video, HunyuanVideo, CogVideoX) | Each has its **own** licence: some Apache-2.0, some custom "open weights"/"community" licences with revenue thresholds, use restrictions or territorial exclusions | Must verify the exact licence of the exact checkpoint before use. Treat as unknown until verified. |

**Real-estate specific (⚠ Legal review):** AI-generated motion from listing photos can invent or alter property features. Advertising/MLS rules and fair-housing rules apply. Plan for: a visible "AI-enhanced" disclosure option, no structural alteration prompts, retention of original photos, and an audit trail of prompts/outputs per video.

## 5. Brand / trade-dress

- The product is "inspired by the capabilities of Rendy.io". **Do not copy** Rendy's name, logo, UI layouts, marketing copy, templates, music or sample videos. Build our own templates and visual identity.
- Do not reuse Repo B's `public/assets/cinema/*.webp` camera/lens preview images until provenance is confirmed (they may depict real manufacturers' products; product names have already been genericised in the code, which is good practice to continue).
- "Open Generative AI" README positions itself against "HF AI" (Higgsfield); avoid any of that branding.

## 6. Attribution we must ship

Create `THIRD_PARTY_NOTICES.md` (and an in-app "Open-source licences" page) containing at minimum:

1. FableCut MIT licence text — © 2026 ronak-create — with upstream URL and commit `579b08e`.
2. Open-Generative-AI MIT licence text — © 2026 Open Generative AI Contributors — upstream `Anil-matcha/Open-Generative-AI` commit we port from (≥ `1ff3667`) — **only if** we copy code (porting ideas alone does not require it, but we will attribute anyway).
3. OFL 1.1 full text + per-family copyright for every bundled font.
4. Apache-2.0 NOTICE for transformers.js and MediaPipe if self-hosted.
5. FFmpeg build licence and configuration of the binary deployed.
6. Auto-generated list from the SBOM for all npm dependencies in shipped bundles.

## 7. Code-reuse rules for contributors

- Every file copied or derived from an upstream gets a header: `// Derived from <repo>@<commit>:<path> — MIT, see THIRD_PARTY_NOTICES.md`.
- Vendored upstream code lives under `packages/fablecut-core/` (or `vendor/`) with an `UPSTREAM.md` recording repo, commit, and a list of local patches.
- Never copy from `avoltaire/open-generative-ai`, `Open-Poe-AI`, or any source without an explicit licence file.
- Never add `@ffmpeg/core*` (GPL) to a shipped bundle.

## Stage 7 additions (Camera Studio)

| Component | Licence | How it is used | Verdict |
|---|---|---|---|
| MiDaS v2.1 small depth model (`model-small.onnx`, Intel ISL — github.com/isl-org/MiDaS) | MIT | Downloaded by `npm run fetch-model -w @lvs/ai-motion` (SHA-256 pinned), run **only on the AI worker server**; not committed, not sent to browsers | Compatible. Keep the MIT notice with deployments. |
| `onnxruntime-node` 1.20.1 (Microsoft) | MIT | Runs the depth model on the worker | Compatible. |
| MuAPI request flow (`packages/ai-motion/src/providers/muapi.ts`) | MIT — adapted from Open-Generative-AI `src/lib/muapi.js` (upstream Anil-matcha/Open-Generative-AI, same code as the audited fork, MIT ≥ `1ff3667`) | Server-side provider adapter; only active when `MUAPI_API_KEY` is set | Compatible; attribution in the file header. **⚠ Legal review**: MuAPI's own terms of service and each video model's output licence must be accepted by the company before it is switched on. |
| Cinema Studio presets (camera/lens look tables) | MIT (already vendored in `packages/camera-presets/upstream`, Stage 1) | Studied for the preset structure; our presets are original | Compatible. |
| OpenCV sample images `home.jpg`, `building.jpg` (`apps/web/tests/fixtures/opencv-*.jpg`) | Apache-2.0 (OpenCV 4.x) | Test fixtures only (Stage 7 acceptance tests) | Compatible; not shipped in the app. |

## Stage 9 additions (AI Video Director)

| Component | Licence | How it is used | Verdict |
|---|---|---|---|
| `@anthropic-ai/sdk` 1.4.0 (official Anthropic TypeScript SDK) | MIT | Server-side calls to the Claude API (photo interpretation, storyboard) | Compatible. Use of the Claude API is governed by Anthropic's commercial terms, accepted by the company when it creates its API key. |
