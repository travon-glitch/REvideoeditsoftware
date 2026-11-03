-- ════════════════════════════════════════════════════════════════════════════
-- Stage 9 — Automatic AI Video Director (Claude)
--   • Super Admin settings: Claude on/off, model, usage limits
--   • organization_secrets: the Claude API key, encrypted by the app server;
--     no person (not even the Super Admin) can read it back through the API
--   • director_runs: every Director run with its photo analysis, storyboard,
--     warnings, token usage and cost
--   • start_director_run(): permission + limit + spending checks
--   • The AI spending ceiling now also counts Claude Director costs
-- ════════════════════════════════════════════════════════════════════════════

alter table public.organization_settings
  add column claude_enabled boolean not null default false,
  add column claude_model text not null default 'claude-opus-5-5'
    check (claude_model in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1')),
  add column claude_monthly_run_limit integer check (claude_monthly_run_limit between 0 and 100000),
  add column claude_daily_runs_per_user integer default 20 check (claude_daily_runs_per_user between 0 and 1000);
grant update (claude_enabled, claude_model, claude_monthly_run_limit, claude_daily_runs_per_user) on public.organization_settings to authenticated;

-- ── Secrets (server-side only) ──────────────────────────────────────────────
create table public.organization_secrets (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (name in ('anthropic_api_key')),
  ciphertext text not null check (char_length(ciphertext) between 20 and 4000),
  last4 text not null check (char_length(last4) = 4),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, name)
);
alter table public.organization_secrets enable row level security;
-- no policies: only the service role (the app server) reads or writes this table
revoke all on public.organization_secrets from anon, authenticated;

/* Admins may see whether a key is set (and its last 4 characters) — never the key. */
create function public.claude_key_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.has_role('admin') then coalesce(
    (select jsonb_build_object('configured', true, 'last4', s.last4, 'updated_at', s.updated_at)
       from public.organization_secrets s where s.organization_id = private.current_org_id() and s.name = 'anthropic_api_key'),
    jsonb_build_object('configured', false)) else null end;
$$;
revoke all on function public.claude_key_status() from public, anon;
grant execute on function public.claude_key_status() to authenticated;

-- ── Director runs ───────────────────────────────────────────────────────────
create table public.director_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  project_id uuid references public.video_projects (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  style text not null check (style in ('luxury', 'modern', 'cinematic', 'social', 'open_house', 'listing_tour')),
  model text not null,
  status public.job_status not null default 'running',
  photo_count integer not null check (photo_count between 1 and 30),
  analysis jsonb,
  storyboard jsonb,
  warnings jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  cost_cents numeric(12, 4) not null default 0 check (cost_cents >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index director_runs_org_idx on public.director_runs (organization_id, created_at desc);
alter table public.director_runs enable row level security;
create policy director_select on public.director_runs for select to authenticated
  using (organization_id = private.current_org_id() and (created_by = auth.uid() or private.has_role('admin')));
-- runs are created with start_director_run() and finished by the app server (service role)
revoke insert, update, delete on public.director_runs from authenticated;

/* AI spend this month (Director runs + paid AI jobs), in cents. */
create function private.ai_spent_this_month(p_org uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)) from public.generation_jobs
                    where organization_id = p_org and created_at >= date_trunc('month', now()) and status <> 'cancelled'), 0)
       + coalesce((select sum(cost_cents) from public.director_runs
                    where organization_id = p_org and created_at >= date_trunc('month', now())), 0);
$$;

/*
 * Starts a Director run after checking: Claude switched on for the company, the
 * person may use AI and edit the listing, the monthly and daily run limits, and
 * the company's AI spending ceiling.
 */
create function public.start_director_run(p_listing_id uuid, p_style text, p_photo_count integer) returns public.director_runs
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  s public.organization_settings;
  v_count integer;
  v_run public.director_runs;
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
  if s.monthly_ai_budget_cents is not null and private.ai_spent_this_month(caller.organization_id) >= s.monthly_ai_budget_cents then
    raise exception 'Monthly AI spending limit reached' using errcode = 'P0001';
  end if;
  insert into public.director_runs (organization_id, listing_id, created_by, style, model, photo_count)
  values (caller.organization_id, p_listing_id, caller.id, p_style, s.claude_model, p_photo_count) returning * into v_run;
  perform private.audit(caller.organization_id, 'director.started', 'director_run', v_run.id::text, jsonb_build_object('listing', p_listing_id, 'style', p_style, 'model', s.claude_model));
  return v_run;
end $$;
revoke all on function public.start_director_run(uuid, text, integer) from public, anon;
grant execute on function public.start_director_run(uuid, text, integer) to authenticated;

-- The spending ceiling for paid AI jobs now counts Director costs too.
create or replace function private.enforce_ai_budget() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_budget integer;
  v_spent numeric;
begin
  select s.monthly_ai_budget_cents into v_budget from public.organization_settings s where s.organization_id = new.organization_id;
  if v_budget is not null then
    v_spent := private.ai_spent_this_month(new.organization_id);
    -- the local depth method runs on our own server and costs nothing; paid providers stop at the ceiling
    if new.provider <> 'local-depth' and (v_spent >= v_budget or v_spent + coalesce(new.cost_estimate_cents, 0) > v_budget) then
      raise exception 'Monthly AI spending limit reached' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

/* Can people in my company use the AI Director? (Editors can't read company settings directly.) */
create function public.director_available() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.claude_enabled from public.organization_settings s where s.organization_id = private.current_org_id()), false);
$$;
revoke all on function public.director_available() from public, anon;
grant execute on function public.director_available() to authenticated;
