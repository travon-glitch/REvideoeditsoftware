# Architecture

**Status:** Proposed (Stage 1). Nothing is implemented yet.

## 1. Principles

1. **Don't merge the two upstream apps.** Each is a single-user tool with its own assumptions. We build one secure Platform and plug in the parts that are good.
2. **FableCut owns the timeline format, the editor and the renderer.** Its `project.json` is our canonical "video document".
3. **AI generation is a backend service behind provider adapters.** Open-Generative-AI contributes UX patterns and small amounts of ported code, not its runtime.
4. **Every tenant boundary is enforced server-side.** Upstream code runs either in the user's browser (on an isolated origin) or inside sandboxed workers that only see one project's data.
5. **No secrets in the browser.** Provider keys live in the server's secret store; the browser only ever holds a short-lived session.

## 2. System overview

```
                         ┌────────────────────────────────────────────────┐
 Browser                 │  app.<company>.com  (Platform UI, Next.js)       │
                         │  • login (OIDC/SSO), listings, projects, admin    │
                         │  • AI Studio (camera-move picker, model forms)    │
                         │  • <iframe sandbox> ─────────────┐               │
                         └──────────────────────────────────│───────────────┘
                                                            │ postMessage (projectId, short-lived editor token)
                         ┌──────────────────────────────────▼───────────────┐
                         │  editor.<company>-usercontent.com                  │
                         │  FableCut UI (vendored app.js/index.html/…)        │
                         │  calls /api/* → Editor Gateway (token-scoped)      │
                         └──────────────────────────────────┬───────────────┘
                                                            │
 Server ────────────────────────────────────────────────────▼──────────────────────────
  ┌──────────────────┐   ┌───────────────────────────┐   ┌──────────────────────────┐
  │ Platform API      │   │ Editor Gateway             │   │ Webhook receiver          │
  │ (Next.js route    │   │ FableCut-compatible REST   │   │ (AI provider callbacks,   │
  │  handlers / tRPC) │   │ + SSE, scoped to 1 project │   │  HMAC-verified)           │
  └───────┬──────────┘   └───────────┬───────────────┘   └───────────┬──────────────┘
          │                          │                               │
          ▼                          ▼                               ▼
  ┌──────────────┐  ┌─────────────────────┐  ┌───────────────────────────────────────┐
  │ PostgreSQL    │  │ Object storage (S3)  │  │ Queue (Redis/BullMQ or SQS)            │
  │ users, orgs,  │  │ originals, derived,  │  │  gen.*   render.*   media.*            │
  │ listings,     │  │ AI outputs, exports  │  └───────┬──────────────┬───────────┬────┘
  │ projects,     │  │ (per-org prefixes,   │          ▼              ▼           ▼
  │ revisions,    │  │  signed URLs only)   │  ┌─────────────┐ ┌────────────┐ ┌──────────────┐
  │ jobs, audit   │  └─────────────────────┘  │ Gen worker   │ │ Render     │ │ Media worker  │
  └──────────────┘                            │ provider     │ │ worker     │ │ ffprobe,      │
                                              │ adapters     │ │ headless   │ │ proxies,      │
                                              │ (no inbound) │ │ Chromium + │ │ thumbnails,   │
                                              └──────┬──────┘ │ FableCut + │ │ AV scan       │
                                                     │        │ ffmpeg     │ └──────────────┘
                                                     ▼        └────────────┘
                                          External AI APIs / self-hosted GPU
```

## 3. Components

### 3.1 Platform (Build) — `apps/platform`
- **Next.js (App Router), TypeScript.** Server components + route handlers.
- **Auth:** OIDC (company IdP: Google Workspace / Entra ID / Okta) via Auth.js or equivalent; MFA delegated to IdP; session cookies `HttpOnly; Secure; SameSite=Lax`.
- **RBAC:** `org_admin`, `producer` (create/edit/render), `reviewer` (comment/approve), `viewer`. Policy checks in one module (`packages/authz`) used by every route and worker.
- **Domain:** organisations → listings → projects (each project = one FableCut document with N sequences, e.g. 16:9 + 9:16) → revisions → renders; assets; generation jobs; brand kits; templates.
- **Admin:** user management, model allowlist & per-org quotas, usage/cost dashboard, audit log viewer, template management.

### 3.2 Editor (Reuse, patched) — `packages/fablecut-core` + `apps/editor-host`
- Vendored FableCut @ `579b08e` with a patch series (see `IMPLEMENTATION_PLAN.md`). Frontend files (`index.html`, `app.js`, `style.css`, worklets, workers, UMD modules) are served as static assets from a **separate registrable domain** (`*-usercontent.com`) so any XSS in the large editor bundle cannot read Platform cookies.
- Embedded in the Platform via `<iframe sandbox="allow-scripts allow-same-origin allow-downloads">`; the parent passes `{projectId, editorToken}` with `postMessage` (origin-checked both ways). The token is a short-lived (≤15 min, refreshable) JWT bound to user, org, project and permission set.
- Upstream `server.js` is **not deployed**. Its role is taken by the Editor Gateway.

