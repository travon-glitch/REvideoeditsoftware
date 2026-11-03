# Stage 11 — Real-estate templates and brand kit

Fifteen working property-video templates. Each one has its own:
- scene structure;
- camera moves;
- transitions;
- typography;
- text animations;
- intro and outro.

They are filled in automatically from the listing, the company brand kit and the listing's assigned agent. Every template produces a real FableCut document and a real MP4. None of them is a mock-up.

**Where:**
- **Templates** in the sidebar (`/templates`), or the **Use a Template** button on a listing.
- Admin Panel → **Brand kit** (Super Admin only).
- Admin Panel → **Templates**.
- Admin Panel → **Agent profiles**.

## The fifteen templates (`apps/web/src/lib/video/templates.ts`)
| # | Template | Shape · length | Scene structure | Transition | Typography and look | Intro / outro |
|---|---|---|---|---|---|---|
| 1 | Just Listed | Vertical · ~30 s | main photo, 2.6 s scenes, push in/pan right/zoom/pan left (normal) | zoom | Montserrat / Inter; rise-mask, zoom-in, caps | bar-wipe / brand kit |
| 2 | Luxury Listing | Wide · ~45 s | widest photo, 4.5 s scenes, push in/pan right/pull out/pan left (gentle) | fade | Playfair Display / Lato; clip-reveal, caps; cinematic look | logo-reveal / brand kit |
| 3 | Modern Home | Wide · ~30 s | main photo, 2.4 s scenes, truck right/push in/truck left/zoom | slide | Poppins / DM Sans; word-pop | bar-wipe / brand kit |
| 4 | Open House | Square · ~30 s | main photo, 3 s scenes, push in/pan left/pull out/pan right | fade | Montserrat / Inter; rise-mask, caps | title card / brand kit |
| 5 | Price Reduced | Vertical · ~20 s | main photo, 2.2 s scenes, zoom/pan right/push in | whip | Oswald / Roboto; zoom-in, caps | none / brand kit |
| 6 | Coming Soon | Vertical · ~15 s | main photo, 2 s scenes, push in/tilt up/pull out | fade | Bebas Neue / Inter; letter-pop, caps; dreamy look | title card / brand kit |
| 7 | Just Sold | Vertical · ~15 s | main photo, 2 s scenes, push in/pan left/zoom | zoom | Anton / Inter; zoom-in, caps | title card / agent card |
| 8 | Property Highlights | Wide · ~40 s | main photo, 3.2 s scenes, one numbered fact per scene | wipe | Montserrat / Inter; rise-mask | brand kit / brand kit |
| 9 | Investment Property | Wide · ~30 s | main photo, 2.8 s scenes, pan right/push in/truck left | wipe | Barlow / Inter; clip-reveal, caps | brand kit / brand kit |
| 10 | Rental Property | Vertical · ~25 s | main photo, 2.5 s scenes, push in/pan right/pan left | slide | Rubik / Inter; word-pop, zoom-in | bar-wipe / brand kit |
| 11 | Waterfront Home | Wide · ~40 s | widest photo, 3.8 s scenes, pan right/pull out/pan left/push in (gentle) | fade | Playfair Display / Lato; clip-reveal; cold look | logo-reveal / brand kit |
| 12 | New Construction | Wide · ~35 s | main photo, 3 s scenes, tilt up/push in/truck right/pull out | wipe | Archivo Black / Inter; clip-reveal, caps; pop look | bar-wipe / brand kit |
| 13 | Twilight Tour | Wide · ~30 s | last photo, 3.5 s scenes, push in/pan left/pull out (gentle) | fade | Abril Fatface / Lato; clip-reveal; sunset colour look | logo-reveal / brand kit |
| 14 | Agent Introduction | Vertical · ~20 s | "Presented by …", 2.6 s scenes, long agent-card ending | fade | Montserrat / Inter; rise-mask | title card / agent card |
| 15 | Cinematic Property Reveal | Wide · ~45 s | widest photo, 4 s scenes, pull out/pan right/push in/tilt up (dramatic) | fade | Bebas Neue / Barlow; clip-reveal, caps; cinematic look; cinema bars | logo-reveal / brand kit |

**What every template has:**
- Each template is data: a `TemplateSpec`, validated with Zod. It holds:
  - the scene structure: hero, middle and end lengths, the number of scenes, and the opening photo;
  - Standard (2D) camera moves only, so no template needs AI to render;
  - the transition;
  - fonts (the fonts bundled with the renderer only, so rendering never needs the network) and text animations;
  - capital letters, letter spacing, colours, a photo look and optional cinema bars;
  - the badge, headline and call to action;
  - "beats": which listing fact appears on which scene, where, and when;
  - intro and outro, agent card, corner logo and music mood.
