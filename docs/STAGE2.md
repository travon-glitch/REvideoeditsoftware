# Stage 2 — Private company software foundation

**Status:** complete (2026-11-02). Stopped before Stage 3 (editor integration) as instructed.

## What was built

### Application (`apps/web`) — Next.js 15.5 · TypeScript (strict) · Tailwind 3.4 · shadcn/ui · Supabase

| Area | Delivered |
|---|---|
| Navigation | Dashboard · Create Video · My Listings · My Videos · Templates · Camera Studio · AI Effects · Admin Panel (admins only). Role-filtered; mobile drawer menu. |
| Primary action | **Create New Video** — brand-colored, in the sidebar, the top bar on every page, and the dashboard hero. |
| Easy / Advanced mode | Easy by default, saved per person. Advanced reveals extra fields (ZIP, MLS #, extra video shapes, video name, secondary brand colors, lens/focal/aperture controls and the AI prompt in Camera Studio). |
| Sign-in | Email + password, password reset, invitation links (`/auth/confirm`), POST-only sign-out with origin check. No sign-up anywhere. |
| Protected routes | Middleware redirects every non-public path to `/login`; layouts re-check for an **active** profile (`/no-access` otherwise); `/admin/*` re-checks the role server-side; every server action re-authorizes. |
| One-time Super Admin | `npm run bootstrap:token` → single-use 150-bit code (hash only stored, 60-min expiry) → `/setup` → person chooses their own password → company, Super Admin and brand kit created atomically → setup closed forever. |
| Organization-owned data | Every row carries `organization_id`; profiles belong to one company; RLS isolates companies. |
| Profiles & roles | Viewer < Creator < Administrator < Super Admin. Role/access changes only through `admin_update_member()` (no direct UPDATE on `role`). Admins manage creators/viewers; only the Super Admin manages administrators; nobody can grant Super Admin. |
| Branding framework | Shared brand kit: logo (private storage), 3 colors, 2 fonts, tagline, closing message, legal text. The main color re-themes the app (`--brand`) and feeds the video title cards. |
| Listings | Add/edit/delete, "Mine / Whole company" views, direct-to-storage photo upload (random object names under `<org>/listings/<listing>/`, server verifies path + existence before registering). |
| Create Video | 3 steps (home → style → where you'll post). Builds a **starter FableCut project document** (one Ken-Burns-moved scene per photo, address/price/specs cards, branded outro), validated by FableCut's own `checkProject`, saved with revision history. |
| My Videos / Templates | Lists and detail view (scenes, camera move, length, on-screen text). 5 original built-in templates. |
| Camera Studio | Live preview of 8 camera moves (4 free Ken Burns, 4 AI), plain-language descriptions; Advanced shows lens tables from Open-Generative-AI and the exact AI prompt (always with a "keep the property as photographed" guardrail). AI execution is not wired yet. |
| AI Effects | Planned effects shown, clearly disabled until an AI service is approved; disclosure labels defined. |
| Admin Panel | Overview, Team (invite / role / access), Branding (logo + kit), Activity log. |
| Error & loading | Root, app-level and global error pages; 404; "no permission"; "account not active"; skeleton loading state. |

### Database (`supabase/migrations/20261102000100_foundation.sql`)

Tables: organizations, profiles, brand_kits, listings, media_assets, video_templates, video_projects,
project_revisions, generation_jobs, render_jobs, audit_log (+ private bootstrap tables). RLS on all of them;
anon has no table privileges; helper functions live in a non-exposed `private` schema. Storage buckets are private and
scoped to `<organization_id>/…`; exports are writable by workers only. Jobs tables are ready for Stage 3–5 workers:
users may only *queue* jobs, never write results.

### Preserved upstream code

| Upstream | Where | How it is used now |
|---|---|---|
| FableCut @ `579b08e` (MIT) | `packages/fablecut-core/upstream/` — 179 files, unmodified | `ProjectOps.checkProject` validates every starter document; schema used for documents. Server/MCP not loaded (wrapper refuses). |
| Open-Generative-AI @ `84b29a5` (MIT) `src/lib/promptUtils.js` | `packages/camera-presets/upstream/` — unmodified | Camera/lens/focal/aperture tables and prompt builder re-exported; extended with real-estate moves + Ken Burns fallback keyframes. |

## Security controls

- Strict per-request CSP with nonces (`'strict-dynamic'`, no `unsafe-inline` scripts, `frame-ancestors 'none'`), HSTS,
  `X-Frame-Options: DENY`, `nosniff`, restrictive `Permissions-Policy`, `noindex`.
- Session validated with `auth.getUser()` (not `getSession()`); open-redirect-safe `next` handling.
- Service-role key only in `server-only` modules, used for invites and setup after authorization checks.
- Login errors don't reveal whether an account exists; password reset answers the same either way.
- Uploads: type/size allow-list (no SVG), random names, path re-verified on the server, existence check.
- Audit log written by triggers / security-definer code; users cannot insert or edit it.

## Verification (run in this environment)

| Check | Result |
|---|---|
| `npm run typecheck` (web + camera-presets) | ✅ 0 errors |
| `npm test` — web (Vitest) | ✅ 67 tests: roles/nav 8, security 18, bootstrap 5, storage 4, validation 7, starter document 4, **database 21** |
| `npm test` — camera-presets | ✅ 6 tests |
| `npm test` — fablecut-core wrapper | ✅ 4 tests |
| `next build` (production) | ✅ compiles, all app routes dynamic |
| Production smoke test | ✅ protected routes → `/login`; cross-origin sign-out → 403; headers present; every script carries the CSP nonce; no browser console errors on public pages |

Database tests run the real migration on PGlite (embedded Postgres 17) with stand-ins for Supabase's `auth` and
`storage` schemas, simulating PostgREST (`SET ROLE authenticated` + JWT `sub`). They cover cross-company isolation,
role limits, self-escalation, deactivated users, anonymous access, audit visibility, job-result forgery, storage
folder scoping, and the full bootstrap lifecycle (wrong / expired / reused codes, closing setup).

Screenshots of the public pages: `docs/screenshots/`.

## Not verified here (needs a real Supabase project)

- End-to-end sign-in, invitation emails, password reset emails, signed URLs and uploads against hosted Supabase Auth
  and Storage (no Supabase project or Docker daemon was available). Signed-in screens were type-checked and built but
  not rendered in a browser.
- Upstream FableCut's own 50-file test suite (only our wrapper tests ran).
- No lint step yet (ESLint not installed); planned with CI in Phase 0.

## Known gaps / next stage

- Stage 3: serve the FableCut editor from an isolated origin + tenant-scoped Editor Gateway (patches P01–P07).
- Photo re-ordering and room labels in the UI (columns exist).
- Company template management UI (RLS + table ready).
- Full OFL texts in `THIRD_PARTY_NOTICES.md` before the editor serves fonts.
- Rate limiting beyond Supabase Auth's built-in limits; CI pipeline, SBOM and license gate.