### 3.3 Editor Gateway (Build, contract from FableCut) — `services/editor-gateway`
Implements the subset of FableCut's REST/SSE contract the UI needs, but tenant-scoped:

| FableCut route | Gateway behaviour |
|---|---|
| `GET/PUT /api/project` | Load/save the project's current revision from Postgres (JSONB) with the same **409-on-stale-revision** semantics; schema-validate on write; append to revision history. |
| `GET /api/events` (SSE) | Per-project channel (Redis pub/sub): `change`, `proxy`, `export`, `transcript`. |
| `POST /api/upload`, `/api/import-url` | Replaced by presigned S3 upload + `media.ingest` job (size caps, magic-byte check, AV scan, ffprobe in sandbox). SVG only via sanitiser or rasterised. |
| `GET /media/*`, `/library/*`, `/proxies/*` | 302 → short-lived signed URL (same-site CDN with CORS so the canvas isn't tainted). |
| `/api/media-info`, `/api/proxy*`, `/api/frame` (src only) | Served from media-worker outputs. **`?path=` removed.** |
| `/api/export/*`, `/api/export/request` | Enqueue `render.*` job; progress via SSE. |
| `/api/projects`, `/api/versions` | Mapped to Platform projects/revisions (authorised). |
| `/api/transcribe`, `/api/denoise`, `/api/analyze`, `/api/scopes` | Phase-gated; enqueue jobs or disable in UI. |

The gateway is the only thing the editor can talk to. It never accepts a filesystem path from a client.

### 3.4 Timeline service (Reuse) — `packages/timeline`
- Runs FableCut's UMD modules in Node: `edit-ops.js`, `project-ops.js`, `templates.js`, `motion.js`, `comp.js`, `delivery.js`.
- Adds: **formal Zod/JSON-Schema** for `project.json` (from CLAUDE.md §schema), migrations, and the **Listing Video Composer**:
  `ListingInput + BrandKit + TemplateId + [AI clips] → project.json` (photo order, Ken-Burns keyframe presets, transitions on beat markers, title cards for price/address/specs, agent outro, music bed with auto-duck under voice-over, 16:9 and 9:16 sequences).

### 3.5 AI generation (Build, patterns from Open-Generative-AI) — `packages/ai-providers` + `services/gen-worker`
```ts
interface VideoProvider {
  id: string;                               // "fal:wan-2.x-i2v", "runway:gen-x", "local:wan"
  capabilities: ("t2v"|"i2v"|"start_end"|"i2i"|"tts")[];
  inputSchema: ModelInputSchema;            // same shape idea as OGAI models.js `inputs`
  estimateCost(input): Money;
  submit(input, ctx): Promise<{ providerJobId: string }>;
  poll(providerJobId): Promise<JobStatus>;  // fallback when no webhook
  parseWebhook(req): Promise<JobStatus>;    // HMAC/sig verified
  cancel?(providerJobId): Promise<void>;
}
```
- **Camera Move library** (adapted from OGAI `promptUtils.js` tables, extended): `push_in`, `pull_out`, `orbit_left/right`, `crane_up`, `drone_reveal`, `walkthrough`, `parallax_pan` — each maps to (a) provider-native camera params where supported, else (b) a compiled prompt fragment, and (c) a 2D Ken-Burns fallback in FableCut when AI is disabled or fails.
- Flow: UI → Platform API creates `generation_job` (status `queued`, cost estimate, quota check) → gen-worker submits → webhook/poll → output copied **into our bucket** (never hot-link provider URLs) → media-worker probes → clip inserted into project via `edit-ops` → SSE `change`.
- Guardrails: model allowlist per org, prompt policy (no structural changes to property, no people/likeness without consent), output disclosure flag, full prompt/output audit record.

### 3.6 Render workers (Reuse pattern) — `services/render-worker`
- Container: Node + pinned Chromium + native **LGPL** ffmpeg build + the vendored FableCut UI.
- Per job: fetch project revision + signed media URLs → start an **ephemeral local gateway stub** bound to 127.0.0.1 inside the container → headless Chromium runs FableCut Fast export (WebCodecs decode, canvas compositor) → frames + WAV to ffmpeg → MP4 → upload to S3 → mark render done.
- Isolation: one job per container, no inbound network, egress only to object storage, CPU/mem/time limits, seccomp, read-only rootfs. Horizontal scale = more workers (removes FableCut's one-export-at-a-time limit).

### 3.7 Media worker — `services/media-worker`
ffprobe, thumbnails, proxies (FableCut `proxy.js` logic), EXIF strip/orientation, AV scan (ClamAV), image normalisation (HEIC→JPEG), SVG sanitisation. Sandboxed like render workers.

### 3.8 ffmpeg.wasm
Not in v1. Revisit only for client-side pre-upload trimming, with a custom LGPL core.

## 4. Data model (initial)

```
organizations(id, name, settings, quota)
users(id, org_id, email, role, idp_subject, disabled_at)
brand_kits(id, org_id, logo_asset_id, colors, fonts, outro_template)
listings(id, org_id, address, price, beds, baths, sqft, description, mls_id, created_by)
assets(id, org_id, listing_id?, kind, storage_key, sha256, mime, bytes, probe JSONB, source: upload|ai|render, derived_from?)
projects(id, org_id, listing_id?, name, current_revision, template_id, created_by)
project_revisions(project_id, revision, document JSONB, author_id, created_at, note)  -- FableCut project.json
generation_jobs(id, org_id, project_id?, user_id, provider, model, input JSONB, status, cost_estimate, cost_actual, provider_job_id, output_asset_id?, error, timestamps)
render_jobs(id, project_id, revision, preset, status, progress, output_asset_id?, error, timestamps)
templates(id, org_id?, name, kind, document JSONB, version)
audit_events(id, org_id, actor_id, action, target, metadata JSONB, ip, at)
```
Tenant isolation: every row has `org_id`; enforced in the data-access layer **and** with Postgres Row-Level Security as defence in depth.

## 5. Security architecture

| Threat | Control |
|---|---|
| Cross-tenant access (FableCut F1/F2) | Gateway + RLS; editor token bound to one project; workers get only that project's signed URLs. |
| Arbitrary file read (F3) | `?path=` removed in patch; workers have no access to host FS beyond tmp. |
| XSS in editor / SVG (F5) | Separate usercontent domain, strict CSP, SVG sanitiser or rasterise, `Content-Disposition` for downloads. |
| Upload DoS (F4) | Direct-to-S3 presigned uploads with size caps; gateway body limits (e.g. 2 MB JSON). |
| Malicious media → ffmpeg/Chromium exploits (F6/F9) | Ephemeral sandboxed containers, no network, resource limits, patched binaries. |
| SSRF (G1, import-url) | No open proxies; URL imports via media worker with FableCut's allow/deny logic + egress firewall. |
| Secret leakage (G2/G3) | Provider keys only in server secret manager; per-org quotas; no client keys. |
| Supply chain (F8) | Self-host CDN assets with SRI; lockfiles; Renovate; SBOM; licence gate. |
| AI abuse / misrepresentation | Model allowlist, prompt policy, disclosure flag, audit log, human approval before publish. |
| Webhook spoofing | HMAC signature verification, idempotency keys, replay window. |

## 6. Recommended repository layout

```
/ (monorepo, pnpm workspaces + Turborepo)
├─ apps/
│  ├─ platform/              # Next.js: auth, listings, projects, AI studio, admin
│  └─ editor-host/           # static build of vendored FableCut UI for the usercontent origin
├─ services/
│  ├─ editor-gateway/        # FableCut-compatible, tenant-scoped REST + SSE
│  ├─ gen-worker/            # AI generation queue consumer
│  ├─ render-worker/         # headless Chromium + ffmpeg render jobs (Dockerfile)
│  ├─ media-worker/          # probe, proxies, thumbnails, AV scan, sanitise
│  └─ webhooks/              # provider callbacks (may live in platform)
├─ packages/
│  ├─ fablecut-core/         # vendored FableCut @579b08e + patches/ + UPSTREAM.md + LICENSE
│  ├─ timeline/              # schema, migrations, Listing Video Composer (uses fablecut-core ops)
│  ├─ ai-providers/          # provider interface, adapters, model registry, camera-move library
│  ├─ authz/                 # RBAC policies shared by all services
│  ├─ db/                    # schema + migrations (Drizzle/Prisma), RLS policies
│  ├─ storage/               # S3 client, signed URLs, key layout
│  ├─ queue/                 # job definitions & typed payloads
│  └─ ui/                    # shared React components (pickers, model form renderer)
├─ templates/                # our listing-video templates (JSON) + brand presets
├─ infra/                    # docker-compose (dev), IaC (prod), CSP/headers config
├─ docs/                     # this documentation
├─ reference/                # upstream clones — git-ignored, read-only
├─ THIRD_PARTY_NOTICES.md
└─ .github/workflows/        # CI: lint, typecheck, tests, licence gate, SBOM, container scan
```

## 7. Key trade-offs

| Decision | Alternative considered | Why |
|---|---|---|
| Replace `server.js` with a gateway | Run one FableCut container per user session | Per-session containers are quicker to stand up and are a viable **interim** (Phase 2 fallback) but are costly, slow to start, and still keep data on local disk. Gateway gives real multi-tenancy and DB-backed revisions. |
| Keep FableCut's browser compositor for rendering | Re-implement rendering in ffmpeg filtergraphs / Remotion | Preview and export would diverge; FableCut's single code path is its main strength. Remotion also has a non-OSI company licence. |
| Iframe on separate domain | Port FableCut UI into React | `app.js` is 20 k lines of DOM code; porting = rewrite. Isolation also contains its risk. |
| Own provider adapters | Keep Muapi | Lock-in, browser-held keys, unclear rights chain, no quotas/audit. |
| No ffmpeg.wasm | Use it for client transcodes | GPL core, slow, not needed given WebCodecs + server ffmpeg. |
