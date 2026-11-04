# Stage 14 — Test, optimize and prepare for production

**Audit date:** 2026-11-04.

This stage audited functionality, usability, security, video quality, performance and deployment. It fixed what the audit found, and it adds the production, monitoring, backup and maintenance guides.

## Verdict

- **Every automated test passes:**
  - 272 unit and database tests;
  - 63 end-to-end render tests, which make real MP4s;
  - 35 package tests;
  - typecheck and production build.
- **The security audit found no critical or high issues.** Every medium and low finding has been fixed or explicitly accepted (see section 5).

**Not yet confirmed production-ready.** These parts depend on services this environment can't reach, and they haven't been run end to end against them:
- Supabase Auth sign-in, invitation and password-reset email;
- direct browser uploads to Supabase Storage;
- the live Claude API;
- the live MuAPI API.

The code paths are covered by the database-rule tests and a live check of the production server. The remaining step is the **go-live checklist in `docs/DEPLOYMENT.md` §11** on a staging Supabase project. It takes about 30 minutes: invite a test agent, sign in, upload photos, make, render and download a video. When that passes, the system meets the bar for production.

---

## 1. Implemented feature checklist

| Workflow | Status | How it was verified |
|---|---|---|
| Login (email and password, no public sign-up) | ✅ Built | Route protection unit tests; live production-server check: protected pages redirect to `/login`, APIs return 401 when signed out, security headers present. **Real Supabase sign-in unverified here.** |
| Admin-created users (invite, roles, suspend, deactivate) | ✅ Built | Database acceptance tests (13 Stage 3 + 13 Stage 13); quick actions in People. **Invitation email unverified here.** |
| Role permissions (Viewer, Editor, Admin, Super Admin) | ✅ Built | 22 RLS tests, 13 isolation tests, 13 admin-control tests, 7 catalog tests, 11 role tests, server-action refusal tests |
| Listing creation | ✅ Built | 14 database tests, 11 unit tests |
| Photo uploads | ✅ Built, **fixed** | Storage rule tests. Fixes: HEIC files were accepted but couldn't be rendered (now refused with plain guidance; iPhones convert automatically); oversized photos are scaled to 4096 px before upload; each file's real content is checked. **Real browser-to-Storage upload unverified here.** |
| Video editor (Easy and Advanced) | ✅ Built | 10 unit, 7 database and 7 end-to-end tests (render, audio sync, visuals, captions, Chrome playback) |
| Standard camera animations | ✅ Built | 21 camera-engine tests; 9 end-to-end tests (the preview matches the exported MP4, and moves go the right way) |
| Advanced AI camera generation | ✅ AI depth / ⚠ generative | AI depth (MiDaS, on your own server) is rendered and verified end to end. **Generative MuAPI clips are skipped (they need a live key), so they're unverified.** |
| AI effects (sky, staging, clutter…) | ❌ **Not built** | A placeholder page only. It has been removed from the menu so agents don't land on an empty page. |
| AI Video Director | ✅ Built / ⚠ live Claude | Storyboard → compile → fact-check → real render → matches the plan (3 end-to-end tests) using a **simulated** Claude response. **The live Claude call is unverified here.** |
| Six-video generator | ✅ Built | 7 end-to-end tests (six different vertical MP4s, retry, ZIP download), 9 database and 8 unit tests |
| Templates (15) | ✅ Built | 15/15 render; template acceptance 7/7; 22 unit and 12 database tests |
| Company branding | ✅ Built | Template acceptance checks frames for the intro bar, banner, agent card with headshot and disclosure. Branding rules can no longer be bypassed (see 5.1). |
| Voiceovers (AI narration) | ✅ Built | Narration drafted from verified facts, spoken, and every word timed: mean offset **0.064 s**, median 0.02 s, 90% within 0.035 s (35/35 words), measured after the new loudness step |
| Subtitles / captions | ✅ Built | The highlighted word is on screen while it's spoken, and nothing shows between lines |
| MP4 rendering (9:16, 16:9, 1:1, 4:5) | ✅ Built | Every shape renders at the right size. H.264 High, yuv420p, 30 fps, AAC 48 kHz, fast-start |
| Downloads (single, ZIP, library) | ✅ Built | Download-permission rules, ZIP opens and verifies, the right people see each file and nobody else does |
| Admin control center (Stage 13) | ✅ Built | 13 database and 11 unit tests |

## 2. Passing tests

