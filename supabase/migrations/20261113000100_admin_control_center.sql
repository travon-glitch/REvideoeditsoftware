-- ════════════════════════════════════════════════════════════════════════════
-- Stage 13 — Admin control center
--
--   • Company dashboard, per-person activity, AI usage log, system health:
--     read through security-definer functions that check the caller's role.
--   • AI controls: each AI feature can be switched on or off; video AI provider,
--     model and price used for estimates; a daily spending ceiling on top of
--     the monthly one; provider keys stored encrypted (never readable back).
--   • Company video library: archive, reassign, delete (with the title typed
--     back), restrict a project from other administrators, lock it read-only.
--   • Workers report a heartbeat so the health page knows they are alive.
--
-- Every change goes through a function that re-checks the caller's role and
-- writes the audit log. Nothing here is decided by the browser.
-- ════════════════════════════════════════════════════════════════════════════

-- ── AI controls ─────────────────────────────────────────────────────────────
alter table public.organization_settings
  add column ai_depth_motion_enabled boolean not null default true,
  add column ai_voiceover_enabled boolean not null default true,
  add column ai_captions_enabled boolean not null default true,
  add column video_ai_provider text not null default 'muapi' check (video_ai_provider in ('muapi')),
  add column video_ai_model text not null default 'kling-v2.1-standard-i2v' check (video_ai_model ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  add column video_ai_clip_cost_cents integer not null default 40 check (video_ai_clip_cost_cents between 0 and 10000),
  add column daily_ai_budget_cents integer check (daily_ai_budget_cents >= 0),
  add column ai_budget_alert_percent integer not null default 80 check (ai_budget_alert_percent between 10 and 100);
grant update (ai_depth_motion_enabled, ai_voiceover_enabled, ai_captions_enabled, video_ai_provider, video_ai_model,
              video_ai_clip_cost_cents, daily_ai_budget_cents, ai_budget_alert_percent) on public.organization_settings to authenticated;
-- (settings_update policy: Super Admin only)

-- Provider keys: the video AI key joins the Claude key (still service-role only, never readable by people).
alter table public.organization_secrets drop constraint organization_secrets_name_check;
alter table public.organization_secrets add constraint organization_secrets_name_check
  check (name in ('anthropic_api_key', 'muapi_api_key'));

/* Which provider keys are saved — the last 4 characters and when, never the key (Super Admin). */
create function public.provider_key_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.is_super_admin() then coalesce(
    (select jsonb_object_agg(s.name, jsonb_build_object('last4', s.last4, 'updated_at', s.updated_at))
       from public.organization_secrets s where s.organization_id = private.current_org_id()), '{}'::jsonb)
  else null end;
$$;
revoke all on function public.provider_key_status() from public, anon;
grant execute on function public.provider_key_status() to authenticated;

/* Is one AI feature switched on for the caller's company? */
create function private.ai_feature(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p_feature
      when 'generative' then s.ai_enabled
      when 'depth' then s.ai_depth_motion_enabled
      when 'voiceover' then s.ai_voiceover_enabled
      when 'captions' then s.ai_captions_enabled
      when 'director' then s.claude_enabled
      else false end
    from public.organization_settings s where s.organization_id = private.current_org_id()), false);
$$;
revoke all on function private.ai_feature(text) from public, anon;
grant execute on function private.ai_feature(text) to authenticated, service_role;

/* What AI the signed-in person may use right now (people who aren't admins can't read company settings). */
create function public.my_ai_features() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'can_use_ai', private.can_use_ai(),
    'generative', private.ai_feature('generative'),
    'depth', private.ai_feature('depth'),
    'voiceover', private.ai_feature('voiceover'),
    'captions', private.ai_feature('captions'),
    'director', private.ai_feature('director'),
    'video_provider', s.video_ai_provider,
    'video_model', s.video_ai_model,
    'video_key_saved', exists (select 1 from public.organization_secrets k where k.organization_id = s.organization_id and k.name = 'muapi_api_key'))
  from public.organization_settings s where s.organization_id = private.current_org_id();
