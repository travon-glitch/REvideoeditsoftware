-- ════════════════════════════════════════════════════════════════════════════
-- Stage 5 — Video editor and rendering
--   • Edit plan saved with each project (the editor's model; the FableCut
--     project.json in video_projects.document is generated from it)
--   • Project music: new private bucket "project-media" (<org>/projects/<project>/…)
--   • Render jobs carry the exact document to render + the format, and are
--     claimed by background workers (service role) one at a time
--   • Finished MP4s live in "video-exports" (<org>/projects/<project>/…);
--     downloads need project access + the person's download permission
-- ════════════════════════════════════════════════════════════════════════════

alter table public.video_projects add column edit_plan jsonb;

-- ── Project media (music) ─────────────────────────────────────────────────
alter table public.media_assets drop constraint media_assets_bucket_check;
alter table public.media_assets add constraint media_assets_bucket_check
  check (bucket in ('listing-media', 'brand-assets', 'video-exports', 'project-media'));
alter table public.media_assets add constraint media_assets_project_folder check (
  bucket not in ('project-media', 'video-exports') or project_id is null
  or storage_path like organization_id::text || '/projects/' || project_id::text || '/%');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('project-media', 'project-media', false, 26214400,
     array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'])
on conflict (id) do nothing;

drop policy media_insert on public.media_assets;
drop policy media_update on public.media_assets;
drop policy media_delete on public.media_assets;
create policy media_insert on public.media_assets for insert to authenticated
  with check (organization_id = private.current_org_id() and uploaded_by = auth.uid() and (
           (bucket = 'listing-media' and listing_id is not null and private.can_edit_listing(listing_id))
        or (bucket = 'project-media' and project_id is not null and kind = 'audio' and private.can_edit_project(project_id))
        or (bucket = 'brand-assets' and private.has_role('admin'))));
create policy media_update on public.media_assets for update to authenticated
  using (organization_id = private.current_org_id() and (
           (listing_id is not null and private.can_edit_listing(listing_id))
        or (bucket = 'project-media' and project_id is not null and private.can_edit_project(project_id))
        or (bucket = 'brand-assets' and private.has_role('admin'))))
  with check (organization_id = private.current_org_id());
create policy media_delete on public.media_assets for delete to authenticated
  using (organization_id = private.current_org_id() and (
           (listing_id is not null and private.can_edit_listing(listing_id))
        or (bucket = 'project-media' and project_id is not null and private.can_edit_project(project_id))
        or (bucket = 'brand-assets' and private.has_role('admin'))));

-- Storage: project-media follows project access (read: anyone who can see the project; write: editors).
drop policy storage_select on storage.objects;
create policy storage_select on storage.objects for select to authenticated
  using ((storage.foldername(name))[1] = private.current_org_id()::text and (
           (bucket_id = 'brand-assets')
        or (bucket_id = 'listing-media' and (storage.foldername(name))[2] = 'listings'
            and private.can_read_listing(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'project-media' and (storage.foldername(name))[2] = 'projects'
            and private.can_read_project(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'video-exports' and (storage.foldername(name))[2] = 'projects'
            and private.can_read_project(private.try_uuid((storage.foldername(name))[3]))
            and private.can_download())));

create policy storage_insert_project on storage.objects for insert to authenticated
  with check (bucket_id = 'project-media'
              and (storage.foldername(name))[1] = private.current_org_id()::text
              and (storage.foldername(name))[2] = 'projects'
              and private.can_edit_project(private.try_uuid((storage.foldername(name))[3])));

create policy storage_delete_project on storage.objects for delete to authenticated
  using (bucket_id = 'project-media'
         and (storage.foldername(name))[1] = private.current_org_id()::text
         and (storage.foldername(name))[2] = 'projects'
         and private.can_edit_project(private.try_uuid((storage.foldername(name))[3])));

-- ── Render jobs ───────────────────────────────────────────────────────────
alter table public.render_jobs
  add column aspect text not null default '16:9' check (aspect in ('16:9', '9:16', '1:1')),
  add column document jsonb not null default '{}'::jsonb,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column worker_id text check (char_length(worker_id) <= 120),
  add column output_path text,
  add column duration_seconds numeric(10, 3),
  add column width integer,
  add column height integer,
  add column size_bytes bigint;
create index render_jobs_queue_idx on public.render_jobs (created_at) where status = 'queued';

-- People may queue a render only for a project they can edit, with a real document.
drop policy render_insert on public.render_jobs;
create policy render_insert on public.render_jobs for insert to authenticated
  with check (organization_id = private.current_org_id() and private.can_edit_project(project_id)
              and requested_by = auth.uid() and status = 'queued' and progress = 0
              and output_asset_id is null and output_path is null and attempts = 0 and worker_id is null
              and jsonb_typeof(document -> 'clips') = 'array');

/* A worker takes the oldest queued job. SKIP LOCKED lets several workers run safely. */
create function public.claim_render_job(p_worker text) returns public.render_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs;
begin
  update public.render_jobs set status = 'running', started_at = now(), attempts = attempts + 1,
         worker_id = left(p_worker, 120), progress = 0, error_message = null
  where id = (select id from public.render_jobs where status = 'queued'
              order by created_at for update skip locked limit 1)
  returning * into v_job;
  return v_job;
end $$;

/* Jobs whose worker died are put back in the queue (up to 3 attempts), then failed. */
create function public.requeue_stale_render_jobs(p_older_than_minutes integer default 15) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.render_jobs set
    status = case when attempts >= 3 then 'failed'::public.job_status else 'queued'::public.job_status end,
    error_message = case when attempts >= 3 then 'Rendering stopped responding too many times' else error_message end,
    finished_at = case when attempts >= 3 then now() else finished_at end,
    worker_id = null
  where status = 'running' and started_at < now() - make_interval(mins => p_older_than_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.claim_render_job(text) from public, anon, authenticated;
revoke all on function public.requeue_stale_render_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_render_job(text) to service_role;
grant execute on function public.requeue_stale_render_jobs(integer) to service_role;

-- A finished render becomes the project's latest video; render events are audited.
create function private.on_render_finished() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('succeeded', 'failed') then
    insert into public.audit_log (organization_id, actor_id, action, target_type, target_id, metadata)
    values (new.organization_id, new.requested_by, 'render.' || new.status::text, 'video_project', new.project_id::text,
            jsonb_build_object('render_id', new.id, 'aspect', new.aspect, 'error', new.error_message));
    if new.status = 'succeeded' then
      update public.video_projects set status = 'completed' where id = new.project_id and status <> 'archived';
    end if;
  end if;
  return new;
end $$;
create trigger render_jobs_finished after update on public.render_jobs
  for each row execute function private.on_render_finished();
