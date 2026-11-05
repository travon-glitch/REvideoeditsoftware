# Going live with Supabase + Vercel

This is the shortest path to a working, private company site:

| Part | Where | What it does |
|---|---|---|
| Database, sign-in, file storage | **Supabase** (Pro plan recommended) | Everything people save |
| The website | **Vercel** (Pro plan recommended: renders and narration need longer functions than Hobby allows) | What agents use in the browser |
| Video maker, AI worker, voice | **One small always-on container** (Railway, Render, Fly.io or any server with Docker) | Makes the MP4s, AI camera moves, narration and captions. These can't run on Vercel: they need Chrome, FFmpeg and AI models. |

You can sign in and set everything up with only Supabase and Vercel (steps 1 to 5). Videos are made once the container is running (step 6).

## 1. Supabase: create the database (5 minutes)

1. Create a project at supabase.com. Note its **region**; choose the same region on Vercel later.
2. **SQL Editor → New query.** Paste all of [`supabase/setup.sql`](../supabase/setup.sql) and press **Run**. It creates every table, access rule, function and the six private storage buckets. Run it only once on a new project.
3. **Authentication → Sign In / Providers:** turn **off** the project-wide **"Allow new users to sign up"** switch (under *User Signups*). People are added only by an administrator inside the app.
   **Leave the Email provider itself enabled** (*Email* in the provider list, "Enable Email provider" on). Switching the provider off blocks every login ("Email logins are disabled"). Leave "Confirm email" on.
4. **Authentication → Emails → Templates:** paste these into the matching templates (Subject lines are at the top of each file):
   - [`supabase/templates/invite.html`](../supabase/templates/invite.html) into **Invite user**;
   - [`supabase/templates/recovery.html`](../supabase/templates/recovery.html) into **Reset password**;
   - [`supabase/templates/email-change.html`](../supabase/templates/email-change.html) into **Change email address**.
5. **Authentication → Emails → SMTP settings:** add your company's email sender. The built-in Supabase sender is only for testing and sends very few emails an hour.
6. **Project Settings → API:** you'll need the **Project URL**, the **anon public** key and the **service_role** key in step 3. The service_role key is a master key: paste it only into Vercel and the worker container, never anywhere else.
7. Make the two secrets the app needs. In **SQL Editor**, run:

   ```sql
   select encode(extensions.gen_random_bytes(32), 'base64') as "LVS_SECRETS_KEY",
          encode(extensions.gen_random_bytes(32), 'hex')    as "LVS_VOICE_SERVICE_SECRET";
   ```

   Keep both values in your password manager.

## 2. Vercel: import the project (5 minutes)

1. **Add New → Project →** import this GitHub repository.
2. **Root Directory:** `apps/web`. Framework: **Next.js** (detected). Leave the install and build commands alone; `apps/web/vercel.json` sets them.
3. **Environment Variables** (Production):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `NEXT_PUBLIC_SITE_URL` | Your site address, for example `https://video.yourcompany.com`, or `https://<project>.vercel.app` until you add a domain |
| `LVS_SECRETS_KEY` | Optional. From step 1.7. Without it, keys typed into the AI control panel are encrypted with a key derived from the service-role key (if you later rotate that key, re-enter the AI keys) |
| `LVS_VOICE_SERVICE_URL` | The container's HTTPS address (step 6). Leave it empty until then. |
| `LVS_VOICE_SERVICE_SECRET` | From step 1.7 |
| `LVS_ERROR_WEBHOOK_URL` | Optional: a Slack or Teams webhook for error alerts |

4. **Deploy.** Then, under **Settings → Functions**, set the region to match Supabase.
5. Optional: **Settings → Domains**, add your company domain. Then update `NEXT_PUBLIC_SITE_URL` and redeploy.

## 3. Supabase: tell it the site's address

**Authentication → URL Configuration:**
- **Site URL** = your Vercel address (the same as `NEXT_PUBLIC_SITE_URL`);
- under **Redirect URLs**, add `https://<your-site>/**`.

## 4. Your first login (the Super Admin)

1. **SQL Editor → New query →** paste [`supabase/first-login.sql`](../supabase/first-login.sql) and press **Run**. It shows a **one-time setup code**, valid for 60 minutes.
2. Open `https://<your-site>/setup`. Enter the code, your company name, your name, email and a password (at least 12 characters, with upper- and lowercase letters and a number).
3. You're signed in as the Super Admin. The `/setup` page switches itself off for good.

## 5. Set up the company (in the app)

- **Admin → Brand kit:** logo, colours, disclosure.
- **Admin → AI control panel:** Claude key, AI switches, spending ceilings.
- **Admin → People → Add employee:** each person gets an invitation email and chooses their own password.

## 6a. Make videos with GitHub Actions (no server needed)

The easiest way to get **Export MP4** working: GitHub runs the video maker for you, only when someone presses Export, using the workflow already in this repository (`.github/workflows/render-videos.yml`). Nothing to host.

1. **GitHub → your repository → Settings → Secrets and variables → Actions → New repository secret.** Add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase Project URL;
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service_role key;
   - `LVS_SECRETS_KEY` only if you also set it on Vercel.