| Suite | Result |
|---|---|
| Web unit and database tests (`npx vitest run` in `apps/web`, 30 files) | **272/272** |
| End-to-end render tests (`npm run test:render -w @lvs/web`, 7 files) | **63/63 passed**, 1 skipped (MuAPI; needs a key) |
| Camera engine (`packages/camera-presets`) | **21/21** |
| AI motion (`packages/ai-motion`) | **8/8** |
| Voice (`packages/voice`) | **6/6** |
| Typecheck, every workspace (`npm run typecheck`) | **pass** |
| Production build (`next build`) | **pass** |

New tests this stage:
- `tests/db/catalog-audit.test.ts` (7):
  - every table has RLS;
  - anonymous visitors have no table privileges and can't run any reachable function;
  - every access rule is for signed-in users only;
  - every privileged function pins its search path;
  - worker-only functions are closed to users;
  - every bucket is private.
- `src/lib/__tests__/hardening.test.ts` (7): file-content checks, HEIC refusal, password re-check rules, rate limit, plain-language job errors.
- `editor.test.ts`: renders are refused when queued directly by anyone (owner, colleague, viewer), and size and length limits are enforced.
- Updated tests: `editor-voice`, `batches`, `admin-control` and `templates.acceptance` now queue renders the way production does (from the server).

Live production-server check (`next start`):

| Request | Result |
|---|---|
| `/healthz` | 503 `{"ok":false}` with the database down, and reveals nothing else |
| `/auth/confirm?…` | Goes to the Continue page; the token isn't used |
| Cross-site POST to `/auth/confirm` | Refused |
| `/videos/x.png` | Login redirect and CSP header (before, it was skipped) |
| `/api/admin/ai-usage` when signed out | 401 |
| `/login` on an iPhone 13 | 48 px buttons, no horizontal scrolling |

## 3. Failing tests

**None.** Two problems came up during the audit and were resolved:
1. `editor.acceptance` "VISUALS" failed once on a re-run.
   - Cause: the test photos are the same synthetic room in different hues, and the check compared **grayscale** frames, so a near-identical room could win under the caption bar.
   - Not a rendering fault: the video stream is bit-for-bit identical with and without the new loudness step (same MD5).
   - Fix: the check now compares colour as well as structure. 7/7 pass.
2. `batch.acceptance` "all six play in Chrome" failed once while seven test files rendered in parallel (0.7 s of playback in a window that expected more than 0.8 s). It passed on the re-run with less parallelism. It's a timing check on a busy machine, not a playback fault.

## 4. Unverified external integrations

These can't be reached from this environment. Check them on staging with the go-live checklist.

| Integration | What's verified | What isn't |
|---|---|---|
| Supabase Auth: password sign-in, invitation and reset email, SMTP | Middleware, redirects, the two-step email link, account rules in the database | A real sign-in, real emails |
| Supabase Storage (hosted) | Every access rule (tests run the real rules), signed-download logic, content check code | Real uploads, Range reads, signed links on the hosted service |
| Claude API (AI Director) | Request builders, compiler, fact-checker, cost math, render of the storyboard (simulated reply) | A live call with your key. Use **Test connection** in the AI control panel. |
| MuAPI image-to-video | Provider adapter, per-company key storage and decryption (round-trip tested), switches, ceilings | A live generated clip |
| Error webhook (`LVS_ERROR_WEBHOOK_URL`) | Code path and throttling | Delivery to your Slack, Teams or monitoring tool |
| Storage backup script (`scripts/backup-storage.mjs`) | Runs, and fails cleanly when storage is unreachable | A full copy of a real project |

## 5. Security findings

An independent review of the application layer plus a database catalog audit. **No critical or high findings.**

