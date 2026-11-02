-- ════════════════════════════════════════════════════════════════════════════
-- Stage 7 — Cinematic Camera Control Studio
--   • A photo can carry its own camera move (used by every video of the listing)
--   • AI clips (depth or generative) live in a private "ai-clips" bucket; only
--     the AI worker (service role) can create them
--   • Every AI clip keeps a link to its source photo and an accuracy review;
--     people can approve it or report a problem
--   • generation_jobs gets a real queue (claim / requeue) for the AI worker
--   • render_jobs get a short label (camera clip exports)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Media ────────────────────────────────────────────────────────────────────
alter table public.media_assets
  add column camera_spec jsonb check (camera_spec is null or (jsonb_typeof(camera_spec) = 'object' and pg_column_size(camera_spec) < 8000)),
  add column source_asset_id uuid references public.media_assets (id) on delete set null,
  add column generation_job_id uuid references public.generation_jobs (id) on delete set null,
  add column ai_review jsonb,
  add column ai_decision jsonb;

alter table public.media_assets drop constraint media_assets_bucket_check;
alter table public.media_assets add constraint media_assets_bucket_check
  check (bucket in ('listing-media', 'brand-assets', 'video-exports', 'project-media', 'ai-clips'));
alter table public.media_assets drop constraint media_assets_listing_folder;
alter table public.media_assets add constraint media_assets_listing_folder check (
  bucket not in ('listing-media', 'ai-clips') or listing_id is null
  or storage_path like organization_id::text || '/listings/' || listing_id::text || '/%');
alter table public.media_assets add constraint media_assets_ai_clip_bucket check ((kind = 'ai_clip') = (bucket = 'ai-clips'));
alter table public.media_assets add constraint media_assets_camera_on_photos check (camera_spec is null or kind = 'photo');

-- People may not create AI clips themselves (only the AI worker does).
drop policy media_insert on public.media_assets;
create policy media_insert on public.media_assets for insert to authenticated
  with check (organization_id = private.current_org_id() and uploaded_by = auth.uid() and kind <> 'ai_clip' and (
           (bucket = 'listing-media' and listing_id is not null and private.can_edit_listing(listing_id))
        or (bucket = 'project-media' and project_id is not null and kind = 'audio' and private.can_edit_project(project_id))
        or (bucket = 'brand-assets' and private.has_role('admin'))));

/* AI clip facts (source, review, decision) can't be edited by people directly; decisions go through review_ai_clip(). */
create function private.protect_ai_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (
       new.kind is distinct from old.kind or new.bucket is distinct from old.bucket
    or new.source_asset_id is distinct from old.source_asset_id or new.generation_job_id is distinct from old.generation_job_id
    or new.ai_review is distinct from old.ai_review or new.ai_decision is distinct from old.ai_decision
    or (old.kind = 'ai_clip' and new.storage_path is distinct from old.storage_path)) then
    raise exception 'These details of an AI clip can''t be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger media_assets_protect_ai before update on public.media_assets
  for each row execute function private.protect_ai_fields();