$$;
revoke all on function public.my_ai_features() from public, anon;
grant execute on function public.my_ai_features() to authenticated;

-- ── Spending ────────────────────────────────────────────────────────────────
create function private.ai_spent_today(p_org uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)) from public.generation_jobs
                    where organization_id = p_org and created_at >= date_trunc('day', now()) and status <> 'cancelled'), 0)
       + coalesce((select sum(cost_cents) from public.director_runs
                    where organization_id = p_org and created_at >= date_trunc('day', now())), 0);
$$;

/* null when spending `p_extra` more is allowed, otherwise the reason. */
create function private.ai_ceiling_reached(p_org uuid, p_extra numeric) returns text
language plpgsql stable security definer set search_path = '' as $$
declare s public.organization_settings;
begin
  select * into s from public.organization_settings where organization_id = p_org;
  if s.monthly_ai_budget_cents is not null then
    if private.ai_spent_this_month(p_org) >= s.monthly_ai_budget_cents
       or private.ai_spent_this_month(p_org) + p_extra > s.monthly_ai_budget_cents then
      return 'Monthly AI spending limit reached';
    end if;
  end if;
  if s.daily_ai_budget_cents is not null then
    if private.ai_spent_today(p_org) >= s.daily_ai_budget_cents
       or private.ai_spent_today(p_org) + p_extra > s.daily_ai_budget_cents then
      return 'Daily AI spending limit reached';
    end if;
  end if;
  return null;
end $$;

/* Paid AI clips are estimated at least at the company's price per clip (set by the Super Admin). */
create function private.estimate_generation_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- never below the company's price per clip, so a request can't dodge the spending ceiling
  new.cost_estimate_cents := case when new.provider = 'local-depth' then 0
    else greatest(coalesce(new.cost_estimate_cents, 0),
                  coalesce((select s.video_ai_clip_cost_cents from public.organization_settings s where s.organization_id = new.organization_id), 0)) end;
  return new;
end $$;
create trigger generation_jobs_aa_estimate before insert on public.generation_jobs
  for each row execute function private.estimate_generation_cost();

create or replace function private.enforce_ai_budget() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  -- the local depth method runs on our own server and costs nothing; paid providers stop at the ceilings
  if new.provider <> 'local-depth' then
    v_reason := private.ai_ceiling_reached(new.organization_id, coalesce(new.cost_estimate_cents, 0));
    if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

-- The AI Director also stops at the daily ceiling.
create or replace function public.start_director_run(p_listing_id uuid, p_style text, p_photo_count integer) returns public.director_runs
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  s public.organization_settings;
  v_count integer;
  v_run public.director_runs;
  v_reason text;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or not caller.is_active or caller.role < 'editor' or not caller.can_use_ai then
    raise exception 'AI isn''t switched on for your account' using errcode = '42501';
  end if;
  select * into s from public.organization_settings where organization_id = caller.organization_id;
  if s.organization_id is null or not s.claude_enabled then
    raise exception 'The AI Director isn''t switched on for your company' using errcode = '42501';
  end if;
  if not private.can_edit_listing(p_listing_id) then
    raise exception 'You can''t make videos from this listing' using errcode = '42501';
  end if;
  if s.claude_monthly_run_limit is not null then
    select count(*) into v_count from public.director_runs where organization_id = caller.organization_id and created_at >= date_trunc('month', now());
    if v_count >= s.claude_monthly_run_limit then
      raise exception 'The company''s monthly AI Director limit is reached (% runs)', s.claude_monthly_run_limit using errcode = 'P0001';
    end if;
  end if;
  if s.claude_daily_runs_per_user is not null then
    select count(*) into v_count from public.director_runs where created_by = caller.id and created_at >= date_trunc('day', now());
    if v_count >= s.claude_daily_runs_per_user then
      raise exception 'Your daily AI Director limit is reached (% runs)', s.claude_daily_runs_per_user using errcode = 'P0001';
    end if;
  end if;
  v_reason := private.ai_ceiling_reached(caller.organization_id, 0);
  if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
  insert into public.director_runs (organization_id, listing_id, created_by, style, model, photo_count)
  values (caller.organization_id, p_listing_id, caller.id, p_style, s.claude_model, p_photo_count) returning * into v_run;
  perform private.audit(caller.organization_id, 'director.started', 'director_run', v_run.id::text, jsonb_build_object('listing', p_listing_id, 'style', p_style, 'model', s.claude_model));
  return v_run;
