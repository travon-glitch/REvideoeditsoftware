-- Stage 12: portrait 4:5 exports (renders and batches); narration and caption data live in the
-- project's edit plan, narration audio in project-media (kind audio, the project's own folder).
alter table public.render_jobs drop constraint if exists render_jobs_aspect_check;
alter table public.render_jobs add constraint render_jobs_aspect_check check (aspect in ('16:9', '9:16', '1:1', '4:5'));
alter table public.video_batches drop constraint if exists video_batches_aspect_check;
alter table public.video_batches add constraint video_batches_aspect_check check (aspect in ('16:9', '9:16', '1:1', '4:5'));

-- "I am authorised to use this audio": recorded in the activity log for project audio the person added.
create function public.record_audio_authorization(p_asset uuid, p_purpose text) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select id, organization_id, project_id, file_name into a from public.media_assets
  where id = p_asset and uploaded_by = auth.uid() and kind = 'audio' and bucket = 'project-media';
  if a.id is null then raise exception 'Audio not found'; end if;
  perform private.audit(a.organization_id, case when p_purpose = 'narration' then 'narration.upload' else 'music.upload_authorized' end,
    'media_asset', a.id::text, jsonb_build_object('file_name', a.file_name, 'project', a.project_id, 'authorized', true));
end $$;
revoke execute on function public.record_audio_authorization(uuid, text) from public, anon;
grant execute on function public.record_audio_authorization(uuid, text) to authenticated;