/* Approve an AI clip, or report a problem with it (e.g. a changed window or roof line). */
create function public.review_ai_clip(p_asset uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.media_assets;
  v_decision jsonb;
begin
  if p_decision not in ('approved', 'problem') then raise exception 'Unknown decision' using errcode = '22023'; end if;
  select * into v_asset from public.media_assets where id = p_asset;
  if v_asset.id is null or v_asset.kind <> 'ai_clip' or v_asset.organization_id <> private.current_org_id()
     or not private.can_edit_listing(v_asset.listing_id) then
    raise exception 'AI clip not found' using errcode = '42501';
  end if;
  v_decision := jsonb_build_object('status', p_decision, 'note', left(coalesce(p_note, ''), 500), 'by', auth.uid(), 'at', now());
  update public.media_assets set ai_decision = v_decision where id = p_asset;
  perform private.audit(v_asset.organization_id, 'ai_clip.' || p_decision, 'media_asset', p_asset::text, v_decision);
  return v_decision;
end $$;
revoke all on function public.review_ai_clip(uuid, text, text) from public, anon;
grant execute on function public.review_ai_clip(uuid, text, text) to authenticated;

-- ── Storage: the private ai-clips bucket ─────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-clips', 'ai-clips', false, 209715200, array['video/mp4'])
on conflict (id) do nothing;

drop policy storage_select on storage.objects;
create policy storage_select on storage.objects for select to authenticated
  using ((storage.foldername(name))[1] = private.current_org_id()::text and (
           (bucket_id = 'brand-assets')
        or (bucket_id in ('listing-media', 'ai-clips') and (storage.foldername(name))[2] = 'listings'
            and private.can_read_listing(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'project-media' and (storage.foldername(name))[2] = 'projects'
            and private.can_read_project(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'video-exports' and (storage.foldername(name))[2] = 'projects'
            and private.can_read_project(private.try_uuid((storage.foldername(name))[3]))
            and private.can_download())));

-- Listing editors may delete AI clips of their listing (no insert policy: only the worker writes there).
create policy storage_delete_ai_clips on storage.objects for delete to authenticated
  using (bucket_id = 'ai-clips'
         and (storage.foldername(name))[1] = private.current_org_id()::text
         and (storage.foldername(name))[2] = 'listings'
         and private.can_edit_listing(private.try_uuid((storage.foldername(name))[3])));

-- ── AI generation queue ─────────────────────────────────────────────────────
alter table public.generation_jobs
  add column progress numeric(4, 3) not null default 0 check (progress between 0 and 1),
  add column attempts integer not null default 0 check (attempts >= 0),
  add column worker_id text check (char_length(worker_id) <= 120),
  add column review jsonb;
create index generation_jobs_queue_idx on public.generation_jobs (created_at) where status = 'queued';

/*
 * Who may start an AI camera job:
 *  - people with AI access (can_use_ai) who can edit the listing,
 *  - from a photo of that listing,
 *  - the local depth method always; external (generative) providers only when
 *    the company has switched AI on (photos leave the company's servers and it costs money).
 */
/* Has the company switched on external AI providers? (Readable by everyone in the company through this check only.) */
create function private.org_ai_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.ai_enabled from public.organization_settings s where s.organization_id = private.current_org_id()), false);
$$;
revoke all on function private.org_ai_enabled() from public, anon;
grant execute on function private.org_ai_enabled() to authenticated, service_role;

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
              and (provider = 'local-depth' or private.org_ai_enabled()));

create function public.claim_generation_job(p_worker text, p_providers text[]) returns public.generation_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.generation_jobs;
begin
  update public.generation_jobs set status = 'running', started_at = now(), attempts = attempts + 1,
         worker_id = left(p_worker, 120), progress = 0, error_message = null
  where id = (select id from public.generation_jobs where status = 'queued' and provider = any (p_providers)
              order by created_at for update skip locked limit 1)
  returning * into v_job;
  return v_job;
end $$;

create function public.requeue_stale_generation_jobs(p_older_than_minutes integer default 30) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.generation_jobs set
    status = case when attempts >= 2 then 'failed'::public.job_status else 'queued'::public.job_status end,
    error_message = case when attempts >= 2 then 'The AI clip stopped responding too many times' else error_message end,
    finished_at = case when attempts >= 2 then now() else finished_at end,
    worker_id = null
  where status = 'running' and started_at < now() - make_interval(mins => p_older_than_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.claim_generation_job(text, text[]) from public, anon, authenticated;
revoke all on function public.requeue_stale_generation_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_generation_job(text, text[]) to service_role;
grant execute on function public.requeue_stale_generation_jobs(integer) to service_role;

-- ── Render labels (camera clip exports) ─────────────────────────────────────
alter table public.render_jobs add column label text check (char_length(label) <= 120);
