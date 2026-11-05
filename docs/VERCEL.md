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
3. **Authentication → Sign In / Providers → Email:** turn **off** "Allow new users to sign up". People are added only by an administrator inside the app. Leave "Confirm email" on.
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
| `LVS_SECRETS_KEY` | From step 1.7 |
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

## Limits on Vercel to know about

- Narration and transcription calls can take up to about a minute. The Pro plan's longer function time is needed (the routes ask for up to 300 s).
- Video files never pass through Vercel: uploads go straight to Supabase Storage, and downloads use short-lived signed links. "Download all as ZIP" is built in the browser.
- The per-person rate limits (voice preview, password attempts) count per Vercel instance, which is enough to stop one person from overloading the service.