- `buildTemplatePlan()` turns template + listing + photos + brand kit + agent into the editor's own plan. That means a template video can be edited in Easy Mode or Advanced Mode like any other video.
- **Animated branding layers** (`brand-layers.ts`) are ordinary FableCut shape, image and text clips with keyframes:
  - **Intros:**
    - logo reveal: a brand panel holds the logo, then lifts away;
    - bar wipe: a brand-colour bar sweeps across with the title;
    - title card: a full card with a drawn-on line.
  - **Outros:**
    - agent card: the round headshot with a ring, the agent's details appearing one after another, and the brokerage logo;
    - logo end card;
    - contact bar.
  - **Disclosure:** a small strip on the last scene.
  - The texts on the first scene wait until the intro has finished, and texts on the last scene end before the outro starts.
- **Facts rule:**
  - Everything about the property comes from the listing.
  - Some template words make a claim: waterfront, new construction, price reduced, sold, coming soon, for rent, and open house. If the listing doesn't back the claim up, a **warning** is shown on the video page.
  - Price Reduced shows "Was $X" only when the listing has a saved previous price.
  - Open House without a date says "Ask us for a showing". The video never invents a date.
- **Recommendation**, in this order:
  1. the company's default template for that listing status;
  2. otherwise the listing's status: sold, coming soon, for rent, or an open house;
  3. a lower price than before;
  4. the water, or new construction, mentioned in the listing;
  5. a luxury price;
  6. a multi-family or commercial property;
  7. a new listing (Just Listed);
  8. otherwise Property Highlights.

## Template selection (`/templates`)
1. Pick the listing. The page shows who will appear as the agent.
2. Each template card shows:
   - a large thumbnail;
   - **Preview**, which plays a real render of the template;
   - the name;
   - recommended usage;
   - shape, length and font;
   - a **Select** button.
3. The recommended template is listed first and marked.
4. Press **Select**. The video is created from the listing, brand kit and agent, its render starts, and the video page opens with progress and download. Any warnings are listed there.

## Company brand kit (Super Admin only — enforced by the database)
The brand kit holds:
- **Logos:**
  - company logo, used by the intro and outro and in the corner;
  - brokerage logo, used on the agent card.
  - Both are registered with their real pixel size, read from the file.
- Company name, tagline, brokerage name and brokerage licence.
- **Brand colours:** main, panel and highlight.
- **Default fonts:** title and text, chosen from the bundled fonts.
- **Intro animation**, **outro animation** and **agent contact layout** (photo left, centred, or minimal).
- **Required brokerage disclosures:** the text, plus a "required on every video" switch. The database refuses "required" without text.
- **Default music preferences:**
  - mood;
  - default track (verified tracks only, checked by the database);
  - "let templates pick music";
  - volume.

## Agent profiles (Admin Panel → Agent profiles)
- Each profile holds:
  - name, title, phone, email, brokerage and licence;
  - a headshot, uploaded to `brand-assets/<org>/agents/` as its own `headshot` asset type, with its pixel size checked;
  - an optional linked person and an active switch.
- Administrators create, edit and remove profiles. A linked agent can update their own contact details, but not switch the profile off or link it to someone else.
- A listing's **"Agent on the videos"** field (listing form) assigns a profile.
- Videos fill the agent card automatically from the profile:
  - the brokerage falls back to the brand kit;
  - with no profile, the listing's typed agent details are used;
  - with no agent at all, the company end card is shown, with a warning.
- The listing form also has **Previous price**, which Price Reduced videos use.

## Administrator controls (Admin Panel → Templates)
- **Create templates:**
  - "Create from this" makes a draft copy of any template.
  - New templates always start as drafts; the database enforces this.
- **Edit templates:**
  - name, usage, badge, headline and call to action;
  - shape and length;
  - transition and camera feel;
  - fonts, title/banner/caption animations and photo look;
  - intro and outro;
  - music mood;
  - capital letters, cinema bars, agent card and corner logo.
  - Editing an **approved** template sends it back to draft (a database trigger), so changes are approved again.
- **Approve templates:**
  - The database records who approved it and when.
  - People who make videos only see approved templates (RLS).
- **Disable templates:**
  - A disabled template is hidden and its defaults are cleared.
  - Built-in templates can be disabled but not deleted.
