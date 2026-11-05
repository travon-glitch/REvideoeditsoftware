# Production deployment

This guide is for putting Listing Video Studio into production for **one company**. **Hosting on Vercel + Supabase? Follow `docs/VERCEL.md`**: it has the step-by-step version, with a one-file database setup (`supabase/setup.sql`) and a one-query first login (`supabase/first-login.sql`). It is a private
application: no public sign-up, no public pages except sign-in, and every file is private.
`docs/SETUP.md` has the first-time setup in more detail. This guide is the production version and
the checklist.

## 1. What runs where

| Part | Runs on | Needs | Notes |
|---|---|---|---|
| **Web app** (Next.js 15, `apps/web`) | A Node.js 20+ server or container behind HTTPS | Node 20.18+, **FFmpeg**, about 1 GB of disk for the voice models | Serves the app, the API and server actions. It also runs AI narration and captions (the native `sherpa-onnx` module plus the voice models). That's why it needs a real Node server rather than serverless functions. |
| **Render worker** (`packages/render-worker`) | 1 or more Linux machines or containers | Node 20.18+, **FFmpeg**, **Google Chrome or Chromium**, 2+ CPU cores and 4 GB RAM each | Makes the MP4 files. Each copy renders one video at a time; add copies for more throughput. |
| **AI worker** (`packages/ai-motion`) | 1 Linux machine or container (a GPU is not required) | Node 20.18+, **FFmpeg**, the depth model (about 25 MB) | AI depth camera moves on your own server, plus generative AI clips through MuAPI when that's switched on. |
| **Supabase** (hosted) | Supabase Cloud, Pro plan or above | | Postgres with Row-Level Security, Auth (email invitations) and Storage (6 private buckets). |

Both workers connect **out** to Supabase only. They don't listen on any port, so don't expose them to the internet.

## 2. Supabase

1. Create a project. The **Pro plan** or above is recommended, for daily backups and Point-in-Time Recovery.
2. Apply the migrations from this repository, in order (they are numbered):

   ```bash
   npx supabase link --project-ref <your-project-ref>
   ```

   ```bash
   npx supabase db push
   ```

   The migrations create every table, the access rules (RLS), the functions and the six private storage buckets. Never edit the database by hand. Make every change as a new migration file.
3. **Authentication:**
   - **Turn off "Allow new users to sign up"** (Authentication → Providers → Email). People are added only by an administrator inside the app.
   - Set **Site URL** to your app address (for example `https://video.yourcompany.com`) and add it to the redirect allow list.
   - Set up **custom SMTP** so invitations come from your own domain.
   - Email templates: invitation and password-reset links must point to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (or `type=recovery`).
     The link opens a "Continue" page, so email scanners can't use up the link.
   - Recommended: minimum password length 12, and leaked-password protection on.
4. **Storage:** the buckets are created by the migrations, all private. Keep them private. Downloads always use short-lived signed links.
5. Note the **Project URL**, the **anon key** and the **service-role key** (Settings → API). The service-role key is a master key: only the web server and the workers get it.

## 3. Secrets and settings

Set these in your host's secret store. Never put them in the repository or a browser bundle.