| # | Severity | Finding | Status |
|---|---|---|---|
| 5.1 | Medium | Editors could insert render jobs straight through the database API. That skipped company branding rules (disclosure, logo, agent card) and allowed huge renders (up to 4096×4096, 60 fps, 10 min) that tie up render slots. | **Fixed.** Only the app server queues renders, after its access, branding and document checks (`revoke insert`). A database trigger caps every render at 2160 px, 60 fps and 10 minutes. Tested. |
| 5.2 | Medium | FFmpeg picked the format of uploaded files by their content, so a file uploaded as "audio" that is really a playlist could make FFmpeg read other files. | **Fixed.** Every upload's real content is checked when it's registered (photos, logos, project music, narration, music library). The render worker and AI worker check every file's first bytes before decoding. Speech recognition forces the demuxer and allows only local file protocols. Tested. |
| 5.3 | Low | Voice preview skipped the AI switches, the person's AI permission and project access, with no rate limit. | **Fixed.** Same checks as narration, plus 20 previews a minute per person. |
| 5.4 | Low | The middleware skipped any path ending in `.png`, `.jpg` and so on (no CSP on those responses). | **Fixed.** Only the public template previews are skipped. Verified live. |
| 5.5 | Low | Upload size, type and dimensions came from the browser. | **Fixed for type** (content checked, see 5.2). Size and dimensions are informational only: storage enforces the size limits, and the renderer reads the real image. |
| 5.6 | Low | The batch ZIP holds one MP4 at a time in memory. | **Accepted.** With the render caps (5.1) one file is bounded (about 15 MB per 30 s 1080p video). |
| 5.7 | Low | Changing your password didn't ask for the current one (risk from a stolen session). | **Fixed.** Required for normal sign-ins, with 5 tries per 15 minutes. Invitation and reset-link sessions set a password directly. |
| 5.8 | Info | Email scanners (such as Outlook Safe Links) could use up invitation and reset links by opening them. | **Fixed.** The link opens a Continue page, and the one-time code is used only when the button is pressed. |
| 5.9 | Info | Anonymous visitors still held table privileges (RLS already returned nothing). | **Fixed.** All anon privileges revoked. A catalog test keeps it that way. |
| 5.10 | Info | AES-GCM secrets have no associated data (the ciphertext isn't bound to the company or key name). | **Accepted.** The table is service-role only with one company per install. Revisit if the app ever serves several companies. |
| 5.11 | Info | The render worker's default Chrome wrapper uses `--no-sandbox`. | **Documented.** Run the worker as a non-root user with `FABLECUT_CHROME` (DEPLOYMENT.md §5). |
| 5.12 | Dependency | `npm audit` (production): postcss inside Next (high; build-time only, it processes our own CSS, not user input) and zod 3 (high; memory use on oversized arrays: request bodies are capped at 512 KB / 2 MB and only staff can reach validators). | **Accepted, with an upgrade plan.** The fixes need Next 16 and zod 4 (both breaking upgrades). Schedule them as a maintenance task (MAINTENANCE.md). |

**Areas reviewed and found sound:**
- **Sign-in and sessions:** sessions validated with `getUser()`; active-profile check on every request; suspension also bans sign-in; safe redirects; POST-only logout.
- **CSRF:** Origin checks on every mutating API and server action.
- **Server checks:** every API route and server-action file checks the role on the server and validates input.
- **Service-role use:** always after the permission check and scoped to the company.
- **Secrets:** encrypted, only the last 4 characters shown, never sent to the browser.
- **Storage:** six private buckets with path rules.
- **Setup:** one-time setup code stored as a hash.
- **Headers:** nonce CSP, HSTS, `frame-ancestors 'none'`, `noindex`.
- **Workers:** no shell commands, file names on an allow-list, FableCut bound to localhost with a minimal environment.
- **Exports:** CSV formula-injection guard.

## 6. License compliance findings

| Item | Licence | Finding |
|---|---|---|
| Production npm dependencies (74) | 44 MIT, 10 Apache-2.0, 4 ISC, 4 BlueOak-1.0.0, 1 BSD-3, 1 0BSD, 1 Unlicense, 1 CC-BY-4.0 (caniuse data), 4 are our own private packages | ✅ Compatible |
| `sharp` / `libvips` (used by Next's image optimizer) | LGPL-3.0-or-later (prebuilt, unmodified, dynamically loaded) | ✅ Fine for internal use; keep the notice. The LGPL's relinking obligation applies only if you distribute the software. |
| FableCut (vendored renderer) | MIT | ✅ LICENSE kept |
| FableCut fonts (20 families) | SIL OFL 1.1 | ✅ **Fixed this stage:** the full OFL text and copyright line for each family are now bundled (`packages/fablecut-core/upstream/library/fonts/licenses/`, from the official google/fonts repository) |
| Voice models (Kokoro-82M, Zipformer) and sherpa-onnx | Apache-2.0 | ✅ |
| Depth model (MiDaS v2.1 small) and onnxruntime | MIT | ✅ |
| Built-in music | Original, company-owned (Stage 10) | ✅ Uploads require confirmation that the person is authorised to use them, which is logged |
| H.264 / AAC encoding | Patent pools | ⚠ Legal review (unchanged from `docs/LICENSES.md`): usually covered for internal use. HEVC isn't used. |
| MuAPI, Claude | Provider terms | ⚠ Accept each provider's terms before switching it on (LICENSES.md §4) |
| AI-altered property imagery | MLS and advertising rules | ⚠ Legal review (LICENSES.md §4). AI clips are reviewed and labelled; generative clips are off by default. |

## 7. What changed this stage

**Functional fixes:**
- HEIC uploads are refused with instructions. The renderer (Chrome) and the server's FFmpeg can't decode them, so such videos used to fail. iPhones send JPG automatically because the upload no longer asks for HEIC.
- Render-failure messages are now in plain language for agents. The technical detail stays for administrators.

**Usability:**
- Easy Mode shows a shorter menu: Camera Studio moves to Advanced Mode, and it is still reachable from inside the editor.
- The unbuilt AI Effects page is no longer in the menu.
- The Download button is larger ("Download MP4").
- The iPhone tip appears on the upload screens.
- The Continue page for emailed links.
- The current password is asked only when needed.

**Video quality:**

| Check | Before | After |
|---|---|---|
| Loudness | Varied from **-25 to -16 LUFS** between videos (Easy Mode video too quiet on phones) | **Normalised to -14 LUFS** (true peak ≤ -1.5 dBFS). Two passes with one constant gain, so the balance between narration and music, fades and ducking are unchanged. The video stream is copied untouched (verified bit-for-bit). |
| Codec | H.264 High, yuv420p, 30 fps, AAC 48 kHz, `+faststart` (moov before mdat) | Unchanged: plays on iPhone, Android, Chrome, Safari, Instagram, Facebook and MLS sites |
| Photo quality | Originals up to 50 MB | Scaled to at most 4096 px (2× headroom over 1920 px video, enough for camera zoom), JPEG quality 0.92, orientation applied |
| Aspect ratios | 9:16 1080×1920, 16:9 1920×1080, 1:1 1080×1080, 4:5 1080×1350 | Unchanged |
| Camera motion | The preview matches the export; still scenes hold steady | Unchanged |
| Narration sync | Mean 0.063 s | Mean 0.064 s after normalisation (35/35 words) |

**Performance:**
- Photos are scaled down in the browser before upload: faster uploads, less storage, faster renders.
- 960 px preview images, which the editor uses on phones and small tablets. This avoids decoding 20+ megapixel originals at every scene change, the main cause of mobile memory trouble. Desktop previews still use the originals.
- 13 new database indexes for the queries run most: per-person monthly limit counts on every request, a video's renders, listing pages, the activity feed, and the storage policy check behind every library download.

**Operations:**
- `/healthz` uptime check.
- Structured server-error logging (`lvs.error`) and optional webhook alerts (`instrumentation.ts`).
- Worker heartbeats (Stage 13).
- Storage backup script (`scripts/backup-storage.mjs`).
- Migration: `supabase/migrations/20261114000100_production_hardening.sql`.

## 8. Deployment instructions

See **`docs/DEPLOYMENT.md`**. In short:
1. Supabase (Pro): `supabase db push`, turn sign-ups **off**, set up SMTP and the email templates.
2. Web app on a Node 20 server with FFmpeg: `npm ci`, then `npm run fetch-models -w @lvs/voice`, `npm run build` and `npm start` behind HTTPS.
3. One or more render workers (FFmpeg and Chrome, as a non-root user), and one AI worker.
4. Secrets in the host's secret store: service-role key, `LVS_SECRETS_KEY` (the same on web and AI worker, backed up), `NEXT_PUBLIC_SITE_URL`.
5. Monitoring: `/healthz`, `LVS_ERROR_WEBHOOK_URL`, Admin → System health.
6. Backups: Supabase PITR, plus a nightly `scripts/backup-storage.mjs`, because Supabase backups don't include files. Test a restore every quarter.
7. First administrator: `npm run bootstrap:token` → `/setup`.
8. Work through the go-live checklist (§11).

## 9. Maintenance guide

See **`docs/MAINTENANCE.md`**:
- daily, weekly, monthly and quarterly checks;
- how to update safely (migrations first);
- a table of common problems and fixes;
- where the logs are;
- capacity planning;
- what to do if a key leaks.

**Recommended next maintenance task:** upgrade to Next 16 and zod 4 to clear the two accepted dependency advisories (5.12), then run the full test suite.
