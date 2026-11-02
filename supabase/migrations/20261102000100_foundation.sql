-- ════════════════════════════════════════════════════════════════════════════
-- Listing Video Studio — Stage 2 foundation
--   • Organization-owned data model (every row carries organization_id)
--   • Roles: viewer < creator < admin < super_admin (enum order = rank)
--   • Row-Level Security on every table; helper functions in a private schema
--   • Private storage buckets scoped by "<organization_id>/..." paths
--   • One-time Super Admin bootstrap (service-role only RPCs)
-- No public registration, no billing tables.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists private;
revoke all on schema private from public;

-- ── Types ──────────────────────────────────────────────────────────────────
create type public.app_role as enum ('viewer', 'creator', 'admin', 'super_admin');
create type public.listing_status as enum ('coming_soon', 'for_sale', 'open_house', 'pending', 'sold', 'for_rent');
create type public.asset_kind as enum ('photo', 'video', 'audio', 'logo', 'ai_clip', 'render');
create type public.video_status as enum ('draft', 'generating', 'ready_for_review', 'approved', 'rendering', 'completed', 'failed', 'archived');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- ── Shared trigger: updated_at ─────────────────────────────────────────────
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── Organizations ──────────────────────────────────────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_updated_at();

-- ── Profiles (one per auth user, one organization per user) ────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  role public.app_role not null default 'creator',
  ui_mode text not null default 'easy' check (ui_mode in ('easy', 'advanced')),
  avatar_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (organization_id);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ── Auth helpers (SECURITY DEFINER so policies can read profiles safely) ───
create function private.current_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organization_id from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create function private.has_role(min_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_app_role() >= min_role, false)
$$;

grant usage on schema private to authenticated, service_role;
grant execute on function private.current_org_id(), private.current_app_role(), private.has_role(public.app_role)
  to authenticated, service_role;

-- ── Brand kits (shared company branding) ───────────────────────────────────
create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  is_default boolean not null default false,
  company_name text check (char_length(company_name) <= 120),
  tagline text check (char_length(tagline) <= 160),
  primary_color text not null default '#1D4ED8' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#0F172A' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#F59E0B' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  heading_font text not null default 'Montserrat' check (char_length(heading_font) <= 60),
  body_font text not null default 'Inter' check (char_length(body_font) <= 60),
  logo_path text,
  outro_text text check (char_length(outro_text) <= 280),
  disclaimer text check (char_length(disclaimer) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index brand_kits_one_default on public.brand_kits (organization_id) where is_default;
create trigger brand_kits_touch before update on public.brand_kits
  for each row execute function private.touch_updated_at();

-- ── Listings ───────────────────────────────────────────────────────────────
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  address_line text not null check (char_length(btrim(address_line)) between 3 and 200),
  city text check (char_length(city) <= 100),
  state text check (char_length(state) <= 60),
  postal_code text check (char_length(postal_code) <= 20),
  price numeric(14, 2) check (price >= 0),
  bedrooms numeric(4, 1) check (bedrooms >= 0),
  bathrooms numeric(4, 1) check (bathrooms >= 0),
  square_feet integer check (square_feet >= 0),
  description text check (char_length(description) <= 5000),
  mls_number text check (char_length(mls_number) <= 40),
  status public.listing_status not null default 'for_sale',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_org_idx on public.listings (organization_id, created_at desc);
create trigger listings_touch before update on public.listings
  for each row execute function private.touch_updated_at();

-- ── Media assets (metadata for files in Storage) ───────────────────────────
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  kind public.asset_kind not null,
  bucket text not null check (bucket in ('listing-media', 'brand-assets', 'video-exports')),
  storage_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (char_length(mime_type) <= 100),
  size_bytes bigint not null check (size_bytes >= 0),
  width integer check (width > 0),
  height integer check (height > 0),
  duration_seconds numeric(10, 3) check (duration_seconds >= 0),
  room_label text check (char_length(room_label) <= 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path),
  -- files must live under the owning organization's folder
  check (split_part(storage_path, '/', 1) = organization_id::text),
  check (storage_path !~ '(^|/)\.\.(/|$)')
);
create index media_assets_listing_idx on public.media_assets (listing_id, sort_order);

