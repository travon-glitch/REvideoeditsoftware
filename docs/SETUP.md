# Setup guide (IT / operator)

This is a **private company system**. There is no public sign-up, no billing and no public project access.
The first account (Super Admin) is created with a one-time code; everyone else is invited by an administrator.

## 1. Requirements

- Node.js 20.18+ (tested on 22.23) and npm 10+
- A Supabase project (hosted), or the Supabase CLI + Docker for local development

## 2. Install

```bash
npm install
```

## 3. Create the database

**Hosted Supabase:** link the project and push the migration:

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

**Local:** `npx supabase start` applies `supabase/migrations/` and `supabase/config.toml` automatically.

The migration creates every table, the security rules (Row-Level Security), the three **private** storage
buckets (`listing-media`, `brand-assets`, `video-exports`) and five built-in templates. It seeds **no users and no passwords**.

## 4. Turn off public sign-up (hosted projects)

`supabase/config.toml` does this locally. On the hosted project, in the dashboard:

1. **Authentication → Sign In / Providers →** turn **off** "Allow new users to sign up".
2. **Authentication → Sign In / Providers → Email:** keep the **Email provider enabled** (switching it off blocks every login with "Email logins are disabled"); set minimum password length to 12.
3. **Authentication → URL Configuration:** Site URL = your app URL (for example `https://video.yourcompany.com`);
   add `https://video.yourcompany.com/auth/confirm` to Redirect URLs.
4. **Authentication → Emails → Templates:** point the links at `/auth/confirm` so they work with server-side sessions:

| Template | Link |
|---|---|
| Invite user | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/password` |
| Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/password` |

5. Configure a custom SMTP sender (Authentication → Emails → SMTP) so invitations come from your domain.

## 5. Configure the app

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SITE_URL`
(Supabase → Project Settings → API). The service-role key is used **only on the server** and must never be committed.

## 6. Create the Super Admin (one time)

1. On a trusted machine with `.env.local` filled in, print a one-time code:

   ```bash
   npm run bootstrap:token
   ```

   The code is shown once and expires after 60 minutes. Only its SHA-256 hash is stored in the database.
   Running the command again cancels the previous code.

2. Start the app and open `/setup`:

   ```bash
   npm run build
   ```

   ```bash
   npm start
   ```

3. Enter the code, the company name, your name, your email and **a password you choose**.
   No password is hard-coded anywhere.

When setup finishes, the code is burned, `/setup` returns "page not found", and the command refuses to make new codes —
for good (enforced in the database by `private.bootstrap_state`).

## 7. First steps as Super Admin

1. **Admin Panel → Branding:** upload the logo, choose colors and fonts, add your closing message and legal text.
2. **Admin Panel → Users → Create user.** Each person gets a secure invitation link and chooses their own password.
   Then open their page to **assign projects**. Roles:

| Role | Can |
|---|---|
| Viewer | See projects assigned to them; download if allowed |
| Editor | Create listings, upload photos, create and edit their own and assigned videos, AI features if allowed |
| Admin | Create Editors and Viewers, assign projects, see company video activity, branding |
| Super Admin | Everything, including Admins, AI services, costs and system settings. Only one, created by setup. |

See `docs/STAGE3.md` for statuses (invited / active / suspended / deactivated), limits and the audit log.

## 8. Render worker (makes the MP4 files)

Videos are rendered by a separate background process, not by the web server. On a machine (or container) with
**FFmpeg** and **Google Chrome or Chromium** installed, with the same `apps/web/.env.local` values:

```bash
npm install
```

```bash
npm run worker
```

- It needs `SUPABASE_SERVICE_ROLE_KEY`, so run it on a trusted server, never on staff computers.
- Chrome: set `FABLECUT_CHROME` to the Chrome binary. If the worker must run as root (some containers), leave
  `FABLECUT_CHROME` unset and set `LVS_CHROME_BIN` to the Chrome binary; the bundled wrapper adds `--no-sandbox`.
  Prefer running as a normal user.
- Each copy renders one video at a time; start more copies for more throughput. Stuck jobs are retried automatically.
- Check it end to end with `npm run test:render -w @lvs/web` (renders real test videos, ~2 minutes).

- Workers report a heartbeat every 30 seconds; Admin → System health shows them as online, quiet or stopped.

## 8a. Video AI provider keys (Admin → AI control panel)

The Super Admin saves the MuAPI key in **Admin → AI control panel**. It is stored encrypted and never shown again
(only its last 4 characters). For the AI worker to use it, set the **same** `LVS_SECRETS_KEY` on the web server
and on the AI worker (`npm start -w @lvs/ai-motion`). A key set on the worker itself (`MUAPI_API_KEY`) still works
as a fallback; the company's saved key is used first.

## 8b. AI voiceovers and captions (on this server)

Narration and subtitles run on the app server. No audio is sent anywhere else. Download the two models once
(about 220 MB):

```bash
npm run fetch-models -w @lvs/voice
```

They are both Apache-2.0, from the sherpa-onnx GitHub releases:
- **Kokoro-82M v1.0**, the text-to-speech voice;
- **Zipformer small English**, the speech recognition that times the captions.

Set `LVS_VOICE_MODELS=/path` to keep them elsewhere. The editor shows a notice until the models are installed.
`ffmpeg` must be installed on the app server, because narration is stored as AAC.

## 9. Production checklist

- Serve over HTTPS only (HSTS and `upgrade-insecure-requests` are sent automatically on HTTPS).
- Keep `SUPABASE_SERVICE_ROLE_KEY` in your host's secret store.
- Restrict who can reach the app (VPN / SSO proxy / IP allow-list) if your policy requires it.
- Enable Supabase database backups (Point-in-Time Recovery).
- Keep `reference/` out of deployments (it is git-ignored).
