-- ════════════════════════════════════════════════════════════════════════════
-- Stage 3 — Admin-controlled user accounts and per-project access
--
--   • Role "creator" becomes "editor" (viewer < editor < admin < super_admin)
--   • Account status: invited → active ⇄ suspended → deactivated
--   • Per-user permissions (download, AI) and monthly usage limits
--   • Projects and listings are PRIVATE: owner + assigned users + admins
--     (admins read and assign; only the Super Admin edits everything)
--   • Files in Storage follow the same rules (photos via listing access,
--     exports via project access + download permission)
--   • Every account / role / status / permission / assignment change is audited
-- ════════════════════════════════════════════════════════════════════════════

alter type public.app_role rename value 'creator' to 'editor';

-- ── Profiles: names, status, permissions, limits ───────────────────────────
alter table public.profiles
  add column first_name text not null default '' check (char_length(first_name) <= 60),
  add column last_name text not null default '' check (char_length(last_name) <= 60),
  add column job_title text check (char_length(job_title) <= 100),
  add column status text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'deactivated')),
  add column status_changed_at timestamptz not null default now(),
  add column can_download boolean not null default true,
  add column can_use_ai boolean not null default true,
  add column max_videos_per_month integer check (max_videos_per_month between 0 and 10000),
  add column max_ai_generations_per_month integer check (max_ai_generations_per_month between 0 and 100000),
  add column invited_by uuid references public.profiles (id) on delete set null;

update public.profiles set
  status = case when is_active then 'active' else 'suspended' end,
  first_name = split_part(btrim(full_name), ' ', 1),
  last_name = btrim(substr(btrim(full_name), char_length(split_part(btrim(full_name), ' ', 1)) + 1));

-- is_active is now derived from status (invited people may sign in once they accept)
alter table public.profiles drop column is_active;
alter table public.profiles add column is_active boolean generated always as (status in ('invited', 'active')) stored;

alter table public.profiles alter column role set default 'editor';

create function private.profiles_derive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if btrim(new.first_name || new.last_name) <> '' then
    new.full_name := btrim(btrim(new.first_name) || ' ' || btrim(new.last_name));
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;
create trigger profiles_derive before insert or update on public.profiles
  for each row execute function private.profiles_derive();

-- people may edit only their own display fields
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, ui_mode, avatar_path) on public.profiles to authenticated;

-- ── Company settings (Super Admin) ─────────────────────────────────────────
create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  ai_enabled boolean not null default false,
  monthly_ai_budget_cents integer check (monthly_ai_budget_cents >= 0),
  default_max_videos_per_month integer check (default_max_videos_per_month between 0 and 10000),
  default_max_ai_generations_per_month integer check (default_max_ai_generations_per_month between 0 and 100000),
  viewers_can_download_by_default boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger organization_settings_touch before update on public.organization_settings
  for each row execute function private.touch_updated_at();
insert into public.organization_settings (organization_id) select id from public.organizations on conflict do nothing;

revoke insert, delete on public.organization_settings from authenticated;
revoke update on public.organization_settings from authenticated;
grant update (ai_enabled, monthly_ai_budget_cents, default_max_videos_per_month,
              default_max_ai_generations_per_month, viewers_can_download_by_default, updated_by)
  on public.organization_settings to authenticated;

-- ── Project assignments ────────────────────────────────────────────────────
create table public.project_members (
  project_id uuid not null references public.video_projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  access text not null default 'viewer' check (access in ('viewer', 'editor')),
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);
revoke insert, update, delete on public.project_members from authenticated;

-- render / AI outputs belong to a project
alter table public.media_assets add column project_id uuid references public.video_projects (id) on delete cascade;
create index media_assets_project_idx on public.media_assets (project_id);

-- ════════════════════════════════════════════════════════════════════════════
-- Access helpers (SECURITY DEFINER: they read tables without recursing into RLS)
-- ════════════════════════════════════════════════════════════════════════════
create function private.try_uuid(p text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

create function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_app_role() = 'super_admin', false)
$$;

