-- ════════════════════════════════════════════════════════════════════════════
-- Stage 10 — Six-video generator v2
--   • Licensed music library: built-in original tracks (composed by the app, owned
--     by the company) + tracks admins upload with licence details. Only tracks
--     verified for commercial use are offered or picked automatically.
--   • Batches remember their shape (vertical 1080p by default) and planner
--     (rule-based, or the AI Director after the person confirmed the expected cost).
--   • my_generation_allowance(): what the signed-in person may still generate.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Music library ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music-library', 'music-library', false, 26214400, array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;

alter table public.media_assets drop constraint media_assets_bucket_check;
alter table public.media_assets add constraint media_assets_bucket_check
  check (bucket in ('listing-media', 'brand-assets', 'video-exports', 'project-media', 'ai-clips', 'music-library'));
alter table public.media_assets add constraint media_assets_music_folder check (
  bucket <> 'music-library' or (kind = 'audio' and listing_id is null and project_id is null
                                and storage_path like organization_id::text || '/music/%'));

create table public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asset_id uuid not null unique references public.media_assets (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  artist text check (char_length(artist) <= 120),
  mood text not null check (mood in ('elegant', 'calm', 'upbeat', 'warm', 'inspiring')),
  bpm integer check (bpm between 30 and 240),
  license_type text not null check (license_type in ('original_builtin', 'royalty_free', 'licensed', 'company_owned')),
  license_details text not null check (char_length(license_details) between 3 and 1000),
  license_url text check (char_length(license_url) <= 500),
  commercial_use_verified boolean not null default false,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  builtin_key text check (char_length(builtin_key) <= 60),
  created_at timestamptz not null default now(),
  unique (organization_id, builtin_key),
  constraint music_verified_has_who check (not commercial_use_verified or verified_at is not null)
);
alter table public.music_tracks enable row level security;
create policy music_select on public.music_tracks for select to authenticated
  using (organization_id = private.current_org_id());
create policy music_insert on public.music_tracks for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('admin') and builtin_key is null
              and license_type <> 'original_builtin'
              and (not commercial_use_verified or (verified_by = auth.uid())));
create policy music_update on public.music_tracks for update to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin') and license_type <> 'original_builtin')
  with check (organization_id = private.current_org_id() and license_type <> 'original_builtin'
              and (not commercial_use_verified or verified_by = auth.uid()));
create policy music_delete on public.music_tracks for delete to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin') and license_type <> 'original_builtin');

-- library audio: everyone in the company can use it; admins add / remove it
create policy media_select_music on public.media_assets for select to authenticated
  using (organization_id = private.current_org_id() and bucket = 'music-library');
create policy media_insert_music on public.media_assets for insert to authenticated
  with check (organization_id = private.current_org_id() and bucket = 'music-library' and kind = 'audio'
              and uploaded_by = auth.uid() and private.has_role('admin'));
create policy media_delete_music on public.media_assets for delete to authenticated
  using (organization_id = private.current_org_id() and bucket = 'music-library' and private.has_role('admin')
         and not exists (select 1 from public.music_tracks t where t.asset_id = media_assets.id and t.license_type = 'original_builtin'));

create policy storage_select_music on storage.objects for select to authenticated
  using (bucket_id = 'music-library' and (storage.foldername(name))[1] = private.current_org_id()::text and (storage.foldername(name))[2] = 'music');
create policy storage_insert_music on storage.objects for insert to authenticated
  with check (bucket_id = 'music-library' and (storage.foldername(name))[1] = private.current_org_id()::text
              and (storage.foldername(name))[2] = 'music' and private.has_role('admin'));
create policy storage_delete_music on storage.objects for delete to authenticated
  using (bucket_id = 'music-library' and (storage.foldername(name))[1] = private.current_org_id()::text and private.has_role('admin'));

-- ── Batches v2 ──────────────────────────────────────────────────────────────
alter table public.video_batches
  add column aspect text not null default '9:16' check (aspect in ('16:9', '9:16', '1:1')),
  add column planner text not null default 'rules' check (planner in ('rules', 'ai_director'));

drop function public.start_video_batch(uuid, integer, jsonb);
create function public.start_video_batch(p_listing_id uuid, p_size integer, p_analysis jsonb default '{}'::jsonb,
                                         p_aspect text default '9:16', p_planner text default 'rules') returns public.video_batches
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
  if p_planner = 'ai_director' and not caller.can_use_ai then
    raise exception 'AI isn''t switched on for your account' using errcode = '42501';
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
  insert into public.video_batches (organization_id, listing_id, created_by, size, analysis, aspect, planner)
  values (caller.organization_id, p_listing_id, caller.id, v_size, coalesce(p_analysis, '{}'::jsonb), p_aspect, p_planner) returning * into v_batch;
  perform private.audit(caller.organization_id, 'batch.started', 'video_batch', v_batch.id::text,
    jsonb_build_object('listing', p_listing_id, 'size', v_size, 'aspect', p_aspect, 'planner', p_planner));
  return v_batch;
end $$;
revoke all on function public.start_video_batch(uuid, integer, jsonb, text, text) from public, anon;
grant execute on function public.start_video_batch(uuid, integer, jsonb, text, text) to authenticated;

/* What the signed-in person may still generate (shown before anything starts). */
create function public.my_generation_allowance() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'can_batch', p.can_batch_generate and p.role >= 'editor' and p.is_active,
    'can_use_ai', p.can_use_ai,
    'max_batch_size', coalesce(s.max_batch_size, 6),
    'daily_limit', s.daily_video_limit,
    'used_today', (select count(*) from public.video_projects v where v.created_by = p.id and v.created_at >= date_trunc('day', now())),
    'monthly_limit', p.max_videos_per_month,
    'used_this_month', (select count(*) from public.video_projects v where v.created_by = p.id and v.created_at >= date_trunc('month', now())),
    'concurrent_render_limit', coalesce(s.concurrent_render_limit, 3),
    'director_available', coalesce(s.claude_enabled, false) and p.can_use_ai,
    'claude_model', s.claude_model,
    'ai_budget_left_cents', case when s.monthly_ai_budget_cents is null then null
                                 else greatest(0, s.monthly_ai_budget_cents - private.ai_spent_this_month(p.organization_id)) end)
  from public.profiles p left join public.organization_settings s on s.organization_id = p.organization_id
  where p.id = auth.uid();
$$;
revoke all on function public.my_generation_allowance() from public, anon;
grant execute on function public.my_generation_allowance() to authenticated;

-- Director runs may also plan a whole batch.
alter table public.director_runs drop constraint director_runs_style_check;
alter table public.director_runs add constraint director_runs_style_check
  check (style in ('luxury', 'modern', 'cinematic', 'social', 'open_house', 'listing_tour', 'batch'));