end $$;

-- AI camera clips: the local depth method follows its own switch now.
drop policy gen_insert on public.generation_jobs;
create policy gen_insert on public.generation_jobs for insert to authenticated
  with check (organization_id = private.current_org_id() and private.can_use_ai()
              and requested_by = auth.uid() and status = 'queued' and progress = 0 and attempts = 0 and worker_id is null
              and output_asset_id is null and cost_actual_cents is null and provider_job_id is null and review is null
              and kind = 'image_to_video'
              and listing_id is not null and private.can_edit_listing(listing_id)
              and (project_id is null or private.can_edit_project(project_id))
              and exists (select 1 from public.media_assets m where m.id = generation_jobs.source_asset_id and m.kind = 'photo'
                          and m.bucket = 'listing-media' and m.listing_id = generation_jobs.listing_id)
              and ((provider = 'local-depth' and private.ai_feature('depth'))
                   or (provider <> 'local-depth' and private.ai_feature('generative'))));

-- ── AI that runs on our own server (narration, captions): logged and switchable ──
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.video_projects (id) on delete set null,
  kind text not null check (kind in ('voiceover', 'transcription')),
  provider text not null default 'local' check (char_length(provider) <= 60),
  model text not null check (char_length(model) <= 120),
  status public.job_status not null default 'running',
  error_message text check (char_length(error_message) <= 500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_usage_events_org_idx on public.ai_usage_events (organization_id, created_at desc);
alter table public.ai_usage_events enable row level security;
create policy ai_usage_select on public.ai_usage_events for select to authenticated
  using (organization_id = private.current_org_id() and (user_id = auth.uid() or private.is_super_admin()));
revoke insert, update, delete on public.ai_usage_events from authenticated;

/* Starts a narration or caption job: checks the switch, the person's AI access and their edit access. */
create function public.start_local_ai(p_kind text, p_project uuid, p_model text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  v_id uuid;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or not caller.is_active or caller.role < 'editor' or not caller.can_use_ai then
    raise exception 'AI isn''t switched on for your account' using errcode = '42501';
  end if;
  if p_kind not in ('voiceover', 'transcription') then raise exception 'Unknown AI feature' using errcode = '22023'; end if;
  if not private.ai_feature(case p_kind when 'voiceover' then 'voiceover' else 'captions' end) then
    raise exception '% is switched off for your company', case p_kind when 'voiceover' then 'AI narration' else 'Automatic captions' end using errcode = '42501';
  end if;
  if not private.can_edit_project(p_project) then raise exception 'You can''t edit this video' using errcode = '42501'; end if;
  insert into public.ai_usage_events (organization_id, user_id, project_id, kind, model)
  values (caller.organization_id, caller.id, p_project, p_kind, left(coalesce(p_model, 'local'), 120)) returning id into v_id;
  return v_id;
end $$;

create function public.finish_local_ai(p_id uuid, p_ok boolean, p_error text, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.ai_usage_events set status = case when p_ok then 'succeeded'::public.job_status else 'failed'::public.job_status end,
         error_message = case when p_ok then null else left(p_error, 500) end, details = coalesce(p_details, '{}'::jsonb), finished_at = now()
  where id = p_id and user_id = auth.uid() and status = 'running';
$$;
revoke all on function public.start_local_ai(text, uuid, text) from public, anon;
revoke all on function public.finish_local_ai(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.start_local_ai(text, uuid, text) to authenticated;
grant execute on function public.finish_local_ai(uuid, boolean, text, jsonb) to authenticated;

-- ── Projects: restricted, locked, archived ──────────────────────────────────
alter table public.video_projects
  add column restricted boolean not null default false,
  add column locked boolean not null default false,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null;
create index video_projects_archived_idx on public.video_projects (organization_id) where archived_at is not null;

/*
 * Restricted: only the owner, the people assigned to it and the Super Admin can open it.
 * Locked or archived: read-only for everyone except the Super Admin.
 */
create or replace function private.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.video_projects vp
    where vp.id = p_project
      and vp.organization_id = private.current_org_id()
      and (private.is_super_admin()
           or vp.created_by = auth.uid()
           or exists (select 1 from public.project_members m where m.project_id = vp.id and m.user_id = auth.uid())
           or (private.has_role('admin') and not vp.restricted))
  )
$$;

create or replace function private.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('editor') and exists (
    select 1 from public.video_projects vp
    where vp.id = p_project
      and vp.organization_id = private.current_org_id()
      and (private.is_super_admin()
           or (not vp.locked and vp.archived_at is null
               and (vp.created_by = auth.uid()
                    or exists (select 1 from public.project_members m
                               where m.project_id = vp.id and m.user_id = auth.uid() and m.access = 'editor'))))
  )
$$;

drop policy projects_select on public.video_projects;
create policy projects_select on public.video_projects for select to authenticated
  using (organization_id = private.current_org_id()
         and (private.is_super_admin() or created_by = auth.uid() or private.is_project_member(id)
              or (private.has_role('admin') and not restricted)));

/* Owner, restriction, lock and archive can only change through the admin functions below. */
create function private.protect_project_admin_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.created_by is distinct from old.created_by or new.restricted is distinct from old.restricted
    or new.locked is distinct from old.locked or new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by or new.organization_id is distinct from old.organization_id) then
    raise exception 'Only an administrator can change who owns this video or who can open it' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger video_projects_protect_admin_fields before update on public.video_projects
  for each row execute function private.protect_project_admin_fields();

create function private.admin_caller() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or not caller.is_active or caller.role < 'admin' then
    raise exception 'Only administrators can do this' using errcode = '42501';
  end if;
  return caller;
end $$;

create function private.admin_project(caller public.profiles, p_project uuid) returns public.video_projects
language plpgsql stable security definer set search_path = '' as $$
declare proj public.video_projects;
begin
  select * into proj from public.video_projects where id = p_project;
  if proj.id is null or proj.organization_id <> caller.organization_id
     or (proj.restricted and caller.role <> 'super_admin' and proj.created_by is distinct from caller.id) then
    raise exception 'Video not found' using errcode = 'P0002';
  end if;
  return proj;
end $$;

/* Restrict a video from other administrators (Super Admin) or lock it read-only (administrators). */
create function public.admin_set_project_access(p_project uuid, p_restricted boolean, p_locked boolean) returns public.video_projects
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.admin_caller();
  proj public.video_projects := private.admin_project(caller, p_project);
  v_row public.video_projects;
begin
  if p_restricted is distinct from proj.restricted and caller.role <> 'super_admin' then
    raise exception 'Only the Super Admin can restrict a video from other administrators' using errcode = '42501';
  end if;
  update public.video_projects set restricted = p_restricted, locked = p_locked where id = proj.id returning * into v_row;
  perform private.audit_as(caller.id, caller.organization_id, 'project.access_changed', 'video_project', proj.id::text,
    jsonb_build_object('title', proj.title, 'restricted', jsonb_build_array(proj.restricted, p_restricted), 'locked', jsonb_build_array(proj.locked, p_locked)));
  return v_row;
end $$;

create function private.require_super_admin() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles := private.admin_caller();
begin
  if caller.role <> 'super_admin' then raise exception 'Only the Super Admin can do this' using errcode = '42501'; end if;
  return caller;
end $$;

create function public.admin_archive_project(p_project uuid, p_archived boolean) returns public.video_projects
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.require_super_admin();
  proj public.video_projects := private.admin_project(caller, p_project);
  v_row public.video_projects;
begin
  update public.video_projects set archived_at = case when p_archived then coalesce(proj.archived_at, now()) end,
         archived_by = case when p_archived then caller.id end
  where id = proj.id returning * into v_row;
  perform private.audit_as(caller.id, caller.organization_id, case when p_archived then 'project.archived' else 'project.unarchived' end,
    'video_project', proj.id::text, jsonb_build_object('title', proj.title));
  return v_row;
end $$;

/* Give a video to another employee (who becomes its owner). */
create function public.admin_reassign_project(p_project uuid, p_new_owner uuid) returns public.video_projects
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.require_super_admin();
  proj public.video_projects := private.admin_project(caller, p_project);
  target public.profiles;
  v_row public.video_projects;
begin
  select * into target from public.profiles where id = p_new_owner;
  if target.id is null or target.organization_id <> caller.organization_id then raise exception 'User not found' using errcode = 'P0002'; end if;
  if not target.is_active or target.role < 'editor' then
    raise exception 'This person can''t own videos (they must be an active Editor or above)' using errcode = '42501';
  end if;
  if proj.batch_id is not null then
    -- a video in a batch belongs with its batch owner; reassigning takes it out of the batch
    update public.video_projects set batch_id = null where id = proj.id;
  end if;
  update public.video_projects set created_by = target.id where id = proj.id returning * into v_row;
  -- the new owner no longer needs a separate assignment
  delete from public.project_members where project_id = proj.id and user_id = target.id;
  perform private.audit_as(caller.id, caller.organization_id, 'project.reassigned', 'video_project', proj.id::text,
    jsonb_build_object('title', proj.title, 'from', proj.created_by, 'to', target.id));
  return v_row;
end $$;

/*
 * Permanently deletes a video. The title must be typed back exactly. Returns the
 * stored files so the server can remove them from storage too.
 */
create function public.admin_delete_project(p_project uuid, p_confirm_title text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.require_super_admin();
  proj public.video_projects := private.admin_project(caller, p_project);
  v_files jsonb;
begin
  if btrim(coalesce(p_confirm_title, '')) <> btrim(proj.title) then
    raise exception 'Type the video''s title exactly to delete it' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(distinct f), '[]'::jsonb) into v_files from (
    select jsonb_build_object('bucket', 'video-exports', 'path', r.output_path) f
      from public.render_jobs r where r.project_id = proj.id and r.output_path is not null
    union all
    select jsonb_build_object('bucket', m.bucket, 'path', m.storage_path)
      from public.media_assets m where m.project_id = proj.id
  ) x;
  perform private.audit_as(caller.id, caller.organization_id, 'project.deleted', 'video_project', proj.id::text,
    jsonb_build_object('title', proj.title, 'owner', proj.created_by, 'files', jsonb_array_length(v_files)));
  delete from public.video_projects where id = proj.id;
  return v_files;
end $$;

revoke all on function private.admin_caller() from public, anon;
revoke all on function private.require_super_admin() from public, anon;
revoke all on function private.admin_project(public.profiles, uuid) from public, anon;
grant execute on function private.admin_caller() to authenticated;
grant execute on function private.require_super_admin() to authenticated;
grant execute on function private.admin_project(public.profiles, uuid) to authenticated;
revoke all on function public.admin_set_project_access(uuid, boolean, boolean) from public, anon;
revoke all on function public.admin_archive_project(uuid, boolean) from public, anon;
revoke all on function public.admin_reassign_project(uuid, uuid) from public, anon;
revoke all on function public.admin_delete_project(uuid, text) from public, anon;
grant execute on function public.admin_set_project_access(uuid, boolean, boolean) to authenticated;
grant execute on function public.admin_archive_project(uuid, boolean) to authenticated;
grant execute on function public.admin_reassign_project(uuid, uuid) to authenticated;
grant execute on function public.admin_delete_project(uuid, text) to authenticated;

-- ── Worker heartbeats ───────────────────────────────────────────────────────
create table public.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 120),
  kind text not null check (kind in ('render', 'ai')),
  host text check (char_length(host) <= 120),
  providers text[] not null default '{}',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_job uuid,
  jobs_done integer not null default 0 check (jobs_done >= 0),
  last_error text check (char_length(last_error) <= 500)
);
alter table public.worker_heartbeats enable row level security;
-- workers are shared by every company on this server; people read them through admin_system_health()
revoke all on public.worker_heartbeats from anon, authenticated;

