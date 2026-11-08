-- AI Camera Control: a person describes a camera move in plain English and Claude turns it into
-- camera settings. Each request is a small paid Claude call, so it is logged in ai_usage_events
-- (kind 'camera_prompt'), its cost counts toward the company's AI spending ceilings, and it
-- follows the same switches as the AI Director (Claude switched on, the person may use AI and edit
-- the listing). The server writes the cost with the service role; people can't change it.

alter table public.ai_usage_events drop constraint if exists ai_usage_events_kind_check;
alter table public.ai_usage_events add constraint ai_usage_events_kind_check
  check (kind in ('voiceover', 'transcription', 'camera_prompt'));
alter table public.ai_usage_events add column if not exists cost_cents numeric(12, 4) not null default 0 check (cost_cents >= 0);
alter table public.ai_usage_events add column if not exists listing_id uuid references public.listings (id) on delete set null;

create or replace function private.ai_spent_this_month(p_org uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)) from public.generation_jobs
                    where organization_id = p_org and created_at >= date_trunc('month', now()) and status <> 'cancelled'), 0)
       + coalesce((select sum(cost_cents) from public.director_runs
                    where organization_id = p_org and created_at >= date_trunc('month', now())), 0)
       + coalesce((select sum(cost_cents) from public.ai_usage_events
                    where organization_id = p_org and created_at >= date_trunc('month', now())), 0);
$$;

create or replace function private.ai_spent_today(p_org uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)) from public.generation_jobs
                    where organization_id = p_org and created_at >= date_trunc('day', now()) and status <> 'cancelled'), 0)
       + coalesce((select sum(cost_cents) from public.director_runs
                    where organization_id = p_org and created_at >= date_trunc('day', now())), 0)
       + coalesce((select sum(cost_cents) from public.ai_usage_events
                    where organization_id = p_org and created_at >= date_trunc('day', now())), 0);
$$;

/*
 * Starts one "describe your camera movement" request. Checks: the person may use AI, Claude is
 * switched on for the company, they can edit the listing the photo belongs to, the company's AI
 * spending ceilings, and a per-person daily cap (200) so a stuck button can't run up a bill.
 * Returns the usage event id and the company's Claude model.
 */
create or replace function public.start_camera_prompt(p_listing uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  s public.organization_settings;
  v_count integer;
  v_reason text;
  v_id uuid;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or not caller.is_active or caller.role < 'editor' or not caller.can_use_ai then
    raise exception 'AI isn''t switched on for your account' using errcode = '42501';
  end if;
  select * into s from public.organization_settings where organization_id = caller.organization_id;
  if s.organization_id is null or not s.claude_enabled then
    raise exception 'Claude isn''t switched on for your company' using errcode = '42501';
  end if;
  if p_listing is null or not private.can_edit_listing(p_listing) then
    raise exception 'You can''t edit this listing' using errcode = '42501';
  end if;
  select count(*) into v_count from public.ai_usage_events
   where user_id = caller.id and kind = 'camera_prompt' and created_at >= date_trunc('day', now());
  if v_count >= 200 then
    raise exception 'Your daily limit of AI camera requests is reached (200)' using errcode = 'P0001';
  end if;
  v_reason := private.ai_ceiling_reached(caller.organization_id, 0);
  if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
  insert into public.ai_usage_events (organization_id, user_id, listing_id, kind, provider, model)
  values (caller.organization_id, caller.id, p_listing, 'camera_prompt', 'claude', left(coalesce(s.claude_model, 'claude'), 120))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'model', s.claude_model);
end $$;
revoke all on function public.start_camera_prompt(uuid) from public, anon;
grant execute on function public.start_camera_prompt(uuid) to authenticated;

-- The AI usage log shows the cost and listing of these requests too.
create or replace function public.admin_ai_usage(p_kind text default null, p_status text default null, p_user uuid default null,
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
    select e.id::text, e.created_at, e.kind, e.provider, e.model, e.user_id, e.status::text, e.cost_cents::numeric, e.error_message, e.project_id, e.listing_id
      from public.ai_usage_events e where e.organization_id = caller.organization_id
  ) u (id, at, kind, provider, model, user_id, status, cost_cents, error_message, project_id, listing_id)
  where (p_kind is null or u.kind = p_kind) and (p_status is null or u.status = p_status) and (p_user is null or u.user_id = p_user)
    and (p_before is null or u.at < p_before)
  order by u.at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;