| Variable | Where | Required | What |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web, workers | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | yes | Public anon key (safe in the browser; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | web, workers | yes | **Secret.** Server-side only |
| `NEXT_PUBLIC_SITE_URL` | web | yes | Public address of the app, used in emails |
| `LVS_SECRETS_KEY` | web, AI worker | yes, for AI | 32 random bytes in base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Encrypts the provider keys saved in the AI control panel. **Use the same value on the web server and the AI worker, and back it up.** If it's lost, saved keys must be entered again. |
| `ANTHROPIC_API_KEY` | web | optional | Server-wide Claude key, used only if no key is saved in the AI control panel |
| `MUAPI_API_KEY`, `MUAPI_I2V_MODEL` | AI worker | optional | Worker-level MuAPI key (fallback when the company hasn't saved one) |
| `LVS_GENERATIVE_PROVIDER=muapi` | web | optional | Only when you use the worker-level MuAPI key instead of a saved one |
| `LVS_VOICE_MODELS` | web | optional | Folder of the voice models (default `packages/voice/models`) |
| `LVS_ERROR_WEBHOOK_URL` | web | recommended | HTTPS webhook (Slack, Teams or your monitoring tool) that receives server-error alerts |
| `FABLECUT_CHROME` / `LVS_CHROME_BIN` | render worker | as needed | Path to Chrome (see section 5) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | all | optional | If FFmpeg isn't on the PATH |
| `RENDER_TIMEOUT_MS`, `RENDER_POLL_MS`, `AI_POLL_MS` | workers | optional | Tuning (defaults: 20 min, 3 s, 3 s) |

## 4. Web app

On the web server (or in your container build):

```bash
npm ci
```

```bash
npm run fetch-models -w @lvs/voice
```

```bash
npm run build
```

```bash
npm start
```

- Put it behind HTTPS (your load balancer, Caddy, nginx or the host's TLS). HSTS and the Content-Security-Policy are set automatically on HTTPS.
- Run it under a process manager (systemd, PM2 or your platform's) with automatic restart.
- **Uptime check:** point your monitor at `https://<app>/healthz`. It returns `200 {"ok":true}` when the app and database answer, or `503` otherwise, and reveals nothing else.
- A memory limit of 2 GB is enough for one instance. Narration uses about 300 MB while it runs.
- Restrict who can reach the app (VPN, SSO proxy or IP allow-list) if company policy requires it. Sign-in is still required either way.

Example systemd unit (adjust the paths and user):

```ini
[Unit]
Description=Listing Video Studio web app
After=network-online.target

[Service]
User=lvs
WorkingDirectory=/opt/lvs
EnvironmentFile=/etc/lvs/web.env
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

## 5. Render worker

```bash
npm ci
```

```bash
npm run worker
```

- Install FFmpeg and Google Chrome (or Chromium) on the machine.
- **Run it as a normal (non-root) user** with `FABLECUT_CHROME=/usr/bin/google-chrome`. Chrome's own sandbox then stays on. The `--no-sandbox` wrapper (`LVS_CHROME_BIN`) is only for containers that must run as root.
- Give the machine no inbound ports. Outbound, it needs only Supabase.
- Start more copies (more machines, or more services on a large machine) for more throughput. **Admin → System settings → "Videos rendering at once"** caps the company's parallel renders.
- Each worker reports a heartbeat every 30 s. **Admin → System health** shows whether it's online.
- Verify it end to end once (renders real test videos, about 2 minutes):

  ```bash
  npm run test:render -w @lvs/web
  ```

## 6. AI worker

```bash
npm run fetch-model -w @lvs/ai-motion
```

```bash
npm start -w @lvs/ai-motion
```

- It always serves the free AI depth camera moves.
- It serves generative MuAPI clips when the company saved its MuAPI key (and the worker has the same `LVS_SECRETS_KEY`), or when `MUAPI_API_KEY` is set on the worker.
- It needs outbound access to Supabase and, for generative clips, `api.muapi.ai`.

## 7. AI services

All are switched on and off by the Super Admin in **Admin → AI control panel**:
- **Claude (AI Director):** paste the API key and choose the model. **Test connection** checks the key without using tokens.
- **MuAPI (generative video):** paste the key, then choose the model and the price per clip (used for spending estimates).
- **Spending ceilings:** set a monthly and a daily ceiling before switching paid AI on. Paid AI stops at either one.
- Narration, captions and AI depth moves run on your own servers and cost nothing per use.
- Before switching on a paid provider, the company must accept that provider's terms (see `docs/LICENSES.md` §4).

## 8. Error monitoring

- **Server errors:** every server error is written to the server log as one JSON line with `"event":"lvs.error"`, the page, the error type and a **reference** (the same reference the person sees on the error page). Search your log tool for `lvs.error`.
- **Alerts:** set `LVS_ERROR_WEBHOOK_URL` to receive at most one alert per page and error type every 10 minutes. Alerts never contain listing data, cookies or keys.
- **Workers:** worker logs go to stdout (`[render-worker]`, `[ai-worker]`). The last error of each worker also appears in **Admin → System health**.
- **Uptime:** `/healthz` (section 4).
- **Product health:** Admin → Dashboard (failures, queue) and Admin → AI control panel → Provider errors.

## 9. Backups

| What | How | How often |
|---|---|---|
| **Database** (everything except files) | Supabase daily backups (Pro) plus **Point-in-Time Recovery** (add-on) | Continuous / daily |
| **Files** (photos, videos, narration, logos, music) | Supabase backups **do not include Storage files.** Copy the six buckets with `node scripts/backup-storage.mjs` (included; incremental, never deletes) and keep that folder on separate backup storage | Nightly |
| **`LVS_SECRETS_KEY`** | Keep it in your password manager or secret vault, separately from the database backups | Once |
| **Settings** (environment files) | Your secret store | When changed |

**Test a restore every quarter.** Restore the database into a new Supabase project, copy the files back, start the app against it and open a few videos.

## 10. First administrator

1. On the web server, create a one-time setup code (valid for 60 minutes):

   ```bash
   npm run bootstrap:token
   ```

2. Open `https://<app>/setup`, enter the code, your company name and the Super Admin's details. Then follow the email to set the password. The setup page disappears after this.
3. As Super Admin:
   - **Admin → Brand kit:** logo, colours, fonts, disclosure.
   - **Admin → AI control panel:** keys, AI switches, ceilings.
   - **Admin → System settings:** limits.
   - **Admin → People → Add employee:** invite administrators and agents. Each gets an email to set a password.
4. Check **Admin → System health**: every row should say *Healthy* (or *Switched off* for AI you don't use).

## 11. Go-live checklist

- [ ] Every migration has been applied (`npx supabase db push` reports nothing pending).
- [ ] Sign-ups are **off** in Supabase Auth; the email templates use `/auth/confirm`; custom SMTP works (send yourself a test invitation).
- [ ] HTTPS only; `NEXT_PUBLIC_SITE_URL` uses `https://`.
- [ ] The service-role key and `LVS_SECRETS_KEY` are only in the server secret store.
- [ ] At least one render worker and one AI worker show **Online** in System health.
- [ ] Voice models are installed (System health → AI narration and captions *Healthy*).
- [ ] Spending ceilings are set before paid AI is switched on.
- [ ] Nightly Storage backup is running, and one restore has been tested.
- [ ] `/healthz` is monitored, and `LVS_ERROR_WEBHOOK_URL` is set.
- [ ] A test agent can: create a listing, upload photos, make a video in Easy Mode, render it and download the MP4.
