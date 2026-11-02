-- ════════════════════════════════════════════════════════════════════════════
-- Stage 8 — "Generate 6 Videos"
--   • video_batches: one run of the generator for a listing; each video is a
--     normal video project (batch_id, batch_type) with its own render job, so
--     one failure never stops the others and only failed videos are retried
--   • Super Admin controls: maximum batch size, concurrent render limit,
--     daily generation limit, per-person batch permission, AI spending ceiling
--   • The render queue respects each company's concurrent render limit
--   • Company library: finished videos everyone in the company can watch
-- ════════════════════════════════════════════════════════════════════════════

-- ── Super Admin settings ────────────────────────────────────────────────────
alter table public.organization_settings
  add column max_batch_size integer not null default 6 check (max_batch_size between 1 and 12),
  add column concurrent_render_limit integer not null default 3 check (concurrent_render_limit between 1 and 50),
  add column daily_video_limit integer check (daily_video_limit between 0 and 1000);
grant update (max_batch_size, concurrent_render_limit, daily_video_limit) on public.organization_settings to authenticated;
-- (settings_update policy: Super Admin only)

alter table public.profiles add column can_batch_generate boolean not null default true;

/* Super Admin: allow or stop one person from using "Generate 6 Videos". */
create function public.admin_set_batch_permission(p_user_id uuid, p_allowed boolean) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  updated public.profiles;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or caller.role <> 'super_admin' or not caller.is_active then
    raise exception 'Only the Super Admin can change batch permissions' using errcode = '42501';
  end if;
  update public.profiles set can_batch_generate = p_allowed
  where id = p_user_id and organization_id = caller.organization_id returning * into updated;
  if updated.id is null then raise exception 'Person not found' using errcode = '42501'; end if;
  perform private.audit(caller.organization_id, 'user.batch_permission', 'profile', p_user_id::text, jsonb_build_object('allowed', p_allowed));
  return updated;
end $$;
revoke all on function public.admin_set_batch_permission(uuid, boolean) from public, anon;
grant execute on function public.admin_set_batch_permission(uuid, boolean) to authenticated;

-- ── Daily generation limit (all new videos, per person) ─────────────────────
create function private.enforce_daily_video_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_used integer;
begin
  select s.daily_video_limit into v_limit from public.organization_settings s where s.organization_id = new.organization_id;
  if v_limit is not null then
    select count(*) into v_used from public.video_projects
    where created_by = new.created_by and created_at >= date_trunc('day', now());
    if v_used >= v_limit then
      raise exception 'Daily video limit reached (% per day)', v_limit using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger video_projects_daily_limit before insert on public.video_projects
  for each row execute function private.enforce_daily_video_limit();

-- ── AI spending ceiling (monthly, company-wide) ─────────────────────────────
create function private.enforce_ai_budget() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_budget integer;
  v_spent bigint;
begin
  select s.monthly_ai_budget_cents into v_budget from public.organization_settings s where s.organization_id = new.organization_id;
  if v_budget is not null then
    select coalesce(sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)), 0) into v_spent
    from public.generation_jobs
    where organization_id = new.organization_id and created_at >= date_trunc('month', now()) and status <> 'cancelled';
    -- the local depth method runs on our own server and costs nothing; paid providers stop at the ceiling
    if new.provider <> 'local-depth' and (v_spent >= v_budget or v_spent + coalesce(new.cost_estimate_cents, 0) > v_budget) then
      raise exception 'Monthly AI spending limit reached' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger generation_jobs_budget before insert on public.generation_jobs
  for each row execute function private.enforce_ai_budget();

-- ── Batches ─────────────────────────────────────────────────────────────────
create table public.video_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  size integer not null check (size between 1 and 12),
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index video_batches_org_idx on public.video_batches (organization_id, created_at desc);
alter table public.video_batches enable row level security;
create policy batches_select on public.video_batches for select to authenticated
  using (organization_id = private.current_org_id() and (created_by = auth.uid() or private.has_role('admin')));
revoke insert, update, delete on public.video_batches from authenticated;

alter table public.video_projects
  add column batch_id uuid references public.video_batches (id) on delete set null,
  add column batch_type text check (char_length(batch_type) <= 40),
  add column batch_variation integer not null default 0 check (batch_variation between 0 and 1000);
create index video_projects_batch_idx on public.video_projects (batch_id) where batch_id is not null;

/* A project can join only a batch its creator started. */
create function private.check_batch_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.batch_id is not null and (tg_op = 'INSERT' or new.batch_id is distinct from old.batch_id) and not exists (
    select 1 from public.video_batches b where b.id = new.batch_id and b.created_by = new.created_by and b.organization_id = new.organization_id) then
    raise exception 'That batch belongs to someone else' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger video_projects_batch_owner before insert or update on public.video_projects
  for each row execute function private.check_batch_owner();

/*
 * Starts a batch after checking: editor role, the person's batch permission,
 * edit access to the listing, the company's maximum batch size and the daily limit.
 */