create function private.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.video_projects vp
    where vp.id = p_project
      and vp.organization_id = private.current_org_id()
      and (private.has_role('admin')
           or vp.created_by = auth.uid()
           or exists (select 1 from public.project_members m where m.project_id = vp.id and m.user_id = auth.uid()))
  )
$$;

create function private.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('editor') and exists (
    select 1 from public.video_projects vp
    where vp.id = p_project
      and vp.organization_id = private.current_org_id()
      and (private.is_super_admin()
           or vp.created_by = auth.uid()
           or exists (select 1 from public.project_members m
                      where m.project_id = vp.id and m.user_id = auth.uid() and m.access = 'editor'))
  )
$$;

create function private.can_read_listing(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings l
    where l.id = p_listing
      and l.organization_id = private.current_org_id()
      and (private.has_role('admin')
           or l.created_by = auth.uid()
           or exists (select 1 from public.video_projects vp
                      where vp.listing_id = l.id and private.can_read_project(vp.id)))
  )
$$;

create function private.can_edit_listing(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('editor') and exists (
    select 1 from public.listings l
    where l.id = p_listing
      and l.organization_id = private.current_org_id()
      and (private.is_super_admin()
           or l.created_by = auth.uid()
           or exists (select 1 from public.video_projects vp
                      where vp.listing_id = l.id and private.can_edit_project(vp.id)))
  )
$$;

create function private.can_download() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.can_download from public.profiles p where p.id = auth.uid() and p.is_active), false)
$$;

create function private.can_use_ai() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.can_use_ai from public.profiles p where p.id = auth.uid() and p.is_active), false)
     and private.has_role('editor')
$$;

create function private.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid())
$$;

/* A listing is shared with you when you can read a project made from it. */
create function private.listing_shared_with_me(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.video_projects vp
                 where vp.listing_id = p_listing and private.can_read_project(vp.id))
$$;

grant execute on function private.is_project_member(uuid), private.listing_shared_with_me(uuid) to authenticated, service_role;
grant execute on function private.try_uuid(text), private.is_super_admin(), private.can_read_project(uuid),
  private.can_edit_project(uuid), private.can_read_listing(uuid), private.can_edit_listing(uuid),
  private.can_download(), private.can_use_ai() to authenticated, service_role;

-- Re-check helper functions defined in stage 2 against the new status column
create or replace function private.current_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organization_id from public.profiles p where p.id = auth.uid() and p.is_active
$$;
create or replace function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

-- What the signed-in person may do with a listing / project ('none' | 'read' | 'edit'); used by the UI
create function public.listing_access(p_listing uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when private.can_edit_listing(p_listing) then 'edit'
              when private.can_read_listing(p_listing) then 'read' else 'none' end
$$;
create function public.project_access(p_project uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when private.can_edit_project(p_project) then 'edit'
              when private.can_read_project(p_project) then 'read' else 'none' end
$$;
revoke all on function public.listing_access(uuid), public.project_access(uuid) from public, anon;
grant execute on function public.listing_access(uuid), public.project_access(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security: replace company-wide rules with per-project rules
-- ════════════════════════════════════════════════════════════════════════════
drop policy profiles_select on public.profiles;
drop policy profiles_update_self on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (organization_id = private.current_org_id() and private.has_role('admin')));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and private.current_org_id() is not null)
  with check (id = auth.uid());

drop policy listings_select on public.listings;
drop policy listings_insert on public.listings;
drop policy listings_update on public.listings;
drop policy listings_delete on public.listings;
-- Row columns are checked directly (not via can_read_listing(id)) so INSERT … RETURNING
-- can see the row it just created.
create policy listings_select on public.listings for select to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or created_by = auth.uid() or private.listing_shared_with_me(id)));
create policy listings_insert on public.listings for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('editor') and created_by = auth.uid());
create policy listings_update on public.listings for update to authenticated
  using (private.can_edit_listing(id))
  with check (organization_id = private.current_org_id());
