# Implementation Plan

Stage 1 (this document set) is **complete**. Nothing below is implemented yet; Stage 2 begins on approval.

## Phase 0 — Foundations (Stage 2 start)
1. `git init` the product monorepo; add `reference/` to `.gitignore`.
2. Scaffold layout from `ARCHITECTURE.md` §6 (pnpm + Turborepo, TypeScript strict, ESLint, Prettier).
3. CI: lint, typecheck, unit tests, **licence gate** (fail on GPL/AGPL/unknown in shipped bundles), SBOM (CycloneDX), `osv-scanner`, container scan.
4. Sandboxed run of upstream test suites (FableCut `node --test`, OGAI tests) to establish a baseline before patching.
5. Populate OGAI submodules at pinned commits only to confirm nothing we need lives there (expected: nothing).
6. `docker-compose` dev stack: Postgres, Redis, MinIO, Mailpit, ClamAV.

## Phase 1 — Vendor & patch FableCut (`packages/fablecut-core`)
Copy FableCut @ `579b08e` (not the `docs/` website, not `exports/`/`media/`), keep LICENSE, write `UPSTREAM.md`. Patch series (each a separate, reviewable patch file so we can rebase on future upstream releases):

| Patch | Purpose |
|---|---|
| P01 `api-base` | Make the UI's API base URL + auth header configurable (token from `postMessage`). |
| P02 `remove-path-arg` | Delete `?path=` / `X-FableCut-Client` bypass (F3). |
| P03 `no-cdn` | Point transformers.js, MediaPipe and fonts at self-hosted copies with SRI; restrict Google-Font loading to an allowlist (F8). |
| P04 `project-identity` | Replace "one open project" assumptions with an explicit `projectId` in every call. |
| P05 `feature-flags` | Hide UI for features not yet supported by the gateway (denoise, analyze, transcribe…) until enabled. |
| P06 `svg-policy` | Disallow raw SVG upload in UI; accept only sanitised/library SVGs (F5). |
| P07 `postmessage-bridge` | Events to parent: dirty state, save status, request AI clip for selected photo. |

Deliverable: editor loads in the iframe against a mock gateway with a fixture project.

## Phase 2 — Platform core + Editor Gateway
1. DB schema & migrations (+ RLS), auth (OIDC), RBAC, orgs/users/admin basics, audit log.
2. Assets: presigned uploads, `media.ingest` worker (size caps, magic bytes, AV scan, ffprobe, thumbnails, proxies).
3. Editor Gateway: `/api/project` (409 semantics), SSE, media signed URLs, media-info, proxy status, projects/versions mapping.
4. Formal `project.json` schema + validator in `packages/timeline`; reject invalid writes.
5. *Fallback if the gateway slips:* interim per-session sandboxed FableCut container behind the auth proxy (with P02/P06 applied, data volume per project). Not for production at scale.

## Phase 3 — Rendering
1. `render-worker` image (pinned Chromium, LGPL ffmpeg, vendored UI); job contract `{projectId, revision, preset}`.
2. Drive FableCut's Fast export headlessly against an in-container gateway stub; upload MP4 to S3; progress via SSE.
3. Delivery presets from `delivery.js` exposed in Platform (16:9 YouTube/MLS, 9:16 Reels/TikTok/Shorts, 1:1, 4:5).
4. Golden-frame regression tests (see Test Strategy).

## Phase 4 — Listing Video Composer (the "one-click" product)
1. Listing form + photo upload/reorder; brand kit.
2. 3–5 original templates (Luxury, Modern, Quick Social, Open House, Just Sold) as parameterised JSON.
3. Composer: listing + brand + template → `project.json` (Ken-Burns presets, transitions, title cards, music on beat markers, outro), both 16:9 and 9:16 sequences via `reframe`/sequences.
4. "Generate" → render → review → approve → download/share link.

## Phase 5 — AI video generation
1. `ai-providers` interface, model registry with input schemas, cost estimator, quotas.
2. Two adapters initially: one commercial I2V API and one aggregator (selected after legal review); a `mock` provider for tests.
3. gen-worker with webhooks + polling fallback, retries with backoff, cancellation, idempotency.
4. AI Studio UI: per-photo **Camera Move** picker (adapted from OGAI Cinema Studio wheels), model form renderer from schema, start/end-frame mode, history panel backed by DB.
5. Composer integration: per photo choose `ken_burns | ai_move`; AI outputs inserted as video clips; automatic fallback to Ken Burns on failure.
6. Guardrails: model allowlist, prompt policy, "AI-enhanced" disclosure overlay option, audit records.

## Phase 6 — Voice, script, captions
LLM script from listing data → TTS adapter → voice-over clip → FableCut auto-duck + captions (server-side Whisper or self-hosted transformers.js).

## Phase 7 — Hardening & launch
Pen test, load test render pool, backup/restore drills, observability (OpenTelemetry, per-job logs), cost dashboards, runbooks, `THIRD_PARTY_NOTICES` + in-app licences page.