create function public.start_video_batch(p_listing_id uuid, p_size integer, p_analysis jsonb default '{}'::jsonb) returns public.video_batches
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  s public.organization_settings;
  v_used integer;
  v_size integer;
  v_batch public.video_batches;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or not caller.is_active or caller.role < 'editor' then
    raise exception 'You can''t generate videos' using errcode = '42501';
  end if;
  if not caller.can_batch_generate then
    raise exception 'Generate 6 Videos isn''t switched on for your account' using errcode = '42501';
  end if;
  if not private.can_edit_listing(p_listing_id) then
    raise exception 'You can''t make videos from this listing' using errcode = '42501';
  end if;
  select * into s from public.organization_settings where organization_id = caller.organization_id;
  if p_size < 1 then raise exception 'A batch needs at least one video' using errcode = '22023'; end if;
  -- the company's maximum batch size caps the request (the first N video types are made)
  v_size := least(p_size, coalesce(s.max_batch_size, 6));
  if s.daily_video_limit is not null then
    select count(*) into v_used from public.video_projects where created_by = caller.id and created_at >= date_trunc('day', now());
    if v_used + v_size > s.daily_video_limit then
      raise exception 'Daily video limit reached (% per day, % left today)', s.daily_video_limit, greatest(0, s.daily_video_limit - v_used) using errcode = 'P0001';
    end if;
  end if;
  insert into public.video_batches (organization_id, listing_id, created_by, size, analysis)
  values (caller.organization_id, p_listing_id, caller.id, v_size, coalesce(p_analysis, '{}'::jsonb)) returning * into v_batch;
  perform private.audit(caller.organization_id, 'batch.started', 'video_batch', v_batch.id::text, jsonb_build_object('listing', p_listing_id, 'size', v_size));
  return v_batch;
end $$;
revoke all on function public.start_video_batch(uuid, integer, jsonb) from public, anon;
grant execute on function public.start_video_batch(uuid, integer, jsonb) to authenticated;

-- ── Render queue: respect each company's concurrent render limit ────────────
create or replace function public.claim_render_job(p_worker text) returns public.render_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs;
begin
  -- one claim at a time, so the per-company running count can't be exceeded by racing workers
  perform pg_advisory_xact_lock(hashtext('lvs.claim_render_job'));
  update public.render_jobs set status = 'running', started_at = now(), attempts = attempts + 1,
         worker_id = left(p_worker, 120), progress = 0, error_message = null
  where id = (
    select j.id from public.render_jobs j
    left join public.organization_settings s on s.organization_id = j.organization_id
    where j.status = 'queued'
      and (select count(*) from public.render_jobs r where r.organization_id = j.organization_id and r.status = 'running')
          < coalesce(s.concurrent_render_limit, 3)
    order by j.created_at
    for update of j skip locked
    limit 1)
  returning * into v_job;
  return v_job;
end $$;

-- ── Company library ─────────────────────────────────────────────────────────
create table public.library_videos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  render_job_id uuid not null unique references public.render_jobs (id) on delete cascade,
  project_id uuid references public.video_projects (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  aspect text not null,
  duration_seconds numeric(10, 3),
  output_path text not null,
  saved_by uuid references public.profiles (id) on delete set null,
  saved_at timestamptz not null default now()
);
create index library_videos_org_idx on public.library_videos (organization_id, saved_at desc);
alter table public.library_videos enable row level security;

-- Everyone in the company sees the library.
create policy library_select on public.library_videos for select to authenticated
  using (organization_id = private.current_org_id());
-- Saving: a finished render of a project you can see; path and facts must match the render.
create policy library_insert on public.library_videos for insert to authenticated
  with check (organization_id = private.current_org_id() and saved_by = auth.uid() and private.has_role('editor')
              and exists (select 1 from public.render_jobs r
                          where r.id = render_job_id and r.status = 'succeeded' and r.organization_id = library_videos.organization_id
                            and r.output_path = library_videos.output_path and r.project_id = library_videos.project_id
                            and private.can_read_project(r.project_id)));
create policy library_delete on public.library_videos for delete to authenticated
  using (organization_id = private.current_org_id() and (saved_by = auth.uid() or private.has_role('admin')));

-- Library files can be downloaded by anyone in the company who may download.
drop policy storage_select on storage.objects;
create policy storage_select on storage.objects for select to authenticated
  using ((storage.foldername(name))[1] = private.current_org_id()::text and (
           (bucket_id = 'brand-assets')
        or (bucket_id in ('listing-media', 'ai-clips') and (storage.foldername(name))[2] = 'listings'
            and private.can_read_listing(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'project-media' and (storage.foldername(name))[2] = 'projects'
            and private.can_read_project(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'video-exports' and (storage.foldername(name))[2] = 'projects' and private.can_download()
            and (private.can_read_project(private.try_uuid((storage.foldername(name))[3]))
                 or exists (select 1 from public.library_videos lv
                            where lv.output_path = name and lv.organization_id = private.current_org_id())))));