create policy listings_delete on public.listings for delete to authenticated
  using (organization_id = private.current_org_id()
         and (private.is_super_admin() or (private.has_role('editor') and created_by = auth.uid())));

drop policy media_select on public.media_assets;
drop policy media_insert on public.media_assets;
drop policy media_update on public.media_assets;
drop policy media_delete on public.media_assets;
create policy media_select on public.media_assets for select to authenticated
  using (organization_id = private.current_org_id() and (
           (bucket = 'brand-assets')
        or (listing_id is not null and private.can_read_listing(listing_id))
        or (project_id is not null and private.can_read_project(project_id))));
create policy media_insert on public.media_assets for insert to authenticated
  with check (organization_id = private.current_org_id() and uploaded_by = auth.uid() and (
           (bucket = 'listing-media' and listing_id is not null and private.can_edit_listing(listing_id))
        or (bucket = 'brand-assets' and private.has_role('admin'))));
create policy media_update on public.media_assets for update to authenticated
  using (organization_id = private.current_org_id() and (
           (listing_id is not null and private.can_edit_listing(listing_id))
        or (bucket = 'brand-assets' and private.has_role('admin'))))
  with check (organization_id = private.current_org_id());
create policy media_delete on public.media_assets for delete to authenticated
  using (organization_id = private.current_org_id() and (
           (listing_id is not null and private.can_edit_listing(listing_id))
        or (bucket = 'brand-assets' and private.has_role('admin'))));

drop policy projects_select on public.video_projects;
drop policy projects_insert on public.video_projects;
drop policy projects_update on public.video_projects;
drop policy projects_delete on public.video_projects;
create policy projects_select on public.video_projects for select to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or created_by = auth.uid() or private.is_project_member(id)));
create policy projects_insert on public.video_projects for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('editor') and created_by = auth.uid()
              and (listing_id is null or private.can_read_listing(listing_id)));
create policy projects_update on public.video_projects for update to authenticated
  using (private.can_edit_project(id))
  with check (organization_id = private.current_org_id());
create policy projects_delete on public.video_projects for delete to authenticated
  using (organization_id = private.current_org_id()
         and (private.is_super_admin() or (private.has_role('editor') and created_by = auth.uid())));

drop policy revisions_select on public.project_revisions;
drop policy revisions_insert on public.project_revisions;
create policy revisions_select on public.project_revisions for select to authenticated
  using (private.can_read_project(project_id));
create policy revisions_insert on public.project_revisions for insert to authenticated
  with check (organization_id = private.current_org_id() and author_id = auth.uid() and private.can_edit_project(project_id));

drop policy gen_select on public.generation_jobs;
drop policy gen_insert on public.generation_jobs;
create policy gen_select on public.generation_jobs for select to authenticated
  using (organization_id = private.current_org_id() and (
           requested_by = auth.uid() or private.has_role('admin')
        or (project_id is not null and private.can_read_project(project_id))));
create policy gen_insert on public.generation_jobs for insert to authenticated
  with check (organization_id = private.current_org_id() and private.can_use_ai()
              and requested_by = auth.uid() and status = 'queued'
              and output_asset_id is null and cost_actual_cents is null and provider_job_id is null
              and (project_id is null or private.can_edit_project(project_id))
              and (listing_id is null or private.can_edit_listing(listing_id)));

drop policy render_select on public.render_jobs;
drop policy render_insert on public.render_jobs;
create policy render_select on public.render_jobs for select to authenticated
  using (private.can_read_project(project_id));
create policy render_insert on public.render_jobs for insert to authenticated
  with check (organization_id = private.current_org_id() and private.can_edit_project(project_id)
              and requested_by = auth.uid() and status = 'queued' and progress = 0 and output_asset_id is null);

alter table public.project_members enable row level security;
create policy members_select on public.project_members for select to authenticated
  using (organization_id = private.current_org_id()
         and (user_id = auth.uid() or private.has_role('admin') or private.can_read_project(project_id)));