-- ── Video templates (built-in when organization_id is null) ───────────────
create table public.video_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,48}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  aspect_ratios text[] not null default '{16:9}',
  style jsonb not null default '{}'::jsonb,
  document jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, slug)
);
create trigger video_templates_touch before update on public.video_templates
  for each row execute function private.touch_updated_at();

-- ── Video projects (document = FableCut project.json) ──────────────────────
create table public.video_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  template_id uuid references public.video_templates (id) on delete set null,
  brand_kit_id uuid references public.brand_kits (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  status public.video_status not null default 'draft',
  aspect_ratios text[] not null default '{16:9}'
    check (aspect_ratios <@ array['16:9', '9:16', '1:1', '4:5']::text[] and cardinality(aspect_ratios) between 1 and 4),
  settings jsonb not null default '{}'::jsonb,
  document jsonb,
  revision integer not null default 0 check (revision >= 0),
  thumbnail_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_projects_org_idx on public.video_projects (organization_id, updated_at desc);
create trigger video_projects_touch before update on public.video_projects
  for each row execute function private.touch_updated_at();

create table public.project_revisions (
  project_id uuid not null references public.video_projects (id) on delete cascade,
  revision integer not null check (revision > 0),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document jsonb not null,
  author_id uuid references public.profiles (id) on delete set null,
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  primary key (project_id, revision)
);

-- ── Jobs (filled by AI generation / render workers in later stages) ────────
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.video_projects (id) on delete set null,
  listing_id uuid references public.listings (id) on delete set null,
  source_asset_id uuid references public.media_assets (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('image_to_video', 'text_to_video', 'image_edit', 'voiceover')),
  provider text not null check (char_length(provider) <= 60),
  model text not null check (char_length(model) <= 120),
  camera_move text check (char_length(camera_move) <= 40),
  input jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  provider_job_id text,
  output_asset_id uuid references public.media_assets (id) on delete set null,
  error_message text,
  cost_estimate_cents integer check (cost_estimate_cents >= 0),
  cost_actual_cents integer check (cost_actual_cents >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index generation_jobs_org_idx on public.generation_jobs (organization_id, created_at desc);

create table public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.video_projects (id) on delete cascade,
  revision integer not null check (revision >= 0),
  preset text not null check (char_length(preset) <= 40),
  status public.job_status not null default 'queued',
  progress numeric(4, 3) not null default 0 check (progress between 0 and 1),
  output_asset_id uuid references public.media_assets (id) on delete set null,
  error_message text,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index render_jobs_org_idx on public.render_jobs (organization_id, created_at desc);

-- ── Audit log (append-only; written by security-definer code / server) ─────
create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  target_type text check (char_length(target_type) <= 40),
  target_id text check (char_length(target_id) <= 80),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (organization_id, created_at desc);

create function private.audit(p_org uuid, p_action text, p_target_type text, p_target_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (organization_id, actor_id, action, target_type, target_id, metadata)
  values (p_org, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
$$;

create function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit(old.organization_id, tg_table_name || '.delete', tg_table_name, old.id::text, '{}'::jsonb);
  else
    perform private.audit(new.organization_id, tg_table_name || '.' || lower(tg_op), tg_table_name, new.id::text, '{}'::jsonb);
  end if;
  return null;
end $$;

create trigger listings_audit after insert or delete on public.listings
  for each row execute function private.audit_row_change();
create trigger video_projects_audit after insert or delete on public.video_projects
  for each row execute function private.audit_row_change();
create trigger brand_kits_audit after insert or update or delete on public.brand_kits
  for each row execute function private.audit_row_change();

-- ════════════════════════════════════════════════════════════════════════════
-- Privileges: nothing for anon; signed-in users get only what policies allow.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- profiles: users may change only their own display fields; roles change via RPC
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, ui_mode, avatar_path) on public.profiles to authenticated;

-- organizations: name only
revoke insert, update, delete on public.organizations from authenticated;
grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

-- jobs + audit: read (and queue jobs) only
revoke update, delete on public.generation_jobs, public.render_jobs from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.project_revisions from authenticated;
grant select, insert on public.project_revisions to authenticated;

-- ── Row-Level Security ─────────────────────────────────────────────────────
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.brand_kits enable row level security;
alter table public.listings enable row level security;
alter table public.media_assets enable row level security;
alter table public.video_templates enable row level security;
alter table public.video_projects enable row level security;
alter table public.project_revisions enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.render_jobs enable row level security;
alter table public.audit_log enable row level security;

-- organizations
create policy org_select on public.organizations for select to authenticated
  using (id = private.current_org_id());
create policy org_update on public.organizations for update to authenticated
  using (id = private.current_org_id() and private.has_role('admin'))
  with check (id = private.current_org_id());

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (organization_id = private.current_org_id() or id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- brand kits: everyone in the company reads, admins manage
create policy brand_select on public.brand_kits for select to authenticated
  using (organization_id = private.current_org_id());
create policy brand_insert on public.brand_kits for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('admin'));
create policy brand_update on public.brand_kits for update to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'))
  with check (organization_id = private.current_org_id());
create policy brand_delete on public.brand_kits for delete to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'));

-- listings: company-visible; creators add and edit their own; admins edit all
create policy listings_select on public.listings for select to authenticated
  using (organization_id = private.current_org_id());
create policy listings_insert on public.listings for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('creator') and created_by = auth.uid());
create policy listings_update on public.listings for update to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or (private.has_role('creator') and created_by = auth.uid())))
  with check (organization_id = private.current_org_id());
