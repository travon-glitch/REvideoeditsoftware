# Stage 3 — Admin-controlled user accounts

**Status:** complete (2026-11-03). Stopped before Stage 4 as instructed.

## Roles

| Role | Can do | Enforced by |
|---|---|---|
| **Super Admin** | Everything. Creates/changes Admins, restores deactivated accounts, sees **and edits** every project and file, System settings (AI on/off, budget, default limits). | `private.is_super_admin()` in RLS + admin functions |
| **Admin** | Creates Editors and Viewers, edits/suspends/deactivates them, resets access, assigns projects, sees every project and the company video activity (read-only on others' projects), branding. | `assert_can_manage()` + RLS |
| **Editor** | Creates listings, uploads photos, creates and edits **their own and assigned** videos, AI features (if allowed), downloads (if allowed). | RLS + `can_edit_*()` + limits trigger |
| **Viewer** | Sees **only assigned** projects; downloads only if allowed; cannot create or edit. | RLS; assignments are forced to view-only |

The old Stage 2 role `creator` was renamed `editor` in the database (`ALTER TYPE … RENAME VALUE`).

## Users page (`/admin/users`)

| Requirement | Where |
|---|---|
| Create User | `/admin/users/new` — first name, last name, email, role, optional job title, optional monthly limits, download/AI switches |
| Edit User · Assign Role · Change Permissions | `/admin/users/[id]` → "Details, role and permissions" (`admin_update_user`) |
| Activate · Suspend · Deactivate | `/admin/users/[id]` → "Account access" (`admin_set_user_status` + Supabase Auth sign-in ban) |
| Reset Access | Sends a single-use set-password link (`admin_record_access_reset` + Supabase reset email) |
| Assign Project | `/admin/users/[id]` → "Projects" (`admin_assign_project` / `admin_unassign_project`), view or view-and-edit |
| Company video activity | `/admin/projects` — every project, owner, who it's shared with, recent activity |
| System settings | `/admin/settings` — Super Admin only |

Account statuses: **Invited** (can accept the invitation) → **Active** (set automatically when they choose a password)
⇄ **Suspended** (temporary) → **Deactivated** (someone left; only the Super Admin can restore).

## Account creation flow (no passwords by email)

1. Admin submits Create User → server action checks the admin's role.
2. Supabase Auth `inviteUserByEmail` creates the login and emails a **single-use link**.
3. `create_user_profile()` (callable **only** with the service-role key) re-checks in the database that the acting
   person is an active admin allowed to give that role, creates the profile as *Invited*, writes `user.created`.
   If this fails, the login from step 2 is deleted.
4. The person opens the link, chooses their own password; `activate_self()` marks them *Active* (`user.activated`).

There is no sign-up function anywhere in the app, and `supabase/config.toml` disables sign-up. A login without a
profile row (for example, created outside the app) sees nothing — every rule requires an active profile.

## Data security (database **and** API)

- **Projects are private by default:** visible to their owner, people assigned to them, Admins and the Super Admin.
  Edits: owner, assigned with "view and edit", or the Super Admin.
- **Listings and their photos** follow the projects made from them.
- **Files:** photos (`<org>/listings/<listing>/…`) need listing access; finished videos
  (`<org>/projects/<project>/…`) need project access **and** the person's download permission. Supabase checks these
  rules before it will create a signed download link, so a hidden button is never the only protection.
- **Profiles:** ordinary users can read only their own; role, status, permissions and limits can be changed only
  through the audited admin functions (column privileges block direct updates).
- **Monthly limits** are enforced by database triggers on new videos and AI jobs.
- **API level:** every server action re-authorizes and then runs as the signed-in person, so RLS applies again;
  the only service-role calls are the invitation, the profile-creation function (which re-checks rights itself)
  and the sign-in ban on suspend/deactivate.

## Audit log

| Event | Action recorded |
|---|---|
| Account creation | `user.created` (with role, permissions, limits) |
| Account activated / suspended / deactivated | `user.activated` · `user.suspended` · `user.deactivated` (from → to) |
| Role change | `user.role_changed` (from → to) |
| Permission / limit change | `user.permissions_changed` (before/after per field) |
| Details edit | `user.updated` |
| Reset access | `user.access_reset` |
| Project assignment | `project.assigned` (user, access) · `project.unassigned` |
| System settings | `settings.updated` |

Entries are written inside the same database transaction as the change; users cannot write or edit the log.

## Acceptance test (`apps/web/tests/db/acceptance.test.ts`) — ✅ 13/13 pass

Runs both migrations on PGlite (embedded Postgres 17), simulating Supabase requests:

1. Super Admin bootstrapped → creates an Admin.
2. Admin creates **two employee accounts** (Alice, Bob — Editors) and a Viewer; an Editor cannot create users;
   an Admin cannot create Admins; nobody can create a Super Admin; the backend function is not callable from a
   browser session; a login with no profile sees nothing.
3. Each employee creates a private project with a photo and a finished video file.
4. Admin assigns **different** company projects: Harbor View → Alice (edit), Maple Court → Bob (view).
5. **Isolation verified:** Alice sees exactly {her project, Harbor View}; Bob exactly {his project, Maple Court};
   photo files, finished-video files, media records, revisions and assignments are isolated; direct reads,
   updates, deletes, revision inserts, file plants/deletes and "make a video from Bob's listing" are refused;
   view-only assignment cannot edit.
6. **Super Admin sees and can edit both**; Admin sees both but cannot edit them.
7. Viewer sees only the assigned project, cannot download until permitted, cannot create; monthly video/AI limits
   are enforced; suspension/deactivation cut access immediately (only the Super Admin restores deactivated);
   all required audit events are present with the right actor and target; employees can't read or forge the log.

## Verification run

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm test` | ✅ 95 tests (web 85: unit 50 + database 35 · camera-presets 6 · fablecut-core 4) |
| `next build` | ✅ |
| Smoke: new admin routes without a session | ✅ all redirect to `/login` |
| Sign-up calls in app code | ✅ none |

## Not verified here

- Against a real Supabase project: invitation and reset emails, the sign-in ban, and signed-URL downloads
  (the database rules they depend on are tested). No Supabase project was available in this environment.
- Signed-in pages were type-checked and built but not rendered in a browser.

## Notes for the next stage

- Existing sessions of a suspended person are cut off from all data immediately (RLS); their sign-in token simply
  stops refreshing within the JWT lifetime (1 hour) because of the Auth ban.
- Admins can read every project (needed to assign and to see company activity) but cannot edit others' projects;
  tell me if you want Admins to have edit rights too, or to see only titles and statuses.