alter table public.organization_settings enable row level security;
create policy settings_select on public.organization_settings for select to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'));
create policy settings_update on public.organization_settings for update to authenticated
  using (organization_id = private.current_org_id() and private.is_super_admin())
  with check (organization_id = private.current_org_id());

-- ── Storage: files follow listing / project access ─────────────────────────
drop policy storage_select on storage.objects;
drop policy storage_insert_listing on storage.objects;
drop policy storage_insert_brand on storage.objects;
drop policy storage_delete on storage.objects;

-- Layout: <org>/listings/<listing>/<file>, <org>/brand/<file>, <org>/projects/<project>/<file>
create policy storage_select on storage.objects for select to authenticated
  using ((storage.foldername(name))[1] = private.current_org_id()::text and (
           (bucket_id = 'brand-assets')
        or (bucket_id = 'listing-media' and (storage.foldername(name))[2] = 'listings'
            and private.can_read_listing(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'video-exports' and (storage.foldername(name))[2] = 'projects'
            and private.can_read_project(private.try_uuid((storage.foldername(name))[3]))
            and private.can_download())));

create policy storage_insert_listing on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-media'
              and (storage.foldername(name))[1] = private.current_org_id()::text
              and (storage.foldername(name))[2] = 'listings'
              and private.can_edit_listing(private.try_uuid((storage.foldername(name))[3])));

create policy storage_insert_brand on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets'
              and (storage.foldername(name))[1] = private.current_org_id()::text
              and private.has_role('admin'));

create policy storage_delete on storage.objects for delete to authenticated
  using ((storage.foldername(name))[1] = private.current_org_id()::text and (
           (bucket_id = 'listing-media' and (storage.foldername(name))[2] = 'listings'
            and private.can_edit_listing(private.try_uuid((storage.foldername(name))[3])))
        or (bucket_id = 'brand-assets' and private.has_role('admin'))));

-- ════════════════════════════════════════════════════════════════════════════
-- Monthly usage limits (enforced in the database, not just the UI)
-- ════════════════════════════════════════════════════════════════════════════
create function private.enforce_video_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_used integer;
begin
  select max_videos_per_month into v_limit from public.profiles where id = new.created_by;
  if v_limit is not null then
    select count(*) into v_used from public.video_projects
    where created_by = new.created_by and created_at >= date_trunc('month', now());
    if v_used >= v_limit then
      raise exception 'Monthly video limit reached (% per month)', v_limit using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger video_projects_limit before insert on public.video_projects
  for each row execute function private.enforce_video_limit();

create function private.enforce_ai_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_used integer;
begin
  select max_ai_generations_per_month into v_limit from public.profiles where id = new.requested_by;
  if v_limit is not null then
    select count(*) into v_used from public.generation_jobs
    where requested_by = new.requested_by and created_at >= date_trunc('month', now());
    if v_used >= v_limit then
      raise exception 'Monthly AI limit reached (% per month)', v_limit using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger generation_jobs_limit before insert on public.generation_jobs
  for each row execute function private.enforce_ai_limit();

-- ════════════════════════════════════════════════════════════════════════════
-- User administration (all checks + audit in the database)
-- ════════════════════════════════════════════════════════════════════════════
drop function public.admin_update_member(uuid, public.app_role, boolean);