create function public.worker_heartbeat(p_worker text, p_kind text, p_host text, p_providers text[], p_job uuid, p_done integer, p_error text) returns void
language sql security definer set search_path = '' as $$
  insert into public.worker_heartbeats (worker_id, kind, host, providers, current_job, jobs_done, last_error)
  values (left(p_worker, 120), p_kind, left(p_host, 120), coalesce(p_providers, '{}'), p_job, greatest(coalesce(p_done, 0), 0), left(p_error, 500))
  on conflict (worker_id) do update set last_seen_at = now(), kind = excluded.kind, host = excluded.host, providers = excluded.providers,
    current_job = excluded.current_job, jobs_done = excluded.jobs_done, last_error = coalesce(excluded.last_error, public.worker_heartbeats.last_error);
  delete from public.worker_heartbeats where last_seen_at < now() - interval '7 days';
$$;
revoke all on function public.worker_heartbeat(text, text, text, text[], uuid, integer, text) from public, anon, authenticated;
grant execute on function public.worker_heartbeat(text, text, text, text[], uuid, integer, text) to service_role;

-- ── Read-only overviews for administrators ──────────────────────────────────

/* Company dashboard. Spending is shown to the Super Admin only. */
create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller public.profiles := private.admin_caller();
  v_org uuid := caller.organization_id;
  s public.organization_settings;
  v jsonb;