---

## Required modifications (consolidated)

**FableCut:** patches P01–P07 above; replace `server.js` with gateway; scale export from 1 job/server to N workers; formal schema; DB-backed projects/versions; self-hosted ML assets; full OFL texts for fonts.

**Open Generative AI (upstream, MIT ≥ `1ff3667`):** port only: camera/lens/focal/aperture tables and prompt compiler (`src/lib/promptUtils.js`); model-input-schema shape (`packages/studio/src/models.js` entries, not the catalog itself); start/end-frame field convention (`lastImageField`); resumable-job idea (`pendingJobs.js`) re-implemented server-side; optionally the scroll-wheel picker UI (`CinemaStudio.jsx` column component) rewritten in TypeScript. Remove: Muapi client/middleware/proxy routes, localStorage key handling, upload-binary proxy, agents/workflow/apps studios, Electron, NSFW models, cinema preview images.

**ffmpeg.wasm:** none in v1.

## Integration risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FableCut UI has hidden coupling to server behaviours not in the documented REST contract | Medium | High | Phase 1 contract tests: record all UI → API calls against upstream server, replay against gateway. |
| Upstream FableCut changes fast (v1.18, very active) → patch rebase cost | High | Medium | Small, isolated patch files; pin commit; scheduled quarterly rebase; contract test suite. |
| Single maintainer upstream (bus factor) | Medium | Medium | We own a fork; no runtime dependency on upstream availability. |
| `app.js` (20 k lines) security bugs | Medium | High | Separate origin, CSP, sandboxed iframe, no secrets in editor. |
| Headless Chromium render determinism (fonts, GPU, codec support) | Medium | Medium | Pinned Chromium + fonts in image; software rendering; golden-frame tests. |
| Render cost/throughput (browser compositor is CPU heavy) | Medium | Medium | Autoscale workers; proxy media; WebCodecs mode where possible. |
| AI provider instability / price changes / ToS | High | Medium | Adapter interface, ≥2 providers, Ken-Burns fallback, cost caps. |
| Licensing of model weights / outputs | Medium | High | Legal review gate before enabling any model in prod. |
| Real-estate advertising compliance (AI-altered imagery) | Medium | High | Disclosure option, no structural-change prompts, approvals, audit. |
| OGAI code quality (large components, console-logged keys) | High | Low | Port patterns, not files. |

---

## Test strategy

| Level | What | Tooling |
|---|---|---|
| **Upstream baseline** | Run FableCut's 50 `node --test` files and OGAI tests in a sandbox before and after each patch. | `node --test`, Docker |
| **Unit** | Timeline schema validation & migrations; Listing Composer (fixture listing → expected `project.json` snapshot); provider adapters (mocked HTTP); cost estimator; authz policies (table-driven allow/deny matrix per role). | Vitest |
| **Contract** | Gateway vs. FableCut UI: recorded request/response pairs from upstream `server.js` replayed against gateway (status codes, 409 revision conflict, SSE event names). Provider webhooks: signed fixtures. | Vitest + Pact-style fixtures |
| **Integration** | Postgres + RLS (a user in org A can never read org B rows — run every repository method as both); S3 signed URL expiry; queue retry/idempotency; gen-worker end-to-end with `mock` provider. | Testcontainers |
| **E2E** | Login → create listing → upload photos → generate → edit in iframe → render → download. Two-user concurrent edit → 409 handling. | Playwright (pre-installed Chromium) |
| **Render regression** | Golden frames at fixed timestamps for each template; PSNR/SSIM threshold; audio LUFS within ±0.5 LU; output probe (codec, fps, duration, dims). | ffmpeg/ffprobe, `ssim` filter |
| **Security** | Tests for every audit finding (F1–F10, G1–G6): `?path=` returns 404; oversized upload rejected; SVG with script rejected/sanitised; SSRF targets (169.254.169.254, 10/8, ::1, redirect chains, DNS rebinding) blocked; cross-tenant IDOR on every route; CSP headers present; editor token scope/expiry. Plus SAST (Semgrep), dependency scanning, container scanning, DAST (OWASP ZAP) before launch. | Vitest, Semgrep, osv-scanner, Trivy, ZAP |
| **Media fuzzing** | Malformed MP4/JPEG/HEIC corpus through media-worker in sandbox; verify containment (timeouts, no crash escape). | ffmpeg fuzz corpora |
| **Load** | Render pool throughput (N concurrent 60 s 1080p renders), gateway SSE fan-out, gen-worker backpressure. | k6 |
| **Licence** | CI gate on SBOM; fail on GPL/AGPL/unknown in shipped bundles; notices file regenerated and diffed. | license-checker / CycloneDX |

## Exit criteria for Stage 2 kickoff
- Approval of architecture (gateway vs. interim per-session containers).
- Choice of IdP, cloud/object storage, and first AI providers (pending legal review).
- Confirmation that the product is internal-only vs. offered to external agents/brokerages (affects GPL/codec/patent and ToS analysis).