- **Assign default templates:** per listing status (Coming Soon, For Sale, Open House, Pending, Sold, For Rent).
  - Only approved templates can be defaults.
  - There is one default per status, kept by `admin_set_template_default()`.
- **Enforce branding requirements:**
  - require the logo;
  - require the disclosure;
  - require the agent card;
  - lock fonts and lock colours to the brand kit.
  - These are applied to **every** video when it is saved or rendered (templates, Easy Mode and the editor), by `applyBrandRules()` in `savePlan()` and `queueRenders()`.
- Every change is written to the activity log.

## Renderer
The render worker now also accepts **shape** clips. These are vector panels, bars and rings: FableCut draws them and they use no files. It also accepts brand **headshot** assets of the same company.

## Database — `20261111000050_headshot_kind.sql`, `20261111000100_templates_brand_agents.sql`
- **brand_kits:** the brokerage fields, intro/outro, agent layout, disclosure-required and music columns, with checks.
  - Only the Super Admin can write the brand kit (policies).
- **organization_settings:** the branding rule columns.
  - `admin_set_brand_rules()` lets administrators change them.
  - `my_brand_rules()` lets everyone who makes videos read them.
- **agent_profiles:** the new table, with RLS and checks:
  - the linked person must be in the company;
  - the headshot must be one of the company's headshots;
  - agents can't change their own active switch or link.
- **listings:** `agent_profile_id` (must be an active agent of the company) and `previous_price`.
- **video_templates:** `status`, `builtin_key`, `usage`, `default_for` and approval stamps, plus the approval and default triggers.
- The old global style rows are retired. Each company has its own copies.

## Tests
- **Unit tests** (`src/lib/__tests__/templates.test.ts`), 22 tests:
  - every one of the 15 templates builds a valid plan that FableCut's own validator accepts;
  - each has scenes, camera, transitions, typography, an agent card and a disclosure;
  - all 15 differ from each other;
  - claims become warnings;
  - fallback when there is no agent;
  - administrator rules;
  - recommendation.
- **Database tests** (`tests/db/templates-brand.test.ts`), 12 tests:
  - brand kit only for the Super Admin;
  - disclosure and music checks;
  - branding rules;
  - agent profiles and self-edit limits;
  - listing agent assignment;
  - template drafts, approval stamps, re-approval after editing, defaults, disabling, deletion, and isolation between companies.
- **Every template renders** (`tests/render/templates.render.test.ts`): all 15 go through the real render worker and are checked for size, length, H.264 and a clean decode. Those renders are the gallery's thumbnails and previews (`apps/web/public/templates/`).
- **Acceptance** (`tests/render/templates.acceptance.test.ts`), run with:

  ```bash
  LVS_RENDER_TESTS=1 npx vitest run tests/render/templates.acceptance.test.ts
  ```

  Run it from `apps/web`. It covers:
  - **Set-up**, on the real database with RLS:
    - the Super Admin sets up the brand kit;
    - an administrator sets the rules and creates the agent profile with a headshot;
    - the server adds the templates;
    - the agent creates a listing with 20 photos and assigns their profile.
  - **Select the listing.** Just Listed is recommended.
  - **Apply Just Listed.** These are inserted automatically:
    - address, city, price and beds/baths/size;
    - JUST LISTED and the call to action;
    - the agent's name, title, phone, email, brokerage, licence and headshot;
    - the brokerage logo, company logo and disclosure.
  - **Render.** The project and render job are saved as the agent, and the real worker renders the video.
  - **Download.**
    - The agent can download it; a viewer who isn't on the listing can't.
    - The MP4 is 1080×1920, the planned length, H.264 + AAC music, and decodes cleanly.
    - It plays in Chrome.
    - Its frames show the intro bar, the banner, the agent card with the headshot, and the disclosure.

**Results (2026-11-03):**
- Acceptance: **7/7 passed.** The downloaded Just Listed video is 1080×1920, about 30 s, H.264 + AAC, and plays in Chrome. Screenshots:
  - `docs/screenshots/stage11-just-listed-frames.jpg`;
  - `stage11-agent-card-frame.jpg`.
- All 15 templates rendered: **15/15**.
- Unit and database tests: **222/222.** Camera engine: **21/21.**
- UI screenshots:
  - `docs/screenshots/stage11-template-gallery.png`;
  - `stage11-template-admin.png`;
  - `stage11-agent-profiles.png`.

**Not covered here:** the new pages were checked with sample data in a test page, not against a live Supabase project. The agent's own "edit my profile" page isn't built yet. The database already allows it, and administrators edit profiles from Agent profiles.
