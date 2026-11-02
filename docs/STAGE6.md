# Stage 6 — Easy Mode

Easy Mode is the default for every user. Advanced Mode (the Stage 5 editor) is optional,
and **both work on the same saved project** (`video_projects.edit_plan` + the FableCut document).

## The four-step wizard (`/create`)

| Step | What the person sees |
|---|---|
| 1. Upload photos | One large drag-and-drop area (or click to choose). Thumbnails are made automatically in the browser and stored privately next to each photo. Reorder by dragging or arrows — the first photo is the main photo. Property address box. |
| 2. Choose a style | Six visual cards — Luxury Cinematic, Modern, Just Listed, Open House, Social Media Reel, Property Highlights — each playing a **live sample made from the person's own photos**. The style suggested for this home is marked. |
| 3. Customize | Address, city, state, price and agent branding (pre-filled from the listing, the person's profile and the company brand kit; saved back to the listing), length (Short / Standard / Long), shape (Wide / Tall / Square), music (none / upload), show-contact-details toggle, AI effects toggle. |
| 4. Create video | Storyboard (scene photo, plain-English camera move, length, on-screen text), a full preview player, and one large **Generate My Video** button. Progress is shown, then the finished MP4 plays on the page with a **Download MP4** button. |

Screenshots: `docs/screenshots/stage6-step*.png`.

### Auto Create with AI
One click on step 1: chooses style, length, shape, photo order, scene timing, camera motion,
transitions, text, music and branding, saves the storyboard and **starts making the real MP4
immediately**, then shows "How we built your video" with a plain reason for every choice.

The AI Director is not connected yet, so this uses a transparent **rule-based storyboard maker**
(`autoDirector` in `src/lib/video/easy.ts`), and the page says so. It only uses facts from the
listing — nothing is invented. Rules: open house date → Open House; for sale / coming soon →
Just Listed; price ≥ $1M → Luxury Cinematic; has bedrooms/baths/size → Property Highlights;
otherwise Modern. 18+ photos → Long, 6+ → Standard, else Short. The first uploaded music is used.

### AI effects
The toggle is shown but switched off with a friendly note: AI video generation is not connected
for the company yet; videos use smooth, real photo motion.

## Design rules applied
- Large buttons and tap targets (h-12 – h-16), one primary action per step, sticky Back / Next bar.
- Plain English everywhere: camera moves are now **Move Closer, Move Back, Slide Left, Slide Right,
  Circle Around, Rise Up, Fly Over, Walk Through, Hold Still** (also in the Advanced editor and video
  pages); shapes are Wide / Tall / Square; lengths are Short / Standard / Long.
- **Autosave** of listing details, photo order and the storyboard (serialized saves with revision checks;
  a friendly "changed in another window" message on conflicts). The URL `/create?project=…&step=…`
  resumes where the person left off.
- **Undo / Redo** buttons plus Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) in the wizard *and* the Advanced editor
  (typing in a box merges into one undo step).
- Friendly errors with a "Go to step N" button where the fix lives.
- Responsive: single column on phones, no horizontal scrolling; sample previews pause off-screen and
  respect reduced-motion.

## One project, two modes
- Easy settings are stored in `edit_plan.easy` (style, length, shape, music, branding, photo order).
- Editing in the Advanced editor marks the plan `customized`; Easy Mode then keeps those edits and
  warns before rebuilding the storyboard (Undo restores them).
- Video page: **Change with Easy Mode** and **Advanced editor** buttons; the editor has **Back to Easy Mode**.
  The video page refreshes itself while a video is being made.
- Templates page "Use this style" opens the wizard with that style selected.

## Security
Unchanged model: every action/API runs as the signed-in person with RLS. New pieces:
- `media_assets.thumbnail_path` must be inside the same company + listing folder and end in `.thumb.jpg`
  (database constraint); thumbnails are only registered if really uploaded, and are deleted with the photo.
- Easy Mode server actions (`startEasyListing`, `saveEasyDetails`, `createEasyProject`, `listEasyPhotos`)
  check the `videos.create` permission and validate input with the same rules as the listing form.
- The in-page player uses `/api/projects/:id/renders/:rid/download?play=1` — same download permission,
  a short-lived signed link.

## Tests
| Test | Result |
|---|---|
| Unit + DB (`npm test -w @lvs/web`) | 138 passed — incl. `easy.test.ts` (all 6 styles × 3 lengths are valid FableCut documents accepted by the render worker; real facts only; Auto Create rules) and `tests/db/easy-mode.test.ts` (thumbnail folder rules, privacy, the six styles) |
| Real render (`npm run test:render -w @lvs/web`) | Stage 6: **Auto Create → 1920×1080, 30.0 s H.264/AAC MP4** with music and the "JUST LISTED" banner (~65 s); **Social Media Reel → 1080×1920, 15 s** (~36 s) |
| Browser E2E (`tests/e2e/easy-mode.e2e.mjs`) | Photos → Auto Create → plays on the page → download → ffprobe. Skips without `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD` (needs a running app + Supabase + worker). |
| Typecheck, production build | Pass |

## Migration
`supabase/migrations/20261106000100_easy_mode.sql` — thumbnail column + constraint; built-in templates
renamed/added to the six Easy Mode styles (Just Sold retired; existing projects keep their template).