create policy listings_delete on public.listings for delete to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or (private.has_role('creator') and created_by = auth.uid())));

-- media assets
create policy media_select on public.media_assets for select to authenticated
  using (organization_id = private.current_org_id());
create policy media_insert on public.media_assets for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('creator')
              and uploaded_by = auth.uid()
              and (bucket = 'listing-media' or (bucket = 'brand-assets' and private.has_role('admin'))));
create policy media_update on public.media_assets for update to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or (private.has_role('creator') and uploaded_by = auth.uid())))
  with check (organization_id = private.current_org_id());
create policy media_delete on public.media_assets for delete to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or (private.has_role('creator') and uploaded_by = auth.uid())));

-- templates: built-ins + own company's; admins manage company ones
create policy templates_select on public.video_templates for select to authenticated
  using (organization_id is null or organization_id = private.current_org_id());
create policy templates_insert on public.video_templates for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('admin'));
create policy templates_update on public.video_templates for update to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'))
  with check (organization_id = private.current_org_id());
create policy templates_delete on public.video_templates for delete to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'));

-- video projects
create policy projects_select on public.video_projects for select to authenticated
  using (organization_id = private.current_org_id());
create policy projects_insert on public.video_projects for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('creator') and created_by = auth.uid());
create policy projects_update on public.video_projects for update to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or (private.has_role('creator') and created_by = auth.uid())))
  with check (organization_id = private.current_org_id());
create policy projects_delete on public.video_projects for delete to authenticated
  using (organization_id = private.current_org_id()
         and (private.has_role('admin') or (private.has_role('creator') and created_by = auth.uid())));

-- revisions: append-only
create policy revisions_select on public.project_revisions for select to authenticated
  using (organization_id = private.current_org_id());
create policy revisions_insert on public.project_revisions for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('creator') and author_id = auth.uid()
              and exists (select 1 from public.video_projects vp
                          where vp.id = project_id and vp.organization_id = private.current_org_id()));

-- jobs: read company jobs; creators may only queue new jobs
create policy gen_select on public.generation_jobs for select to authenticated
  using (organization_id = private.current_org_id());
create policy gen_insert on public.generation_jobs for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('creator')
              and requested_by = auth.uid() and status = 'queued'
              and output_asset_id is null and cost_actual_cents is null and provider_job_id is null);
create policy render_select on public.render_jobs for select to authenticated
  using (organization_id = private.current_org_id());
create policy render_insert on public.render_jobs for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('creator')
              and requested_by = auth.uid() and status = 'queued' and progress = 0 and output_asset_id is null);

