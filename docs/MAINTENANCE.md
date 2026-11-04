# Maintenance guide

This is for whoever looks after Listing Video Studio after it goes live. `docs/DEPLOYMENT.md` covers
installing it. This guide covers keeping it healthy.

## Every day (5 minutes, or let the alerts do it)
- **Admin → System health:** every row *Healthy* or *Switched off*. Red rows explain what's wrong.
- **Admin → Dashboard:** the rendering queue isn't growing; AI generation failures aren't climbing.
- Error alerts (if `LVS_ERROR_WEBHOOK_URL` is set). Look up the reference with `lvs.error` in the server log.

## Every week
- **Admin → AI control panel:**
  - spending against the ceilings;
  - **Provider errors** (repeated failures from one provider usually mean an expired key or no credit);
  - the AI usage log for unusual use.
- **Admin → People:** suspend anyone who has left. Suspending blocks sign-in and data access immediately. Use *Deactivate* for people who won't come back.
- Check the nightly Storage backup finished: it prints `"event":"lvs.storage_backup"` with `failed: 0`.

## Every month
- **Admin → Activity log:** review role changes, key changes, deleted videos.
- Update the software (below) if there are security fixes. Run `npm audit --omit=dev`. Two advisories are accepted for now (postcss inside Next, zod 3; see STAGE14.md §5.12). Clear them by upgrading to Next 16 and zod 4, then run every test.
- Storage: **Admin → Dashboard → Storage by kind**. Archive or delete old videos you no longer need. Deleting a video in the Company video library also removes its files.

## Every quarter
- **Test a restore** (DEPLOYMENT.md §9): a fresh Supabase project, the database backup plus the file backup, then open three videos.
- Review who is Super Admin or Admin. Keep administrators to a minimum.
- Rotate provider keys (Claude, MuAPI): create a new key at the provider, paste it in the AI control panel, then delete the old one at the provider.

## Updating the software
1. Read the stage notes (`docs/STAGE*.md`) for the version you're moving to.
2. On a staging copy first:

   ```bash
   git pull
   ```

   ```bash
   npm ci
   ```

   ```bash
   npx supabase db push
   ```

   ```bash
   npm run build
   ```

3. Run the checks:

   ```bash
   npm test
   ```

   ```bash
   npm run typecheck
   ```

   ```bash
   npm run test:render -w @lvs/web
   ```

4. In production: apply the migrations **first** (they are written so the running version keeps working), then restart the web app, then the workers.
5. Never edit tables, access rules or storage buckets by hand in the Supabase dashboard. Add a migration file so the change is tested and repeatable. `tests/db/catalog-audit.test.ts` fails if a new table is missing Row-Level Security.

## Common problems

| What people see | Likely cause | Fix |
|---|---|---|
| "Rendering" never finishes | No render worker running, or it crashed | System health → Workers. Restart the render worker. Stuck jobs return to the queue by themselves after 25 minutes (2 attempts, then they're marked failed). |
| A render fails with "isn't a real photo, video clip or audio file" | A damaged or renamed file was uploaded | Replace that photo or music in the editor and render again. |
| "AI narration is switched off" / "Automatic captions are switched off" | The Super Admin switched the feature off | AI control panel → AI features |
| Narration button says the voice engine isn't installed | Voice models missing on the web server | `npm run fetch-models -w @lvs/voice`, then restart |
| Generative AI clips fail | MuAPI key expired or out of credit, or the AI worker doesn't share `LVS_SECRETS_KEY` | AI control panel → Provider errors; System health → MuAPI row |
| "Monthly (or daily) AI spending limit reached" | A ceiling was reached | Expected. Raise the ceiling in the AI control panel if that's intended. |
| Invitation link "expired" | Links are single-use and expire (Supabase default 24 h) | People → Manage → *Reset access* sends a new link |
| Someone can't see a video | It's private: owned by someone else, not assigned to them, or restricted | Company video library → Reassign, or People → Manage → assign the project |
| An iPhone photo is refused as HEIC | The photo was uploaded from a Mac or Windows file in HEIC format | Upload from the iPhone directly (it converts to JPG), or export as JPEG first |

## Logs
- **Web app:** stdout or your platform's log. Errors are one JSON line each (`"event":"lvs.error"`) with a reference that matches what the person saw.
- **Render worker:** `[render-worker] job … done/failed in N s`.
- **AI worker:** `[ai-worker] job … (provider) done/failed`.
- **In the app:** Admin → Activity log (who did what), AI usage log (every AI request), System health → Recent failed jobs.

## Capacity
- One render worker makes about 1 minute of 1080p video in 3 to 6 minutes on 2 CPU cores. Add workers for busy periods; the company's "Videos rendering at once" setting caps the total.
- The web server needs extra CPU only for narration and captions (a few seconds per narration).
- Storage grows mostly with photos (about 1 to 4 MB each after the automatic resize) and finished videos (about 5 to 15 MB per 30 s video).

## Security reminders
- The service-role key and `LVS_SECRETS_KEY` never go to anyone's computer, into chat, or into the repository.
- If a key may have leaked:
  - **Supabase service role:** rotate it (Supabase → Settings → API) and update the web server and workers.
  - **Claude or MuAPI:** revoke it at the provider and paste a new one in the AI control panel.
  - **`LVS_SECRETS_KEY`:** set a new one, then re-enter the provider keys.
- Keep at least two people with Super Admin access to the hosting and Supabase accounts. The in-app Super Admin role itself can't be given out from the app.