begin
  select * into s from public.organization_settings where organization_id = v_org;
  select jsonb_build_object(
    'users', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'active'),
                'invited', count(*) filter (where status = 'invited'), 'suspended', count(*) filter (where status = 'suspended'),
                'deactivated', count(*) filter (where status = 'deactivated'))
              from public.profiles where organization_id = v_org),
    'listings', (select count(*) from public.listings where organization_id = v_org),
    'projects', (select jsonb_build_object('total', count(*), 'archived', count(*) filter (where archived_at is not null),
                   'this_month', count(*) filter (where created_at >= date_trunc('month', now())))
                 from public.video_projects where organization_id = v_org),
    'videos', (select jsonb_build_object('total', count(*), 'this_month', count(*) filter (where finished_at >= date_trunc('month', now())))
               from public.render_jobs where organization_id = v_org and status = 'succeeded'),
    'render_queue', (select jsonb_build_object('queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
                       'failed_today', count(*) filter (where status = 'failed' and finished_at >= now() - interval '24 hours'),
                       'oldest_queued_seconds', coalesce(extract(epoch from now() - min(created_at) filter (where status = 'queued'))::integer, 0))
                     from public.render_jobs where organization_id = v_org),
    'ai_jobs', (select jsonb_build_object('total', count(*), 'this_month', count(*) filter (where created_at >= date_trunc('month', now())),
                  'queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
                  'failed_month', count(*) filter (where status = 'failed' and created_at >= date_trunc('month', now())))
                from public.generation_jobs where organization_id = v_org),
    'ai_failures_month', (select count(*) from public.generation_jobs where organization_id = v_org and status = 'failed' and created_at >= date_trunc('month', now()))
                       + (select count(*) from public.director_runs where organization_id = v_org and status = 'failed' and created_at >= date_trunc('month', now()))
                       + (select count(*) from public.ai_usage_events where organization_id = v_org and status = 'failed' and created_at >= date_trunc('month', now())),
    'storage', (select jsonb_build_object('bytes', coalesce(sum(size_bytes), 0), 'files', count(*),
                  'by_bucket', coalesce((select jsonb_object_agg(b, n) from (select bucket b, sum(size_bytes) n from public.media_assets
                                         where organization_id = v_org group by bucket) x), '{}'::jsonb))
                from public.media_assets where organization_id = v_org),
    'spend', case when caller.role = 'super_admin' then jsonb_build_object(
                'month_cents', private.ai_spent_this_month(v_org), 'today_cents', private.ai_spent_today(v_org),
                'monthly_budget_cents', s.monthly_ai_budget_cents, 'daily_budget_cents', s.daily_ai_budget_cents,
                'alert_percent', s.ai_budget_alert_percent,
                'by_provider', coalesce((select jsonb_object_agg(p, c) from (
                    select provider p, sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)) c from public.generation_jobs
                     where organization_id = v_org and created_at >= date_trunc('month', now()) and status <> 'cancelled' group by provider
                    union all
                    select 'claude', sum(cost_cents) from public.director_runs where organization_id = v_org and created_at >= date_trunc('month', now())
                  ) x where c is not null), '{}'::jsonb)) end
  ) into v;
  return v;