2. **Create a token so the website can start it:** GitHub → your avatar → Settings → Developer settings → Personal access tokens → **Fine-grained tokens → Generate new token**:
   - Repository access: **Only select repositories →** this repository.
   - Permissions → Repository permissions → **Actions: Read and write**. Nothing else.
   - Give it an expiry you'll remember (for example 1 year) and copy it.
3. **Vercel → Settings → Environment Variables**, add for Production:
   - `GITHUB_RENDER_TOKEN` = the token from step 2;
   - `GITHUB_RENDER_REPO` = `travon-glitch/REvideoeditsoftware`.

   Then **Redeploy**.
4. Test it: open a video, press **Generate video** (or Export MP4), and watch **GitHub → Actions → Render videos**. The first run takes about 3 to 4 minutes (installing). The MP4 then appears in the app with a Download button.

Notes:
- Each run costs GitHub Actions minutes, roughly 3 to 6 minutes per video. Private repositories on the free plan include 2,000 minutes a month; add a payment method in GitHub for more.
- If the website can't start it (no token), a safety-net run every 3 hours still makes waiting videos.
- AI narration and captions still need the voice service (section 6) because they run while you edit, not at export time.

## 6. The worker container (videos, AI, narration)

This is one Docker image, `deploy/worker.Dockerfile`, which runs the render worker, the AI worker and the voice service.

**Railway / Render / Fly.io:**
1. Create a new service from this GitHub repository, using the **Dockerfile** at `deploy/worker.Dockerfile`, with the repository root as the build context.
2. Give it at least **2 vCPU and 4 GB RAM**.
3. Set these environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
   - `LVS_SECRETS_KEY` and `LVS_VOICE_SERVICE_SECRET` (the **same** values as on Vercel);
   - optional `RENDER_WORKERS=2` on a 4-vCPU machine.
4. Expose port **8790** over HTTPS (the platform's public URL). Health check path: `/ping`.
5. Put that HTTPS address into Vercel as `LVS_VOICE_SERVICE_URL`, then redeploy Vercel.

**Any server with Docker:**

```bash
docker build -f deploy/worker.Dockerfile -t lvs-workers .
```

```bash
docker run -d --restart=always --env-file workers.env -p 8790:8790 --name lvs-workers lvs-workers
```

On a plain server, put HTTPS in front of port 8790 (for example Caddy). The voice service must never be reachable over plain HTTP from the internet.

**Check:** in the app, **Admin → System health** should show the render and AI workers *Online*, and narration and captions *Healthy*.

## Updating

- **Website:** push to GitHub; Vercel redeploys by itself.
- **Database:** for each **new** file in `supabase/migrations/`, paste it into the SQL Editor and run it, oldest first. Or run `npx supabase db push`, which keeps track of what's applied. Never re-run `setup.sql` on a live project.
- **Workers:** redeploy the container. The platform rebuilds it from GitHub.

## If the site says "Almost ready" or nobody can sign in

| What you see | Cause | Fix |
|---|---|---|
| **"Almost ready – this app isn't connected to its database yet"** | `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing or malformed **in the build that's live** | Add both in Vercel → Settings → Environment Variables (Production, and Preview if you use it). The URL must be the full `https://<ref>.supabase.co`. Then **Redeploy**: `NEXT_PUBLIC_` values are built into the site, so adding them without redeploying changes nothing. |
| "Sign-in by email is switched off in Supabase" | The Email provider was disabled instead of sign-ups | Supabase → Authentication → Sign In / Providers → Email → enable it (step 1.3) |
| AI control panel: key boxes greyed out | `SUPABASE_SERVICE_ROLE_KEY` isn't set on Vercel | Add it and redeploy |
| AI control panel: "Settings are not available" | The company's settings row was missing (first account not made through `/setup`) | Fixed automatically from this version; or run `supabase/migrations/20261115000100_settings_self_heal.sql` in the SQL Editor |
| "Claude rejected this key" with "Using the server's ANTHROPIC_API_KEY" | The `ANTHROPIC_API_KEY` set on Vercel is wrong or revoked | Type a valid key into the panel and press **Save key** (a saved key replaces the server's), or fix or remove it in Vercel and redeploy |
| A video stays on "Getting ready…" / "Waiting to start…" | No video maker is running | Set up 6a (GitHub Actions) or 6 (worker container). The app shows a notice saying which. |
| "That email and password don't match" for everyone | No account yet | Create the first one with `supabase/first-login.sql` → `/setup` (step 4) |
| `/setup` says the code is wrong or expired | Codes last 60 minutes and only the newest works | Run `first-login.sql` again and use the new code |

## Limits on Vercel to know about

- Narration and transcription calls can take up to about a minute. The Pro plan's longer function time is needed (the routes ask for up to 300 s).
- Video files never pass through Vercel: uploads go straight to Supabase Storage, and downloads use short-lived signed links. "Download all as ZIP" is built in the browser.
- The per-person rate limits (voice preview, password attempts) count per Vercel instance, which is enough to stop one person from overloading the service.
