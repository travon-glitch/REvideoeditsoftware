# Stage 9 — Automatic AI Video Director (Claude)

An agent uploads the listing photos, presses **Create My Video Automatically**, and Claude plans a
professional marketing video; the real render starts immediately. The plan can be inspected and edited.

**Where:** Create Video, step 1 ("Let the AI Director make it", with the six styles), and the
**Create My Video Automatically** button on a listing. Shown only when the Super Admin has switched the
AI Director on and the person has AI access. The rule-based storyboard (Stage 6) stays available
as "quick rule-based storyboard (no AI)".

## Styles
Luxury · Modern · Cinematic · Social Media (9:16) · Open House (1:1) · Professional Listing Tour.
Each has a shape, a length range and a short creative brief given to Claude.

## How it works
1. **Photo interpretation (Claude call 1).** Every photo is sent as an image (the 480-px preview),
   labelled P01…P20. Claude returns JSON, per photo: room type (exterior, living room, kitchen, bedroom,
   bathroom, dining area, basement, backyard, garage, pool, patio, other), a description of what is
   visible, visible features, quality and opening-shot scores, and a suggested camera move.
2. **Storyboard (Claude call 2).** Verified listing facts + the photo analysis + the style → JSON:
   opening photo, scene order, duration, camera move and intensity, transitions, text overlays (each
   declaring which listing facts it uses), music mood, ending call to action, listing highlights and
   marketing captions (Instagram, Facebook, short).
3. **Compile and verify (deterministic, `src/lib/director/compile.ts`).** Unknown or repeated photo
   references are dropped; the opener is put first; durations are clamped; moves that need AI video
   (orbit, arc, parallax, drone) become the closest honest Standard move; **every text, highlight, CTA
   and caption is fact-checked** (`facts.ts`): numbers must be in the listing, amenity words (pool,
   garage, fireplace, renovated, views, …) must be in the listing's own text or be a room type the
   photos show, and fair-housing problem phrases are removed. Everything removed or changed is listed
   on the review page. The result is the editor's own plan, validated by its schema and by FableCut.
4. **Project + real render.** A normal video project is created and its 1080p render is queued.

Both calls use the official Anthropic TypeScript SDK with **structured outputs** (the API enforces the
JSON schema; Zod validates again), streaming, adaptive thinking (effort medium for photos, high for
the storyboard), prompt caching of the system prompt, and **server-side refusal fallbacks**
(`fallbacks: "default"`) on models that support them. Listing text and photos are treated as data, not
instructions. Refusals, cut-offs and invalid JSON become friendly errors.

**Review page** (`/director/<run>`): the render (progress, player, download), "What we checked and
corrected", the storyboard (photo, length, camera move, transition, reason, text per scene), music mood,
call to action, highlights, captions, and what Claude saw in each photo — plus **Inspect or edit the
storyboard** (opens the editor).

## Super Admin settings (Admin Panel → System settings → AI Director)
- **Claude API key** — stored **encrypted** (AES-256-GCM, server key `LVS_SECRETS_KEY`) in
  `organization_secrets`, which no person can read through the API (only the server); the page shows
  the last 4 characters; replace, remove, **Test connection** (free Models API call). Or set
  `ANTHROPIC_API_KEY` on the server.
- **Model** — Claude Opus 5.5 (default), Sonnet 5.5, Haiku 5.5, Fable 5.1, with list prices.
- **Usage limits** — on/off, runs per month (company), runs per person per day; Claude costs count
  toward the **AI spending ceiling**.
- **Cost tracking** — every run stores token usage and cost (computed from the model's list price,
  including cache reads/writes); the page shows this month's runs, failures, tokens and cost, per person,
  and recent runs.

Enforced in the database: `start_director_run()` (Director on, AI access, edit access to the listing,
limits, spending ceiling); runs are finished (usage/cost) only by the server; settings only by the
Super Admin; the key table is closed to everyone but the server.

## Tests
| Test | Result |
|---|---|
| `src/lib/__tests__/director.test.ts` | verified facts; claim checker (invented numbers, amenities, fair housing); compiler (refs, opener, clamping, AI-move swap, text removal, valid FableCut document); request shape (20 labelled images, JSON schema, adaptive thinking, fallbacks); usage + cost; refusal / bad JSON |
| `src/lib/__tests__/secrets.test.ts` | encryption round trip, tamper detection, needs the server key |
| `tests/db/director.test.ts` | key unreadable by everyone incl. Super Admin; Super-Admin-only settings; run permissions; daily/monthly limits; spending ceiling; costs written only by the server |
| **`tests/render/director.acceptance.test.ts`** | 20 photos + verified details → storyboard → valid image references and instructions → **real render** (1920×1080, H.264, matches the planned photo order, plays in Chrome) |

**Live vs simulated:** this build environment has no Claude API key, so the acceptance run used a
**simulated Claude response** (labelled as such in the test name and output; it deliberately includes
invented claims, which were removed). With a key, the same test calls the real API:

```bash
ANTHROPIC_API_KEY=sk-ant-... LVS_RENDER_TESTS=1 npx vitest run tests/render/director.acceptance.test.ts
```

## Database — `20261109000100_ai_director.sql`
Claude settings on `organization_settings`, `organization_secrets`, `claude_key_status()`,
`director_available()`, `director_runs`, `start_director_run()`, `ai_spent_this_month()`, and the AI
spending ceiling now including Director costs.
