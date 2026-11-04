-- ════════════════════════════════════════════════════════════════════════════
-- Stage 14 — Production hardening
--
--   • Anonymous visitors get no table privileges at all (Row-Level Security
--     already returned nothing to them; this removes the privileges too).
--   • Indexes for the queries the app and the usage-limit checks run most:
--     per-person monthly counts, a video's renders, the activity feed, storage
--     download checks for library videos.
-- ════════════════════════════════════════════════════════════════════════════

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- usage limits count a person's videos / AI jobs / Director runs this month on every request
create index if not exists video_projects_creator_idx on public.video_projects (created_by, created_at desc);
create index if not exists generation_jobs_requester_idx on public.generation_jobs (requested_by, created_at desc);
create index if not exists director_runs_creator_idx on public.director_runs (created_by, created_at desc);
create index if not exists ai_usage_events_user_idx on public.ai_usage_events (user_id, created_at desc);

-- a video's renders (video page, editor, library) and renders per person
create index if not exists render_jobs_project_idx on public.render_jobs (project_id, created_at desc);
create index if not exists render_jobs_requester_idx on public.render_jobs (requested_by) where status = 'succeeded';

-- listing pages, AI clips per listing, project lookups by listing
create index if not exists video_projects_listing_idx on public.video_projects (listing_id);
create index if not exists generation_jobs_listing_idx on public.generation_jobs (listing_id, created_at desc);
create index if not exists listings_creator_idx on public.listings (created_by);
create index if not exists media_assets_uploader_idx on public.media_assets (uploaded_by);
create index if not exists media_assets_source_idx on public.media_assets (source_asset_id) where source_asset_id is not null;

-- people's last activity (admin) and the storage policy's library-video check (every download)
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, id desc);
create index if not exists library_videos_path_idx on public.library_videos (output_path);

-- New photos: JPG, PNG or WebP only. HEIC can't be shown by the video renderer (Chrome);
-- iPhones convert to JPG automatically when the upload doesn't ask for HEIC.
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
where id = 'listing-media';

-- ── Render jobs are queued only by the app server ──────────────────────────
-- The app checks edit access, applies the company's branding rules and validates the video before it
-- queues a render. People could previously insert render jobs straight through the database API and
-- skip those checks; now only the server (service role) can.
drop policy if exists render_insert on public.render_jobs;
revoke insert on public.render_jobs from authenticated;

/* Every render, whoever queues it, stays within what the company's videos need. */
create function private.check_render_size() returns trigger
language plpgsql set search_path = '' as $$
declare
  w numeric := coalesce((new.document ->> 'width')::numeric, 0);
  h numeric := coalesce((new.document ->> 'height')::numeric, 0);
  fps numeric := coalesce((new.document ->> 'fps')::numeric, 30);
  len numeric;
begin
  if jsonb_typeof(new.document -> 'clips') <> 'array' then
    raise exception 'This video has no timeline' using errcode = '22023';
  end if;
  select coalesce(max(coalesce((c ->> 'start')::numeric, 0) + coalesce((c ->> 'duration')::numeric, 0)), 0) into len
    from jsonb_array_elements(new.document -> 'clips') c;
  if w > 2160 or h > 2160 or w < 0 or h < 0 or fps > 60 or fps <= 0 then
    raise exception 'This video is too large to make (at most 2160 pixels and 60 frames a second)' using errcode = '22023';
  end if;
  if len > 600 then
    raise exception 'This video is too long to make (at most 10 minutes)' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger render_jobs_size before insert on public.render_jobs
  for each row execute function private.check_render_size();