-- audit: admins read their company's log
create policy audit_select on public.audit_log for select to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'));

-- ════════════════════════════════════════════════════════════════════════════
-- Admin RPC: change a colleague's role or access (no direct UPDATE on role)
-- ════════════════════════════════════════════════════════════════════════════
create function public.admin_update_member(p_user_id uuid, p_role public.app_role, p_is_active boolean)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  target public.profiles;
begin
  select * into caller from public.profiles where id = auth.uid() and is_active;
  if caller.id is null or caller.role < 'admin' then
    raise exception 'Only administrators can change team members' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = p_user_id for update;
  if target.id is null or target.organization_id <> caller.organization_id then
    raise exception 'Team member not found' using errcode = 'P0002';
  end if;
  if target.id = caller.id then
    raise exception 'You cannot change your own role or access' using errcode = '42501';
  end if;
  if p_role = 'super_admin' or target.role = 'super_admin' then
    raise exception 'The Super Admin role cannot be granted or changed here' using errcode = '42501';
  end if;
  if (p_role = 'admin' or target.role = 'admin') and caller.role <> 'super_admin' then
    raise exception 'Only the Super Admin can add or change administrators' using errcode = '42501';
  end if;

  update public.profiles set role = p_role, is_active = p_is_active
  where id = target.id returning * into target;

  perform private.audit(caller.organization_id, 'member.updated', 'profile', target.id::text,
    jsonb_build_object('role', p_role, 'is_active', p_is_active));
  return target;
end $$;
revoke all on function public.admin_update_member(uuid, public.app_role, boolean) from public, anon;
grant execute on function public.admin_update_member(uuid, public.app_role, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- One-time Super Admin bootstrap
--   1. Operator runs `npm run bootstrap:token` (server, service role) → a random
--      one-time code is printed; only its SHA-256 hash is stored, 60 min expiry.
--   2. Operator opens /setup, enters the code + company + their own password.
--   3. bootstrap_complete() atomically creates the company, Super Admin profile
--      and default brand kit, burns the code and closes bootstrap forever.
-- All bootstrap functions are callable by service_role only.
-- ════════════════════════════════════════════════════════════════════════════
create table private.bootstrap_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table private.bootstrap_state (
  singleton boolean primary key default true check (singleton),
  organization_id uuid not null references public.organizations (id),
  super_admin_id uuid not null references public.profiles (id),
  completed_at timestamptz not null default now()
);

create function public.bootstrap_is_complete() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.bootstrap_state)
$$;

create function public.bootstrap_create_token(p_token_hash text, p_ttl_minutes integer default 60)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_expires timestamptz;
begin
  if exists (select 1 from private.bootstrap_state) then
    raise exception 'Setup is already complete' using errcode = '42501';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid token hash' using errcode = '22023';
  end if;
  if p_ttl_minutes not between 5 and 1440 then
    raise exception 'Token lifetime must be 5–1440 minutes' using errcode = '22023';
  end if;
  -- only one live code at a time
  update private.bootstrap_tokens set used_at = now() where used_at is null;
  v_expires := now() + make_interval(mins => p_ttl_minutes);
  insert into private.bootstrap_tokens (token_hash, expires_at) values (p_token_hash, v_expires);
  return v_expires;
end $$;

create function public.bootstrap_check_token(p_token_hash text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.bootstrap_state)
     and exists (select 1 from private.bootstrap_tokens t
                 where t.token_hash = p_token_hash and t.used_at is null and t.expires_at > now())
$$;