create function private.audit_as(p_actor uuid, p_org uuid, p_action text, p_target_type text, p_target_id text, p_meta jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (organization_id, actor_id, action, target_type, target_id, metadata)
  values (p_org, p_actor, p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
$$;

/* Raises unless `caller` may manage `target` and (optionally) give it `new_role`. */
create function private.assert_can_manage(caller public.profiles, target public.profiles, new_role public.app_role)
returns void language plpgsql stable set search_path = '' as $$
begin
  if caller.id is null or not caller.is_active or caller.role < 'admin' then
    raise exception 'Only administrators can manage users' using errcode = '42501';
  end if;
  if target.id is null or target.organization_id <> caller.organization_id then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if target.id = caller.id then
    raise exception 'You cannot change your own account here' using errcode = '42501';
  end if;
  if target.role = 'super_admin' or new_role = 'super_admin' then
    raise exception 'The Super Admin role cannot be granted or changed here' using errcode = '42501';
  end if;
  if (target.role = 'admin' or new_role = 'admin') and caller.role <> 'super_admin' then
    raise exception 'Only the Super Admin can create or change administrators' using errcode = '42501';
  end if;
end $$;

/* Called by the server (service role) right after Supabase Auth created the invited account. */
create function public.create_user_profile(
  p_actor uuid, p_user_id uuid, p_email text, p_first_name text, p_last_name text, p_job_title text,
  p_role public.app_role, p_can_download boolean, p_can_use_ai boolean,
  p_max_videos integer, p_max_ai integer
) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  created public.profiles;
  placeholder public.profiles;
begin
  select * into caller from public.profiles where id = p_actor for share;
  placeholder.id := p_user_id;
  placeholder.organization_id := caller.organization_id;
  placeholder.role := p_role;
  perform private.assert_can_manage(caller, placeholder, p_role);
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Auth account not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'This person already has an account' using errcode = '23505';
  end if;
  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'First and last name are required' using errcode = '22023';
  end if;

  insert into public.profiles (id, organization_id, email, first_name, last_name, job_title, role, status,
                               can_download, can_use_ai, max_videos_per_month, max_ai_generations_per_month, invited_by)
  values (p_user_id, caller.organization_id, lower(btrim(p_email)), btrim(p_first_name), btrim(p_last_name),
          nullif(btrim(coalesce(p_job_title, '')), ''), p_role, 'invited',
          coalesce(p_can_download, true), coalesce(p_can_use_ai, p_role >= 'editor'), p_max_videos, p_max_ai, caller.id)
  returning * into created;

  perform private.audit_as(caller.id, caller.organization_id, 'user.created', 'profile', created.id::text,
    jsonb_build_object('email', created.email, 'role', created.role,
                       'can_download', created.can_download, 'can_use_ai', created.can_use_ai,
                       'max_videos_per_month', created.max_videos_per_month,
                       'max_ai_generations_per_month', created.max_ai_generations_per_month));
  return created;
end $$;

create function public.admin_update_user(
  p_user_id uuid, p_first_name text, p_last_name text, p_job_title text, p_role public.app_role,
  p_can_download boolean, p_can_use_ai boolean, p_max_videos integer, p_max_ai integer
) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  target public.profiles;
  updated public.profiles;
begin
  select * into caller from public.profiles where id = auth.uid();
  select * into target from public.profiles where id = p_user_id for update;
  perform private.assert_can_manage(caller, target, p_role);
  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'First and last name are required' using errcode = '22023';
  end if;

  update public.profiles set
    first_name = btrim(p_first_name), last_name = btrim(p_last_name),
    job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
    role = p_role, can_download = p_can_download, can_use_ai = p_can_use_ai,
    max_videos_per_month = p_max_videos, max_ai_generations_per_month = p_max_ai
  where id = target.id returning * into updated;

  -- viewers can never edit a project they were assigned to
  if p_role = 'viewer' then
    update public.project_members set access = 'viewer' where user_id = target.id and access <> 'viewer';
  end if;

  if updated.first_name <> target.first_name or updated.last_name <> target.last_name
     or updated.job_title is distinct from target.job_title then
    perform private.audit_as(caller.id, caller.organization_id, 'user.updated', 'profile', target.id::text,
      jsonb_build_object('first_name', updated.first_name, 'last_name', updated.last_name, 'job_title', updated.job_title));
  end if;
  if updated.role <> target.role then
    perform private.audit_as(caller.id, caller.organization_id, 'user.role_changed', 'profile', target.id::text,
      jsonb_build_object('from', target.role, 'to', updated.role));
  end if;
  if updated.can_download <> target.can_download or updated.can_use_ai <> target.can_use_ai
     or updated.max_videos_per_month is distinct from target.max_videos_per_month
     or updated.max_ai_generations_per_month is distinct from target.max_ai_generations_per_month then
    perform private.audit_as(caller.id, caller.organization_id, 'user.permissions_changed', 'profile', target.id::text,
      jsonb_build_object(
        'can_download', jsonb_build_array(target.can_download, updated.can_download),
        'can_use_ai', jsonb_build_array(target.can_use_ai, updated.can_use_ai),
        'max_videos_per_month', jsonb_build_array(target.max_videos_per_month, updated.max_videos_per_month),
        'max_ai_generations_per_month', jsonb_build_array(target.max_ai_generations_per_month, updated.max_ai_generations_per_month)));
  end if;
  return updated;
end $$;

create function public.admin_set_user_status(p_user_id uuid, p_status text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  target public.profiles;
  updated public.profiles;
  v_action text;
begin
  if p_status not in ('active', 'suspended', 'deactivated') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  select * into caller from public.profiles where id = auth.uid();
  select * into target from public.profiles where id = p_user_id for update;
  perform private.assert_can_manage(caller, target, target.role);
  if target.status = 'deactivated' and p_status <> 'deactivated' and caller.role <> 'super_admin' then
    raise exception 'Only the Super Admin can restore a deactivated account' using errcode = '42501';
  end if;
  if target.status = p_status then
    return target;
  end if;

  update public.profiles set status = p_status where id = target.id returning * into updated;
  v_action := case p_status when 'active' then 'user.activated' when 'suspended' then 'user.suspended' else 'user.deactivated' end;
  perform private.audit_as(caller.id, caller.organization_id, v_action, 'profile', target.id::text,
    jsonb_build_object('from', target.status, 'to', p_status));
  return updated;
end $$;

/* Records that an administrator sent a new setup / reset link (the email itself is sent by Supabase Auth). */
create function public.admin_record_access_reset(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  target public.profiles;
begin
  select * into caller from public.profiles where id = auth.uid();
  select * into target from public.profiles where id = p_user_id;
  perform private.assert_can_manage(caller, target, target.role);
  if not target.is_active then
    raise exception 'Activate the account before resetting access' using errcode = '42501';
  end if;
  perform private.audit_as(caller.id, caller.organization_id, 'user.access_reset', 'profile', target.id::text, '{}'::jsonb);
end $$;

create function public.admin_assign_project(p_project_id uuid, p_user_id uuid, p_access text) returns public.project_members
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  target public.profiles;
  proj public.video_projects;
  v_access text;
  v_row public.project_members;
begin
  select * into caller from public.profiles where id = auth.uid() and is_active;
  if caller.id is null or caller.role < 'admin' then
    raise exception 'Only administrators can assign projects' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = p_user_id;
  select * into proj from public.video_projects where id = p_project_id;
  if target.id is null or target.organization_id <> caller.organization_id
     or proj.id is null or proj.organization_id <> caller.organization_id then
    raise exception 'User or project not found' using errcode = 'P0002';
  end if;
  if not target.is_active then
    raise exception 'This account is not active' using errcode = '42501';
  end if;
  if p_access not in ('viewer', 'editor') then
    raise exception 'Unknown access level' using errcode = '22023';
  end if;
  v_access := case when target.role = 'viewer' then 'viewer' else p_access end;

  insert into public.project_members (project_id, user_id, organization_id, access, assigned_by)
  values (proj.id, target.id, caller.organization_id, v_access, caller.id)
  on conflict (project_id, user_id) do update set access = excluded.access, assigned_by = excluded.assigned_by
  returning * into v_row;

  perform private.audit_as(caller.id, caller.organization_id, 'project.assigned', 'video_project', proj.id::text,
    jsonb_build_object('user_id', target.id, 'access', v_access));
  return v_row;
end $$;

create function public.admin_unassign_project(p_project_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  v_deleted integer;
begin
  select * into caller from public.profiles where id = auth.uid() and is_active;
  if caller.id is null or caller.role < 'admin' then
    raise exception 'Only administrators can assign projects' using errcode = '42501';
  end if;
  delete from public.project_members
  where project_id = p_project_id and user_id = p_user_id and organization_id = caller.organization_id;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    perform private.audit_as(caller.id, caller.organization_id, 'project.unassigned', 'video_project', p_project_id::text,
      jsonb_build_object('user_id', p_user_id));
  end if;
end $$;

/* An invited person becomes active once they have set their password. */
create function public.activate_self() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  update public.profiles set status = 'active' where id = auth.uid() and status = 'invited' returning * into me;
  if me.id is not null then
    perform private.audit_as(me.id, me.organization_id, 'user.activated', 'profile', me.id::text, '{"via":"invitation"}'::jsonb);
  end if;
end $$;

revoke all on function public.create_user_profile(uuid, uuid, text, text, text, text, public.app_role, boolean, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.create_user_profile(uuid, uuid, text, text, text, text, public.app_role, boolean, boolean, integer, integer) to service_role;
revoke all on function public.admin_update_user(uuid, text, text, text, public.app_role, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.admin_update_user(uuid, text, text, text, public.app_role, boolean, boolean, integer, integer) to authenticated;
revoke all on function public.admin_set_user_status(uuid, text) from public, anon;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
revoke all on function public.admin_record_access_reset(uuid) from public, anon;
grant execute on function public.admin_record_access_reset(uuid) to authenticated;
revoke all on function public.admin_assign_project(uuid, uuid, text) from public, anon;
grant execute on function public.admin_assign_project(uuid, uuid, text) to authenticated;
revoke all on function public.admin_unassign_project(uuid, uuid) from public, anon;
grant execute on function public.admin_unassign_project(uuid, uuid) to authenticated;
revoke all on function public.activate_self() from public, anon;
grant execute on function public.activate_self() to authenticated;
revoke all on function private.assert_can_manage(public.profiles, public.profiles, public.app_role) from public;
revoke all on function private.audit_as(uuid, uuid, text, text, text, jsonb) from public;

-- ── Bootstrap: the Super Admin starts active, and company settings are created ──
create or replace function public.bootstrap_complete(
  p_token_hash text, p_user_id uuid, p_email text, p_full_name text, p_org_name text, p_org_slug text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_token private.bootstrap_tokens;
  v_org uuid;
  v_name text := btrim(p_full_name);
begin
  perform pg_advisory_xact_lock(hashtext('lvs.bootstrap'));
  if exists (select 1 from private.bootstrap_state) then
    raise exception 'Setup is already complete' using errcode = '42501';
  end if;
  select * into v_token from private.bootstrap_tokens where token_hash = p_token_hash for update;
  if v_token.id is null or v_token.used_at is not null or v_token.expires_at <= now() then
    raise exception 'This setup code is not valid or has expired' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'User account not found' using errcode = 'P0002';
  end if;

  insert into public.organizations (name, slug) values (btrim(p_org_name), p_org_slug) returning id into v_org;
  insert into public.organization_settings (organization_id) values (v_org);
  insert into public.profiles (id, organization_id, email, first_name, last_name, full_name, role, status)
  values (p_user_id, v_org, lower(btrim(p_email)), split_part(v_name, ' ', 1),
          btrim(substr(v_name, char_length(split_part(v_name, ' ', 1)) + 1)), v_name, 'super_admin', 'active');
  insert into public.brand_kits (organization_id, name, is_default, company_name, created_by)
  values (v_org, 'Company brand', true, btrim(p_org_name), p_user_id);

  update private.bootstrap_tokens set used_at = now() where used_at is null;
  insert into private.bootstrap_state (organization_id, super_admin_id) values (v_org, p_user_id);
  insert into public.audit_log (organization_id, actor_id, action, target_type, target_id)
  values (v_org, p_user_id, 'bootstrap.completed', 'organization', v_org::text);
  return v_org;
end $$;
revoke all on function public.bootstrap_complete(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_complete(text, uuid, text, text, text, text) to service_role;