end $$;

/* One row per person in the company with what they have made and used. */
create function public.admin_user_activity() returns table (
  id uuid, full_name text, email text, role public.app_role, status text, job_title text,
  can_download boolean, can_use_ai boolean, can_batch_generate boolean,
  max_videos_per_month integer, max_ai_generations_per_month integer,
  projects_owned bigint, projects_assigned bigint, listings_owned bigint,
  videos_rendered bigint, videos_this_month bigint, ai_jobs_this_month bigint, ai_generations_total bigint,
  storage_bytes bigint, last_activity_at timestamptz, last_activity text
)
language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles := private.admin_caller();
begin
  return query
  select p.id, p.full_name, p.email, p.role, p.status, p.job_title, p.can_download, p.can_use_ai, p.can_batch_generate,
    p.max_videos_per_month, p.max_ai_generations_per_month,
    (select count(*) from public.video_projects vp where vp.created_by = p.id),
    (select count(*) from public.project_members m where m.user_id = p.id),
    (select count(*) from public.listings l where l.created_by = p.id),
    (select count(*) from public.render_jobs r where r.requested_by = p.id and r.status = 'succeeded'),
    (select count(*) from public.video_projects vp where vp.created_by = p.id and vp.created_at >= date_trunc('month', now())),
    (select count(*) from public.generation_jobs g where g.requested_by = p.id and g.created_at >= date_trunc('month', now())),
    (select count(*) from public.generation_jobs g where g.requested_by = p.id)
      + (select count(*) from public.director_runs d where d.created_by = p.id)
      + (select count(*) from public.ai_usage_events e where e.user_id = p.id),
    (select coalesce(sum(m.size_bytes), 0)::bigint from public.media_assets m where m.uploaded_by = p.id),
    a.created_at, a.action
  from public.profiles p
  left join lateral (select al.created_at, al.action from public.audit_log al
                     where al.actor_id = p.id order by al.id desc limit 1) a on true
  where p.organization_id = caller.organization_id
  order by p.last_name, p.first_name;