create function public.bootstrap_complete(
  p_token_hash text, p_user_id uuid, p_email text, p_full_name text, p_org_name text, p_org_slug text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_token private.bootstrap_tokens;
  v_org uuid;
begin
  -- serialize concurrent attempts
  perform pg_advisory_xact_lock(hashtext('lvs.bootstrap'));

  if exists (select 1 from private.bootstrap_state) then
    raise exception 'Setup is already complete' using errcode = '42501';
  end if;

  select * into v_token from private.bootstrap_tokens
  where token_hash = p_token_hash for update;
  if v_token.id is null or v_token.used_at is not null or v_token.expires_at <= now() then
    raise exception 'This setup code is not valid or has expired' using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'User account not found' using errcode = 'P0002';
  end if;

  insert into public.organizations (name, slug) values (btrim(p_org_name), p_org_slug)
  returning id into v_org;

  insert into public.profiles (id, organization_id, email, full_name, role)
  values (p_user_id, v_org, lower(btrim(p_email)), btrim(p_full_name), 'super_admin');

  insert into public.brand_kits (organization_id, name, is_default, company_name, created_by)
  values (v_org, 'Company brand', true, btrim(p_org_name), p_user_id);

  update private.bootstrap_tokens set used_at = now() where id = v_token.id;
  update private.bootstrap_tokens set used_at = now() where used_at is null;

  insert into private.bootstrap_state (organization_id, super_admin_id) values (v_org, p_user_id);

  insert into public.audit_log (organization_id, actor_id, action, target_type, target_id)
  values (v_org, p_user_id, 'bootstrap.completed', 'organization', v_org::text);

  return v_org;
end $$;

revoke all on function public.bootstrap_is_complete() from public, anon, authenticated;
revoke all on function public.bootstrap_create_token(text, integer) from public, anon, authenticated;
revoke all on function public.bootstrap_check_token(text) from public, anon, authenticated;
revoke all on function public.bootstrap_complete(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_is_complete() to service_role;
grant execute on function public.bootstrap_create_token(text, integer) to service_role;
grant execute on function public.bootstrap_check_token(text) to service_role;
grant execute on function public.bootstrap_complete(text, uuid, text, text, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Storage: private buckets, files under "<organization_id>/..."
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('listing-media', 'listing-media', false, 52428800,
     array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime']),
  ('brand-assets', 'brand-assets', false, 10485760,
     array['image/png', 'image/jpeg', 'image/webp']),
  ('video-exports', 'video-exports', false, 2147483648,
     array['video/mp4', 'image/jpeg'])
on conflict (id) do nothing;

create policy storage_select on storage.objects for select to authenticated
  using (bucket_id in ('listing-media', 'brand-assets', 'video-exports')
         and (storage.foldername(name))[1] = private.current_org_id()::text);

create policy storage_insert_listing on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-media'
              and (storage.foldername(name))[1] = private.current_org_id()::text
              and private.has_role('creator'));

create policy storage_insert_brand on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets'
              and (storage.foldername(name))[1] = private.current_org_id()::text
              and private.has_role('admin'));

create policy storage_delete on storage.objects for delete to authenticated
  using (bucket_id in ('listing-media', 'brand-assets')
         and (storage.foldername(name))[1] = private.current_org_id()::text
         and (private.has_role('admin') or (private.has_role('creator') and owner_id = auth.uid()::text)));
-- video-exports are written only by render workers (service role).

-- ════════════════════════════════════════════════════════════════════════════
-- Built-in templates (original designs; FableCut documents attached in Stage 4)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.video_templates (organization_id, slug, name, description, aspect_ratios, style, sort_order) values
  (null, 'luxury', 'Luxury', 'Slow, elegant camera moves with refined titles.', '{16:9,9:16}',
     '{"pace":"slow","titleStyle":"elegant","music":"warm-strings"}', 1),
  (null, 'modern', 'Modern', 'Clean cuts on the beat with bold, simple text.', '{16:9,9:16}',
     '{"pace":"medium","titleStyle":"bold","music":"modern-pulse"}', 2),
  (null, 'quick-social', 'Quick Social', 'A 20–30 second vertical video with captions.', '{9:16}',
     '{"pace":"fast","titleStyle":"kinetic","captions":true}', 3),
  (null, 'open-house', 'Open House', 'Highlights the date and time with a clear invitation.', '{1:1,9:16}',
     '{"pace":"medium","titleStyle":"bold","dateCard":true}', 4),
  (null, 'just-sold', 'Just Sold', 'A short celebration video for a sold home.', '{9:16,1:1}',
     '{"pace":"fast","titleStyle":"impact","badge":"sold"}', 5);
