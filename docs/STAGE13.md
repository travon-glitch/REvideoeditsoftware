# Stage 13 — Admin control center

The Admin area (`/admin`) is now a full control center. Everything on it is read through database functions that check the caller's role, and every change goes through a function that checks it again and writes the audit log. The browser never decides who may do what.

| Page | Who |
|---|---|
| **Dashboard** `/admin` | Administrators. Spending is shown to the Super Admin only. |
| **People** `/admin/users` | Administrators (Admins can't manage other admins or the Super Admin). |
| **Video library** `/admin/library` | Super Admin: everything. Admins: view and lock only, and they can't see restricted videos. |
| **AI control panel** `/admin/ai` | Super Admin only. |
| **System health** `/admin/health` | Administrators. |

## Dashboard (`admin_dashboard()`)
- Total, active and suspended users.
- Total listings.
- Videos generated.
- AI video jobs.
- Rendering queue (waiting, running, oldest wait, failed today).
- AI generation failures this month (clips, Director, narration and captions).
- Storage usage, by kind.
- Estimated AI spending against the monthly ceiling. It shows a warning past the alert percentage and an alert when a ceiling is reached.
- Recent activity.

## People and activity (`admin_user_activity()`)
For every person in the company the table shows:
- name, role and status;
- projects (owned and assigned) and listings;
- videos rendered, and videos this month against their limit;
- AI generations (total, and AI clips this month against their limit);
- storage consumed;
- most recent activity and when;
- generation limits.

**Account actions**, right in the table (each is checked again in the database):
- change role;
- suspend or re-activate (this also blocks sign-in);
- video and AI limits;
- download and AI permission.

**Add employee** and **Manage** (assign listings and projects, reset access) are on the person's page.

## AI control panel (Super Admin)
- **Claude credentials:** save, replace, remove or test the key.
- **Video AI provider credentials (MuAPI):** save, replace or remove the key.
  - Keys are encrypted with AES-256-GCM using `LVS_SECRETS_KEY`, and only the last 4 characters are ever shown again.
  - The database confirms the caller is the Super Admin (and logs it) before the key is stored.
  - The AI worker now reads the company's saved key for each job (`providersForJob`).
- **Default models:** the Claude model and the video AI model. Every new clip records the model it used.
- **Enable or disable AI features:**
  - generative AI clips;
  - AI depth camera moves;
  - AI narration;
  - automatic captions;
  - the AI Director.

  These are enforced in the database:
  - the AI-job insert policy;
  - `start_local_ai` for narration and captions;
  - `start_director_run`.
- **Per-person AI generation limits** (and the default for new people).
- **Company spending ceilings:** monthly, plus a new **daily** ceiling and an alert percentage.
  - Paid AI stops at either ceiling.
  - Each clip is estimated at no less than the company's price per clip, so a request can't understate its cost.
- **Provider errors** from the last 30 days, grouped by provider.
- **AI usage log** for every request (clips, depth clips, Director runs, narration, captions):
  - who, what, provider and model, result, cost and error;
  - filters, paging, and a **CSV download**. The CSV is protected against spreadsheet formulas.

Narration and captions are now logged too (`ai_usage_events`).

## Company video library
- Search by property address (street, city or ZIP) or title.
- Filters by employee, date range and template, and for current, archived or all videos.
- **Preview** (in-page player), **Download**.
- **Reassign** to another active Editor or above.
- **Restrict:** hidden from other administrators; only the owner, people assigned to it and the Super Admin can see it.
- **Lock:** read-only for everyone except the Super Admin.
- **Archive:** read-only and hidden from everyday lists; it can be restored.
- **Delete** with confirmation. You must type the title, and the database checks it again. The video's stored files are removed, but only files inside the company's own folder.

## System health
All checked live when the page opens:
- **Database** connection and how fast it answered.
- **Render worker and AI worker status**, from new heartbeats every 30 s: online, quiet or stopped, busy, jobs done, last error, providers served.
- **Pending jobs** (waiting, running, oldest wait, stuck) and **failed jobs** (24 h and the most recent ones), for both queues.
- **Storage health:** a real request to every storage area.
- **Provider integration status:** Claude, MuAPI (key saved and a worker serving it), AI depth, narration and caption models, FFmpeg, and secret storage.

## Database (`supabase/migrations/20261113000100_admin_control_center.sql`)
- New AI switches, video model, price per clip, daily ceiling and alert percentage on `organization_settings`. Only the Super Admin can update them.
- The MuAPI key can now be stored in `organization_secrets`.
- `video_projects` gains `restricted`, `locked`, `archived_at` and `archived_by`:
  - access rules updated (`can_read_project`, `can_edit_project`, the select policy);
  - a trigger stops anyone changing the owner or these fields except through the admin functions.
- New tables:
  - `ai_usage_events`;
  - `worker_heartbeats` (service role only).
- New functions:
  - `admin_dashboard`, `admin_user_activity`, `admin_ai_usage`, `admin_system_health`;
  - `admin_set_project_access`, `admin_archive_project`, `admin_reassign_project`, `admin_delete_project`;
  - `provider_key_status`, `my_ai_features`;
  - `start_local_ai` / `finish_local_ai`, `record_admin_action`, `worker_heartbeat`.

## Security tests
`tests/db/admin-control.test.ts` has 13 tests, run on the real migrations with RLS. They check that:
- **Ordinary employees (Editors and Viewers) can't:**
  - change anyone's limits, role, status, downloads, batch permission or assignments, through the functions or by writing their own profile;
  - read or change company AI settings or ceilings, read stored keys, or see their last 4 characters;
  - open the dashboard, people's activity, the AI usage log or system health, or post a heartbeat;
  - archive, reassign, restrict or delete videos, even their own, through the functions or by writing the columns directly;
  - **retrieve another employee's private files.** Bob and a Viewer can't see Alice's listing, photos, project, narration, render rows or storage objects. Supabase checks storage objects before it signs a download link.
- **Administrators:**
  - see the dashboard (without spending) and activity;
  - can set limits and downloads, and suspend;
  - can lock a video;
  - **can't** make admins, restrict, archive, reassign, delete, change AI settings or read the AI usage log.
- **Super Admin:**
  - spending by provider, and the minimum price per clip;
  - the AI usage log;
  - heartbeats appearing in health;
  - the daily ceiling;
  - the depth and narration switches;
  - restriction hiding a video from admins (including its file);
  - archive making a video read-only;
  - reassignment moving access;
  - delete needing the exact title and returning the files;
  - the full audit trail.

`src/lib/__tests__/admin-control.test.ts` has 11 tests. Every admin server action is called with an Editor's and a Viewer's session and is refused before anything reaches the database. Administrators can't reach Super Admin actions. A provider key is stored only after the database confirms the Super Admin. Delete removes only the company's own files. It also covers the form rules, filters and display helpers, and checks that the web app's key encryption matches the worker's decryption.

**Results (2026-11-03):**
- Web unit and database tests: **258/258**, including all earlier stages.
- Camera engine: **21/21.** AI motion: **8/8.** Voice: **6/6.**
- Typecheck (web, ai-motion, render-worker) and the production build pass.
- Screenshots:
  - `docs/screenshots/stage13-dashboard.png`;
  - `stage13-people.png`;
  - `stage13-ai.png`;
  - `stage13-library.png`;
  - `stage13-delete.png`;
  - `stage13-health.png`.

**Not covered here:**
- The pages were checked with sample data in a test page, not against a live Supabase project. All the database behaviour above is tested on the real migrations.
- The MuAPI key can't be tested from the panel, because MuAPI has no free check. Failures show up under Provider errors.
- Photo AI effects (sky replacement, staging) aren't built yet, so they have no switch.