end $$;

/* The AI usage log: paid clips, Director runs, narration and captions (Super Admin). */
create function public.admin_ai_usage(p_kind text default null, p_status text default null, p_user uuid default null,
                                      p_before timestamptz default null, p_limit integer default 100)
returns table (id text, at timestamptz, kind text, provider text, model text, user_id uuid, status text,
               cost_cents numeric, error_message text, project_id uuid, listing_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles := private.require_super_admin();
begin
  return query
  select * from (
    select g.id::text, g.created_at, case when g.provider = 'local-depth' then 'depth_clip' else 'video_clip' end, g.provider, g.model,
           g.requested_by, g.status::text, coalesce(g.cost_actual_cents, g.cost_estimate_cents, 0)::numeric, g.error_message, g.project_id, g.listing_id
      from public.generation_jobs g where g.organization_id = caller.organization_id
    union all
    select d.id::text, d.created_at, 'director', 'claude', d.model, d.created_by, d.status::text, d.cost_cents, d.error_message, d.project_id, d.listing_id
      from public.director_runs d where d.organization_id = caller.organization_id
    union all
    select e.id::text, e.created_at, e.kind, e.provider, e.model, e.user_id, e.status::text, 0::numeric, e.error_message, e.project_id, null::uuid
      from public.ai_usage_events e where e.organization_id = caller.organization_id
  ) u (id, at, kind, provider, model, user_id, status, cost_cents, error_message, project_id, listing_id)
  where (p_kind is null or u.kind = p_kind) and (p_status is null or u.status = p_status) and (p_user is null or u.user_id = p_user)
    and (p_before is null or u.at < p_before)
  order by u.at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

/* Queue and worker health (administrators). */
create function public.admin_system_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller public.profiles := private.admin_caller();
  v_org uuid := caller.organization_id;
begin
  return jsonb_build_object(
    'database_time', now(),
    'render', (select jsonb_build_object('queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
                 'failed_24h', count(*) filter (where status = 'failed' and finished_at >= now() - interval '24 hours'),
                 'succeeded_24h', count(*) filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours'),
                 'stuck', count(*) filter (where status = 'running' and started_at < now() - interval '20 minutes'),
                 'oldest_queued_seconds', coalesce(extract(epoch from now() - min(created_at) filter (where status = 'queued'))::integer, 0))
               from public.render_jobs where organization_id = v_org),
    'ai', (select jsonb_build_object('queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
             'failed_24h', count(*) filter (where status = 'failed' and finished_at >= now() - interval '24 hours'),
             'succeeded_24h', count(*) filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours'),
             'stuck', count(*) filter (where status = 'running' and started_at < now() - interval '30 minutes'),
             'oldest_queued_seconds', coalesce(extract(epoch from now() - min(created_at) filter (where status = 'queued'))::integer, 0))
           from public.generation_jobs where organization_id = v_org),
    'recent_failures', coalesce((select jsonb_agg(f order by f->>'at' desc) from (
        select jsonb_build_object('kind', 'render', 'id', r.id, 'project_id', r.project_id, 'at', r.finished_at, 'error', left(r.error_message, 200)) f
          from public.render_jobs r where r.organization_id = v_org and r.status = 'failed' order by r.finished_at desc nulls last limit 10) x), '[]'::jsonb)
      || coalesce((select jsonb_agg(f) from (
        select jsonb_build_object('kind', 'ai', 'id', g.id, 'provider', g.provider, 'at', g.finished_at, 'error', left(g.error_message, 200)) f
          from public.generation_jobs g where g.organization_id = v_org and g.status = 'failed' order by g.finished_at desc nulls last limit 10) y), '[]'::jsonb),
    'workers', coalesce((select jsonb_agg(jsonb_build_object('id', w.worker_id, 'kind', w.kind, 'host', w.host, 'providers', w.providers,
                           'started_at', w.started_at, 'last_seen_at', w.last_seen_at, 'seconds_since_seen', extract(epoch from now() - w.last_seen_at)::integer,
                           'busy', w.current_job is not null, 'jobs_done', w.jobs_done, 'last_error', w.last_error) order by w.kind, w.last_seen_at desc)
                         from public.worker_heartbeats w where w.last_seen_at > now() - interval '1 day'), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_dashboard() from public, anon;
revoke all on function public.admin_user_activity() from public, anon;
revoke all on function public.admin_ai_usage(text, text, uuid, timestamptz, integer) from public, anon;
revoke all on function public.admin_system_health() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_user_activity() to authenticated;
grant execute on function public.admin_ai_usage(text, text, uuid, timestamptz, integer) to authenticated;
grant execute on function public.admin_system_health() to authenticated;

/* Audit entries for AI settings and provider keys written by the app server (Super Admin, re-checked here). */
create function public.record_admin_action(p_action text, p_meta jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare caller public.profiles := private.require_super_admin();
begin
  if p_action !~ '^(ai|provider|claude|settings)\.[a-z_]{2,40}$' then raise exception 'Unknown action' using errcode = '22023'; end if;
  perform private.audit_as(caller.id, caller.organization_id, p_action, 'organization', caller.organization_id::text, coalesce(p_meta, '{}'::jsonb));
end $$;
revoke all on function public.record_admin_action(text, jsonb) from public, anon;
grant execute on function public.record_admin_action(text, jsonb) to authenticated;
