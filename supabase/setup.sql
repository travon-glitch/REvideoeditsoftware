-- ════════════════════════════════════════════════════════════════════════════
-- Listing Video Studio — complete database setup (generated: do not edit by hand)
--
-- FOR A NEW, EMPTY SUPABASE PROJECT. Run it once:
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- It creates every table, access rule (Row-Level Security), function and the six
-- private storage buckets. It is the same as running the 14 files in
-- supabase/migrations/ in order (`npx supabase db push` does that too).
--
-- Don't run it twice on the same project. For later updates, run only the new
-- migration files (see docs/VERCEL.md, "Updating").
--
-- Migrations included: 20261102000100_foundation.sql … 20261114000100_production_hardening.sql
-- Checksum: 14a3040a0147c611
-- ════════════════════════════════════════════════════════════════════════════

-- ════════ 20261102000100_foundation.sql ════════
begin;

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

commit;

-- ════════ 20261103000100_user_management.sql ════════
begin;

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

commit;

-- ════════ 20261104000100_listings_photos.sql ════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- Stage 4 — Listings and photo uploads
--   • Full listing record (property, agent, brokerage, contact, open house)
--   • Drafts: nothing is required to save; "ready" needs an address + 5–30 photos
--   • Main photo, safe reordering, in-place photo replacement
--   • Listings can be assigned directly to employees (not only via projects)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Listing fields ─────────────────────────────────────────────────────────
alter table public.listings
  add column workflow_state text not null default 'draft' check (workflow_state in ('draft', 'ready')),
  add column property_type text check (property_type in
    ('single_family', 'condo', 'townhouse', 'multi_family', 'manufactured', 'land', 'commercial', 'other')),
  add column agent_name text check (char_length(agent_name) <= 120),
  add column brokerage text check (char_length(brokerage) <= 160),
  add column contact_phone text check (char_length(contact_phone) <= 40),
  add column contact_email text check (char_length(contact_email) <= 254),
  add column open_house_date date,
  add column open_house_start time,
  add column open_house_end time,
  add column cover_asset_id uuid references public.media_assets (id) on delete set null,
  add column updated_by uuid references public.profiles (id) on delete set null,
  add constraint listings_open_house_times check (
    open_house_start is null or open_house_end is null or open_house_end > open_house_start);

-- Existing listings were complete; new ones start as drafts with an optional address.
update public.listings set workflow_state = 'ready';
alter table public.listings drop constraint listings_address_line_check;
alter table public.listings alter column address_line set default '';
alter table public.listings add constraint listings_address_line_check
  check (char_length(address_line) <= 200 and (workflow_state = 'draft' or char_length(btrim(address_line)) >= 3));

-- ── Photos: always inside their own listing's folder ───────────────────────
alter table public.media_assets add constraint media_assets_listing_folder check (
  bucket <> 'listing-media' or listing_id is null
  or storage_path like organization_id::text || '/listings/' || listing_id::text || '/%');

create function private.max_listing_photos() returns integer language sql immutable as $$ select 30 $$;
create function private.min_listing_photos() returns integer language sql immutable as $$ select 5 $$;

/* No more than 30 photos per listing (checked under a lock so parallel uploads can't overshoot). */
create function private.enforce_photo_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if new.kind <> 'photo' or new.listing_id is null then
    return new;
  end if;
  perform 1 from public.listings where id = new.listing_id for update;
  select count(*) into v_count from public.media_assets where listing_id = new.listing_id and kind = 'photo';
  if v_count >= private.max_listing_photos() then
    raise exception 'A listing can have at most % photos', private.max_listing_photos() using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger media_assets_photo_limit before insert on public.media_assets
  for each row execute function private.enforce_photo_limit();

/* The main photo must be one of this listing's photos; "ready" needs an address and 5–30 photos. */
create function private.check_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if new.cover_asset_id is not null and not exists (
       select 1 from public.media_assets m
       where m.id = new.cover_asset_id and m.listing_id = new.id and m.kind = 'photo') then
    raise exception 'The main photo must be one of this listing''s photos' using errcode = '23514';
  end if;
  if new.workflow_state = 'ready' and (tg_op = 'INSERT' or old.workflow_state <> 'ready') then
    select count(*) into v_count from public.media_assets where listing_id = new.id and kind = 'photo';
    if v_count < private.min_listing_photos() or v_count > private.max_listing_photos() then
      raise exception 'A listing needs % to % photos before it is ready (it has %)',
        private.min_listing_photos(), private.max_listing_photos(), v_count using errcode = 'P0001';
    end if;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger listings_check before insert or update on public.listings
  for each row execute function private.check_listing();

-- ── Direct listing assignments ─────────────────────────────────────────────
create table public.listing_members (
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  access text not null default 'viewer' check (access in ('viewer', 'editor')),
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index listing_members_user_idx on public.listing_members (user_id);
revoke insert, update, delete on public.listing_members from authenticated;
alter table public.listing_members enable row level security;
create policy listing_members_select on public.listing_members for select to authenticated
  using (organization_id = private.current_org_id()
         and (user_id = auth.uid() or private.has_role('admin') or private.can_read_listing(listing_id)));

create function private.listing_member_access(p_listing uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.access from public.listing_members m where m.listing_id = p_listing and m.user_id = auth.uid()
$$;
grant execute on function private.listing_member_access(uuid) to authenticated, service_role;

-- Listing access now also includes direct assignments.
create or replace function private.listing_shared_with_me(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.listing_member_access(p_listing) is not null
      or exists (select 1 from public.video_projects vp
                 where vp.listing_id = p_listing and private.can_read_project(vp.id))
$$;

create or replace function private.can_read_listing(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings l
    where l.id = p_listing
      and l.organization_id = private.current_org_id()
      and (private.has_role('admin') or l.created_by = auth.uid() or private.listing_shared_with_me(l.id))
  )
$$;

create or replace function private.can_edit_listing(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('editor') and exists (
    select 1 from public.listings l
    where l.id = p_listing
      and l.organization_id = private.current_org_id()
      and (private.is_super_admin()
           or l.created_by = auth.uid()
           or private.listing_member_access(l.id) = 'editor'
           or exists (select 1 from public.video_projects vp
                      where vp.listing_id = l.id and private.can_edit_project(vp.id)))
  )
$$;

create function public.admin_assign_listing(p_listing_id uuid, p_user_id uuid, p_access text) returns public.listing_members
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  target public.profiles;
  lst public.listings;
  v_access text;
  v_row public.listing_members;
begin
  select * into caller from public.profiles where id = auth.uid() and is_active;
  if caller.id is null or caller.role < 'admin' then
    raise exception 'Only administrators can assign listings' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = p_user_id;
  select * into lst from public.listings where id = p_listing_id;
  if target.id is null or target.organization_id <> caller.organization_id
     or lst.id is null or lst.organization_id <> caller.organization_id then
    raise exception 'User or listing not found' using errcode = 'P0002';
  end if;
  if not target.is_active then
    raise exception 'This account is not active' using errcode = '42501';
  end if;
  if p_access not in ('viewer', 'editor') then
    raise exception 'Unknown access level' using errcode = '22023';
  end if;
  v_access := case when target.role = 'viewer' then 'viewer' else p_access end;
  insert into public.listing_members (listing_id, user_id, organization_id, access, assigned_by)
  values (lst.id, target.id, caller.organization_id, v_access, caller.id)
  on conflict (listing_id, user_id) do update set access = excluded.access, assigned_by = excluded.assigned_by
  returning * into v_row;
  perform private.audit_as(caller.id, caller.organization_id, 'listing.assigned', 'listing', lst.id::text,
    jsonb_build_object('user_id', target.id, 'access', v_access));
  return v_row;
end $$;

create function public.admin_unassign_listing(p_listing_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  v_deleted integer;
begin
  select * into caller from public.profiles where id = auth.uid() and is_active;
  if caller.id is null or caller.role < 'admin' then
    raise exception 'Only administrators can assign listings' using errcode = '42501';
  end if;
  delete from public.listing_members
  where listing_id = p_listing_id and user_id = p_user_id and organization_id = caller.organization_id;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    perform private.audit_as(caller.id, caller.organization_id, 'listing.unassigned', 'listing', p_listing_id::text,
      jsonb_build_object('user_id', p_user_id));
  end if;
end $$;

-- ── Reorder photos (all-or-nothing, only someone who can edit the listing) ──
create function public.reorder_listing_photos(p_listing_id uuid, p_asset_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_existing uuid[];
begin
  if not private.can_edit_listing(p_listing_id) then
    raise exception 'You cannot change this listing' using errcode = '42501';
  end if;
  perform 1 from public.listings where id = p_listing_id for update;
  select array_agg(id order by id) into v_existing from public.media_assets where listing_id = p_listing_id and kind = 'photo';
  if coalesce(cardinality(p_asset_ids), 0) <> coalesce(cardinality(v_existing), 0)
     or (select array_agg(x order by x) from unnest(p_asset_ids) x) is distinct from v_existing then
    raise exception 'The new order must list every photo of this listing exactly once' using errcode = '22023';
  end if;
  update public.media_assets m set sort_order = o.pos - 1
  from unnest(p_asset_ids) with ordinality as o(id, pos)
  where m.id = o.id;
end $$;

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on function public.admin_assign_listing(uuid, uuid, text) from public, anon;
grant execute on function public.admin_assign_listing(uuid, uuid, text) to authenticated;
revoke all on function public.admin_unassign_listing(uuid, uuid) from public, anon;
grant execute on function public.admin_unassign_listing(uuid, uuid) to authenticated;
revoke all on function public.reorder_listing_photos(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_listing_photos(uuid, uuid[]) to authenticated;

-- Photo deletions are audited too (who removed what, from which listing).
create function private.audit_photo_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.kind = 'photo' and old.listing_id is not null then
    perform private.audit(old.organization_id, 'photo.deleted', 'listing', old.listing_id::text,
      jsonb_build_object('asset_id', old.id, 'file_name', old.file_name));
  end if;
  return null;
end $$;
create trigger media_assets_audit_delete after delete on public.media_assets
  for each row execute function private.audit_photo_delete();

commit;

-- ════════ 20261105000100_video_editor.sql ════════
begin;

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

commit;

-- ════════ 20261106000100_easy_mode.sql ════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- Stage 6 — Easy Mode
--   • Real photo thumbnails (small JPEGs stored next to each photo)
--   • The six Easy Mode video styles as the built-in templates
-- ════════════════════════════════════════════════════════════════════════════

alter table public.media_assets add column thumbnail_path text;
alter table public.media_assets add constraint media_assets_thumbnail_folder check (
  thumbnail_path is null
  or (bucket = 'listing-media' and listing_id is not null
      and thumbnail_path like organization_id::text || '/listings/' || listing_id::text || '/%.thumb.jpg'));

-- Built-in styles (original designs). Existing rows are updated in place so projects keep their template.
update public.video_templates set name = 'Luxury Cinematic',
  description = 'Slow, elegant camera moves with refined titles.', aspect_ratios = '{16:9,9:16}', sort_order = 1
  where organization_id is null and slug = 'luxury';
update public.video_templates set name = 'Modern',
  description = 'Clean, quick cuts with bold, simple text.', aspect_ratios = '{16:9,9:16}', sort_order = 2
  where organization_id is null and slug = 'modern';
update public.video_templates set slug = 'social-reel', name = 'Social Media Reel',
  description = 'A short, fast vertical video for Reels, TikTok and Shorts.', aspect_ratios = '{9:16}', sort_order = 5
  where organization_id is null and slug = 'quick-social';
update public.video_templates set name = 'Open House',
  description = 'Invites people with the date and time up front.', aspect_ratios = '{16:9,1:1,9:16}', sort_order = 4
  where organization_id is null and slug = 'open-house';
update public.video_templates set is_active = false where organization_id is null and slug = 'just-sold';

insert into public.video_templates (organization_id, slug, name, description, aspect_ratios, style, sort_order) values
  (null, 'just-listed', 'Just Listed', 'Announces a new listing with a bold “Just Listed” banner.', '{16:9,9:16}', '{}', 3),
  (null, 'highlights', 'Property Highlights', 'Shows the key facts — bedrooms, bathrooms, size — one by one.', '{16:9,1:1}', '{}', 6)
on conflict (organization_id, slug) do nothing;

commit;

-- ════════ 20261107000100_camera_studio.sql ════════
begin;

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

commit;

-- ════════ 20261108000100_video_batches.sql ════════
begin;

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

commit;

-- ════════ 20261109000100_ai_director.sql ════════
begin;

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

commit;

-- ════════ 20261110000100_music_and_batch_v2.sql ════════
begin;

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

commit;

-- ════════ 20261111000050_headshot_kind.sql ════════
begin;

-- Stage 11: agent headshots are their own kind of brand asset.
-- (Its own migration: a new enum value can't be used in the transaction that adds it.)
alter type public.asset_kind add value if not exists 'headshot';

commit;

-- ════════ 20261111000100_templates_brand_agents.sql ════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- Stage 11 — real-estate templates, company brand kit, agent profiles.
--   • brand_kits: brokerage details + logo, intro/outro animation, agent card layout,
--     required disclosure, default music. Only the Super Admin changes the brand kit.
--   • organization_settings: branding rules administrators enforce on every video.
--   • agent_profiles (+ listings.agent_profile_id): who appears on a listing's videos.
--   • video_templates: company templates with draft → approved → disabled, defaults per
--     listing status, approval stamped by the database.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Brand kit ──────────────────────────────────────────────────────────────
alter table public.brand_kits
  add column brokerage_name text check (char_length(brokerage_name) <= 160),
  add column brokerage_license text check (char_length(brokerage_license) <= 80),
  add column brokerage_logo_path text,
  add column intro_style text not null default 'logo-reveal' check (intro_style in ('none', 'logo-reveal', 'bar-wipe', 'title-card')),
  add column outro_style text not null default 'agent-card' check (outro_style in ('none', 'agent-card', 'logo-end', 'contact-bar')),
  add column agent_layout text not null default 'photo-left' check (agent_layout in ('photo-left', 'centered', 'minimal')),
  add column disclosure_required boolean not null default false,
  add column music_mood text not null default 'calm' check (music_mood in ('elegant', 'calm', 'upbeat', 'warm', 'inspiring')),
  add column music_follow_template boolean not null default true,
  add column music_asset_id uuid references public.media_assets (id) on delete set null,
  add column music_volume numeric(3, 2) not null default 0.65 check (music_volume between 0 and 1),
  add constraint brand_kits_disclosure_text check (not disclosure_required or char_length(btrim(coalesce(disclaimer, ''))) >= 5),
  add constraint brand_kits_logo_paths check (
    (logo_path is null or split_part(logo_path, '/', 1) = organization_id::text)
    and (brokerage_logo_path is null or split_part(brokerage_logo_path, '/', 1) = organization_id::text));

-- the default music must be a verified track of the same company
create function private.check_brand_music() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.music_asset_id is not null and not exists (
    select 1 from public.music_tracks t join public.media_assets m on m.id = t.asset_id
    where t.asset_id = new.music_asset_id and m.organization_id = new.organization_id and t.commercial_use_verified) then
    raise exception 'The default music must be a verified track from your music library';
  end if;
  return new;
end $$;
create trigger brand_kits_music before insert or update of music_asset_id on public.brand_kits
  for each row execute function private.check_brand_music();

-- the brand kit is the Super Admin's
drop policy brand_insert on public.brand_kits;
drop policy brand_update on public.brand_kits;
drop policy brand_delete on public.brand_kits;
create policy brand_insert on public.brand_kits for insert to authenticated
  with check (organization_id = private.current_org_id() and private.is_super_admin());
create policy brand_update on public.brand_kits for update to authenticated
  using (organization_id = private.current_org_id() and private.is_super_admin())
  with check (organization_id = private.current_org_id());
create policy brand_delete on public.brand_kits for delete to authenticated
  using (organization_id = private.current_org_id() and private.is_super_admin());

-- ── Branding rules (administrators) ────────────────────────────────────────
alter table public.organization_settings
  add column require_logo boolean not null default false,
  add column require_disclosure boolean not null default false,
  add column require_agent_card boolean not null default false,
  add column lock_brand_fonts boolean not null default false,
  add column lock_brand_colors boolean not null default false;

create function public.admin_set_brand_rules(p_require_logo boolean, p_require_disclosure boolean, p_require_agent_card boolean,
  p_lock_fonts boolean, p_lock_colors boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org_id();
begin
  if v_org is null or not private.has_role('admin') then raise exception 'Only administrators can change branding rules'; end if;
  insert into public.organization_settings (organization_id) values (v_org) on conflict do nothing;
  update public.organization_settings set require_logo = p_require_logo, require_disclosure = p_require_disclosure,
    require_agent_card = p_require_agent_card, lock_brand_fonts = p_lock_fonts, lock_brand_colors = p_lock_colors, updated_by = auth.uid()
  where organization_id = v_org;
  perform private.audit(v_org, 'branding.rules', 'organization', v_org::text, jsonb_build_object(
    'require_logo', p_require_logo, 'require_disclosure', p_require_disclosure, 'require_agent_card', p_require_agent_card,
    'lock_fonts', p_lock_fonts, 'lock_colors', p_lock_colors));
end $$;
revoke execute on function public.admin_set_brand_rules(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_set_brand_rules(boolean, boolean, boolean, boolean, boolean) to authenticated;

-- everyone who makes videos needs to know the rules (read-only)
create function public.my_brand_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'require_logo', coalesce(s.require_logo, false), 'require_disclosure', coalesce(s.require_disclosure, false),
    'require_agent_card', coalesce(s.require_agent_card, false), 'lock_fonts', coalesce(s.lock_brand_fonts, false),
    'lock_colors', coalesce(s.lock_brand_colors, false))
  from public.profiles p left join public.organization_settings s on s.organization_id = p.organization_id
  where p.id = auth.uid();
$$;
revoke execute on function public.my_brand_rules() from public, anon;
grant execute on function public.my_brand_rules() to authenticated;

-- ── Headshots (brand-assets, kind headshot) ────────────────────────────────
alter table public.media_assets add constraint media_assets_headshot_folder check (
  kind <> 'headshot' or (bucket = 'brand-assets' and listing_id is null and project_id is null
                         and storage_path like organization_id::text || '/agents/%'));

-- ── Agent profiles ─────────────────────────────────────────────────────────
create table public.agent_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  title text check (char_length(title) <= 80),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 160 and (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  brokerage text check (char_length(brokerage) <= 160),
  license text check (char_length(license) <= 60),
  headshot_asset_id uuid references public.media_assets (id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index agent_profiles_org_idx on public.agent_profiles (organization_id, name);
create trigger agent_profiles_touch before update on public.agent_profiles
  for each row execute function private.touch_updated_at();
create trigger agent_profiles_audit after insert or update or delete on public.agent_profiles
  for each row execute function private.audit_row_change();

create function private.check_agent_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (select 1 from public.profiles p where p.id = new.user_id and p.organization_id = new.organization_id) then
    raise exception 'That person is not in your company';
  end if;
  if new.headshot_asset_id is not null and not exists (
    select 1 from public.media_assets m where m.id = new.headshot_asset_id and m.organization_id = new.organization_id and m.kind = 'headshot') then
    raise exception 'The headshot must be a headshot uploaded for your company';
  end if;
  -- an agent editing their own profile can't move it, re-link it or switch it off
  if tg_op = 'UPDATE' and auth.uid() is not null and not private.has_role('admin') then
    if new.organization_id <> old.organization_id or new.user_id is distinct from old.user_id or new.is_active <> old.is_active then
      raise exception 'Only administrators can change that';
    end if;
  end if;
  return new;
end $$;
create trigger agent_profiles_check before insert or update on public.agent_profiles
  for each row execute function private.check_agent_profile();

alter table public.agent_profiles enable row level security;
create policy agents_select on public.agent_profiles for select to authenticated
  using (organization_id = private.current_org_id());
create policy agents_insert on public.agent_profiles for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('admin') and created_by = auth.uid());
create policy agents_update on public.agent_profiles for update to authenticated
  using (organization_id = private.current_org_id() and (private.has_role('admin') or user_id = auth.uid()))
  with check (organization_id = private.current_org_id());
create policy agents_delete on public.agent_profiles for delete to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'));
grant select, insert, update, delete on public.agent_profiles to authenticated;

-- ── Listings: assigned agent and earlier price ─────────────────────────────
alter table public.listings
  add column agent_profile_id uuid references public.agent_profiles (id) on delete set null,
  add column previous_price numeric(14, 2) check (previous_price >= 0);

create function private.check_listing_agent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.agent_profile_id is not null and not exists (
    select 1 from public.agent_profiles a where a.id = new.agent_profile_id and a.organization_id = new.organization_id and a.is_active) then
    raise exception 'Choose an active agent from your company';
  end if;
  return new;
end $$;
create trigger listings_agent before insert or update of agent_profile_id on public.listings
  for each row execute function private.check_listing_agent();

-- ── Templates ──────────────────────────────────────────────────────────────
alter table public.video_templates
  add column builtin_key text check (builtin_key ~ '^[a-z0-9-]{2,48}$'),
  add column status text not null default 'draft' check (status in ('draft', 'approved', 'disabled')),
  add column usage text not null default '' check (char_length(usage) <= 200),
  add column default_for public.listing_status[] not null default '{}',
  add column created_by uuid references public.profiles (id) on delete set null,
  add column approved_by uuid references public.profiles (id) on delete set null,
  add column approved_at timestamptz,
  add constraint video_templates_default_needs_approval check (status = 'approved' or default_for = '{}'),
  add constraint video_templates_style_object check (jsonb_typeof(style) = 'object'),
  add constraint video_templates_builtin_unique unique (organization_id, builtin_key);

-- the earlier global style rows are retired (companies get their own copies of the 15 templates)
update public.video_templates set is_active = false, status = 'disabled' where organization_id is null;

create function private.template_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.builtin_key is distinct from old.builtin_key then
      raise exception 'A template can''t be moved or re-linked';
    end if;
    -- an edit to an approved template needs approving again
    if old.status = 'approved' and new.status = 'approved'
       and (new.style is distinct from old.style or new.name is distinct from old.name or new.usage is distinct from old.usage) then
      new.status := 'draft'; new.default_for := '{}'; new.approved_by := null; new.approved_at := null;
    end if;
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if auth.uid() is not null then
      if not private.has_role('admin') then raise exception 'Only administrators can approve templates'; end if;
      new.approved_by := auth.uid();
    end if;
    new.approved_at := now();
  end if;
  if new.status <> 'approved' then new.default_for := '{}'; new.approved_by := null; new.approved_at := null; end if;
  new.is_active := new.status <> 'disabled';
  -- one default per listing status per company
  if new.default_for <> '{}' and exists (
    select 1 from public.video_templates t where t.organization_id = new.organization_id and t.id <> new.id and t.default_for && new.default_for) then
    raise exception 'Another template is already the default for one of those listing types';
  end if;
  return new;
end $$;
create trigger video_templates_rules before insert or update on public.video_templates
  for each row execute function private.template_rules();
create trigger video_templates_audit after insert or update or delete on public.video_templates
  for each row execute function private.audit_row_change();

drop policy templates_select on public.video_templates;
drop policy templates_insert on public.video_templates;
drop policy templates_update on public.video_templates;
drop policy templates_delete on public.video_templates;
-- people who make videos see approved templates; administrators see everything of their company
create policy templates_select on public.video_templates for select to authenticated
  using (organization_id = private.current_org_id() and (status = 'approved' or private.has_role('admin')));
-- new templates start as drafts made by the administrator
create policy templates_insert on public.video_templates for insert to authenticated
  with check (organization_id = private.current_org_id() and private.has_role('admin')
              and status = 'draft' and builtin_key is null and created_by = auth.uid());
create policy templates_update on public.video_templates for update to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin'))
  with check (organization_id = private.current_org_id());
-- built-in templates can be disabled, not deleted
create policy templates_delete on public.video_templates for delete to authenticated
  using (organization_id = private.current_org_id() and private.has_role('admin') and builtin_key is null);

-- assign a template as the default for some listing types (clears those types elsewhere first)
create function public.admin_set_template_default(p_template uuid, p_statuses public.listing_status[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org_id(); v_status text;
begin
  if v_org is null or not private.has_role('admin') then raise exception 'Only administrators can assign default templates'; end if;
  select status into v_status from public.video_templates where id = p_template and organization_id = v_org;
  if v_status is null then raise exception 'Template not found'; end if;
  if v_status <> 'approved' and coalesce(array_length(p_statuses, 1), 0) > 0 then raise exception 'Approve the template before making it a default'; end if;
  update public.video_templates set default_for = array(select unnest(default_for) except select unnest(p_statuses))
  where organization_id = v_org and id <> p_template and default_for && p_statuses;
  update public.video_templates set default_for = coalesce(p_statuses, '{}') where id = p_template;
  perform private.audit(v_org, 'template.default', 'video_template', p_template::text, jsonb_build_object('statuses', p_statuses));
end $$;
revoke execute on function public.admin_set_template_default(uuid, public.listing_status[]) from public, anon;
grant execute on function public.admin_set_template_default(uuid, public.listing_status[]) to authenticated;

commit;

-- ════════ 20261112000100_editor_voice.sql ════════
begin;

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

commit;

-- ════════ 20261113000100_admin_control_center.sql ════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- Stage 13 — Admin control center
--
--   • Company dashboard, per-person activity, AI usage log, system health:
--     read through security-definer functions that check the caller's role.
--   • AI controls: each AI feature can be switched on or off; video AI provider,
--     model and price used for estimates; a daily spending ceiling on top of
--     the monthly one; provider keys stored encrypted (never readable back).
--   • Company video library: archive, reassign, delete (with the title typed
--     back), restrict a project from other administrators, lock it read-only.
--   • Workers report a heartbeat so the health page knows they are alive.
--
-- Every change goes through a function that re-checks the caller's role and
-- writes the audit log. Nothing here is decided by the browser.
-- ════════════════════════════════════════════════════════════════════════════

-- ── AI controls ─────────────────────────────────────────────────────────────
alter table public.organization_settings
  add column ai_depth_motion_enabled boolean not null default true,
  add column ai_voiceover_enabled boolean not null default true,
  add column ai_captions_enabled boolean not null default true,
  add column video_ai_provider text not null default 'muapi' check (video_ai_provider in ('muapi')),
  add column video_ai_model text not null default 'kling-v2.1-standard-i2v' check (video_ai_model ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  add column video_ai_clip_cost_cents integer not null default 40 check (video_ai_clip_cost_cents between 0 and 10000),
  add column daily_ai_budget_cents integer check (daily_ai_budget_cents >= 0),
  add column ai_budget_alert_percent integer not null default 80 check (ai_budget_alert_percent between 10 and 100);
grant update (ai_depth_motion_enabled, ai_voiceover_enabled, ai_captions_enabled, video_ai_provider, video_ai_model,
              video_ai_clip_cost_cents, daily_ai_budget_cents, ai_budget_alert_percent) on public.organization_settings to authenticated;
-- (settings_update policy: Super Admin only)

-- Provider keys: the video AI key joins the Claude key (still service-role only, never readable by people).
alter table public.organization_secrets drop constraint organization_secrets_name_check;
alter table public.organization_secrets add constraint organization_secrets_name_check
  check (name in ('anthropic_api_key', 'muapi_api_key'));

/* Which provider keys are saved — the last 4 characters and when, never the key (Super Admin). */
create function public.provider_key_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.is_super_admin() then coalesce(
    (select jsonb_object_agg(s.name, jsonb_build_object('last4', s.last4, 'updated_at', s.updated_at))
       from public.organization_secrets s where s.organization_id = private.current_org_id()), '{}'::jsonb)
  else null end;
$$;
revoke all on function public.provider_key_status() from public, anon;
grant execute on function public.provider_key_status() to authenticated;

/* Is one AI feature switched on for the caller's company? */
create function private.ai_feature(p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p_feature
      when 'generative' then s.ai_enabled
      when 'depth' then s.ai_depth_motion_enabled
      when 'voiceover' then s.ai_voiceover_enabled
      when 'captions' then s.ai_captions_enabled
      when 'director' then s.claude_enabled
      else false end
    from public.organization_settings s where s.organization_id = private.current_org_id()), false);
$$;
revoke all on function private.ai_feature(text) from public, anon;
grant execute on function private.ai_feature(text) to authenticated, service_role;

/* What AI the signed-in person may use right now (people who aren't admins can't read company settings). */
create function public.my_ai_features() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'can_use_ai', private.can_use_ai(),
    'generative', private.ai_feature('generative'),
    'depth', private.ai_feature('depth'),
    'voiceover', private.ai_feature('voiceover'),
    'captions', private.ai_feature('captions'),
    'director', private.ai_feature('director'),
    'video_provider', s.video_ai_provider,
    'video_model', s.video_ai_model,
    'video_key_saved', exists (select 1 from public.organization_secrets k where k.organization_id = s.organization_id and k.name = 'muapi_api_key'))
  from public.organization_settings s where s.organization_id = private.current_org_id();
$$;
revoke all on function public.my_ai_features() from public, anon;
grant execute on function public.my_ai_features() to authenticated;

-- ── Spending ────────────────────────────────────────────────────────────────
create function private.ai_spent_today(p_org uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)) from public.generation_jobs
                    where organization_id = p_org and created_at >= date_trunc('day', now()) and status <> 'cancelled'), 0)
       + coalesce((select sum(cost_cents) from public.director_runs
                    where organization_id = p_org and created_at >= date_trunc('day', now())), 0);
$$;

/* null when spending `p_extra` more is allowed, otherwise the reason. */
create function private.ai_ceiling_reached(p_org uuid, p_extra numeric) returns text
language plpgsql stable security definer set search_path = '' as $$
declare s public.organization_settings;
begin
  select * into s from public.organization_settings where organization_id = p_org;
  if s.monthly_ai_budget_cents is not null then
    if private.ai_spent_this_month(p_org) >= s.monthly_ai_budget_cents
       or private.ai_spent_this_month(p_org) + p_extra > s.monthly_ai_budget_cents then
      return 'Monthly AI spending limit reached';
    end if;
  end if;
  if s.daily_ai_budget_cents is not null then
    if private.ai_spent_today(p_org) >= s.daily_ai_budget_cents
       or private.ai_spent_today(p_org) + p_extra > s.daily_ai_budget_cents then
      return 'Daily AI spending limit reached';
    end if;
  end if;
  return null;
end $$;

/* Paid AI clips are estimated at least at the company's price per clip (set by the Super Admin). */
create function private.estimate_generation_cost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- never below the company's price per clip, so a request can't dodge the spending ceiling
  new.cost_estimate_cents := case when new.provider = 'local-depth' then 0
    else greatest(coalesce(new.cost_estimate_cents, 0),
                  coalesce((select s.video_ai_clip_cost_cents from public.organization_settings s where s.organization_id = new.organization_id), 0)) end;
  return new;
end $$;
create trigger generation_jobs_aa_estimate before insert on public.generation_jobs
  for each row execute function private.estimate_generation_cost();

create or replace function private.enforce_ai_budget() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  -- the local depth method runs on our own server and costs nothing; paid providers stop at the ceilings
  if new.provider <> 'local-depth' then
    v_reason := private.ai_ceiling_reached(new.organization_id, coalesce(new.cost_estimate_cents, 0));
    if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

-- The AI Director also stops at the daily ceiling.
create or replace function public.start_director_run(p_listing_id uuid, p_style text, p_photo_count integer) returns public.director_runs
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  s public.organization_settings;
  v_count integer;
  v_run public.director_runs;
  v_reason text;
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
  v_reason := private.ai_ceiling_reached(caller.organization_id, 0);
  if v_reason is not null then raise exception '%', v_reason using errcode = 'P0001'; end if;
  insert into public.director_runs (organization_id, listing_id, created_by, style, model, photo_count)
  values (caller.organization_id, p_listing_id, caller.id, p_style, s.claude_model, p_photo_count) returning * into v_run;
  perform private.audit(caller.organization_id, 'director.started', 'director_run', v_run.id::text, jsonb_build_object('listing', p_listing_id, 'style', p_style, 'model', s.claude_model));
  return v_run;
end $$;

-- AI camera clips: the local depth method follows its own switch now.
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
              and ((provider = 'local-depth' and private.ai_feature('depth'))
                   or (provider <> 'local-depth' and private.ai_feature('generative'))));

-- ── AI that runs on our own server (narration, captions): logged and switchable ──
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.video_projects (id) on delete set null,
  kind text not null check (kind in ('voiceover', 'transcription')),
  provider text not null default 'local' check (char_length(provider) <= 60),
  model text not null check (char_length(model) <= 120),
  status public.job_status not null default 'running',
  error_message text check (char_length(error_message) <= 500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_usage_events_org_idx on public.ai_usage_events (organization_id, created_at desc);
alter table public.ai_usage_events enable row level security;
create policy ai_usage_select on public.ai_usage_events for select to authenticated
  using (organization_id = private.current_org_id() and (user_id = auth.uid() or private.is_super_admin()));
revoke insert, update, delete on public.ai_usage_events from authenticated;

/* Starts a narration or caption job: checks the switch, the person's AI access and their edit access. */
create function public.start_local_ai(p_kind text, p_project uuid, p_model text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles;
  v_id uuid;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or not caller.is_active or caller.role < 'editor' or not caller.can_use_ai then
    raise exception 'AI isn''t switched on for your account' using errcode = '42501';
  end if;
  if p_kind not in ('voiceover', 'transcription') then raise exception 'Unknown AI feature' using errcode = '22023'; end if;
  if not private.ai_feature(case p_kind when 'voiceover' then 'voiceover' else 'captions' end) then
    raise exception '% is switched off for your company', case p_kind when 'voiceover' then 'AI narration' else 'Automatic captions' end using errcode = '42501';
  end if;
  if not private.can_edit_project(p_project) then raise exception 'You can''t edit this video' using errcode = '42501'; end if;
  insert into public.ai_usage_events (organization_id, user_id, project_id, kind, model)
  values (caller.organization_id, caller.id, p_project, p_kind, left(coalesce(p_model, 'local'), 120)) returning id into v_id;
  return v_id;
end $$;

create function public.finish_local_ai(p_id uuid, p_ok boolean, p_error text, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.ai_usage_events set status = case when p_ok then 'succeeded'::public.job_status else 'failed'::public.job_status end,
         error_message = case when p_ok then null else left(p_error, 500) end, details = coalesce(p_details, '{}'::jsonb), finished_at = now()
  where id = p_id and user_id = auth.uid() and status = 'running';
$$;
revoke all on function public.start_local_ai(text, uuid, text) from public, anon;
revoke all on function public.finish_local_ai(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.start_local_ai(text, uuid, text) to authenticated;
grant execute on function public.finish_local_ai(uuid, boolean, text, jsonb) to authenticated;

-- ── Projects: restricted, locked, archived ──────────────────────────────────
alter table public.video_projects
  add column restricted boolean not null default false,
  add column locked boolean not null default false,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null;
create index video_projects_archived_idx on public.video_projects (organization_id) where archived_at is not null;

/*
 * Restricted: only the owner, the people assigned to it and the Super Admin can open it.
 * Locked or archived: read-only for everyone except the Super Admin.
 */
create or replace function private.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.video_projects vp
    where vp.id = p_project
      and vp.organization_id = private.current_org_id()
      and (private.is_super_admin()
           or vp.created_by = auth.uid()
           or exists (select 1 from public.project_members m where m.project_id = vp.id and m.user_id = auth.uid())
           or (private.has_role('admin') and not vp.restricted))
  )
$$;

create or replace function private.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('editor') and exists (
    select 1 from public.video_projects vp
    where vp.id = p_project
      and vp.organization_id = private.current_org_id()
      and (private.is_super_admin()
           or (not vp.locked and vp.archived_at is null
               and (vp.created_by = auth.uid()
                    or exists (select 1 from public.project_members m
                               where m.project_id = vp.id and m.user_id = auth.uid() and m.access = 'editor'))))
  )
$$;

drop policy projects_select on public.video_projects;
create policy projects_select on public.video_projects for select to authenticated
  using (organization_id = private.current_org_id()
         and (private.is_super_admin() or created_by = auth.uid() or private.is_project_member(id)
              or (private.has_role('admin') and not restricted)));

/* Owner, restriction, lock and archive can only change through the admin functions below. */
create function private.protect_project_admin_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.created_by is distinct from old.created_by or new.restricted is distinct from old.restricted
    or new.locked is distinct from old.locked or new.archived_at is distinct from old.archived_at
    or new.archived_by is distinct from old.archived_by or new.organization_id is distinct from old.organization_id) then
    raise exception 'Only an administrator can change who owns this video or who can open it' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger video_projects_protect_admin_fields before update on public.video_projects
  for each row execute function private.protect_project_admin_fields();

create function private.admin_caller() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or not caller.is_active or caller.role < 'admin' then
    raise exception 'Only administrators can do this' using errcode = '42501';
  end if;
  return caller;
end $$;

create function private.admin_project(caller public.profiles, p_project uuid) returns public.video_projects
language plpgsql stable security definer set search_path = '' as $$
declare proj public.video_projects;
begin
  select * into proj from public.video_projects where id = p_project;
  if proj.id is null or proj.organization_id <> caller.organization_id
     or (proj.restricted and caller.role <> 'super_admin' and proj.created_by is distinct from caller.id) then
    raise exception 'Video not found' using errcode = 'P0002';
  end if;
  return proj;
end $$;

/* Restrict a video from other administrators (Super Admin) or lock it read-only (administrators). */
create function public.admin_set_project_access(p_project uuid, p_restricted boolean, p_locked boolean) returns public.video_projects
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.admin_caller();
  proj public.video_projects := private.admin_project(caller, p_project);
  v_row public.video_projects;
begin
  if p_restricted is distinct from proj.restricted and caller.role <> 'super_admin' then
    raise exception 'Only the Super Admin can restrict a video from other administrators' using errcode = '42501';
  end if;
  update public.video_projects set restricted = p_restricted, locked = p_locked where id = proj.id returning * into v_row;
  perform private.audit_as(caller.id, caller.organization_id, 'project.access_changed', 'video_project', proj.id::text,
    jsonb_build_object('title', proj.title, 'restricted', jsonb_build_array(proj.restricted, p_restricted), 'locked', jsonb_build_array(proj.locked, p_locked)));
  return v_row;
end $$;

create function private.require_super_admin() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles := private.admin_caller();
begin
  if caller.role <> 'super_admin' then raise exception 'Only the Super Admin can do this' using errcode = '42501'; end if;
  return caller;
end $$;

create function public.admin_archive_project(p_project uuid, p_archived boolean) returns public.video_projects
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.require_super_admin();
  proj public.video_projects := private.admin_project(caller, p_project);
  v_row public.video_projects;
begin
  update public.video_projects set archived_at = case when p_archived then coalesce(proj.archived_at, now()) end,
         archived_by = case when p_archived then caller.id end
  where id = proj.id returning * into v_row;
  perform private.audit_as(caller.id, caller.organization_id, case when p_archived then 'project.archived' else 'project.unarchived' end,
    'video_project', proj.id::text, jsonb_build_object('title', proj.title));
  return v_row;
end $$;

/* Give a video to another employee (who becomes its owner). */
create function public.admin_reassign_project(p_project uuid, p_new_owner uuid) returns public.video_projects
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.require_super_admin();
  proj public.video_projects := private.admin_project(caller, p_project);
  target public.profiles;
  v_row public.video_projects;
begin
  select * into target from public.profiles where id = p_new_owner;
  if target.id is null or target.organization_id <> caller.organization_id then raise exception 'User not found' using errcode = 'P0002'; end if;
  if not target.is_active or target.role < 'editor' then
    raise exception 'This person can''t own videos (they must be an active Editor or above)' using errcode = '42501';
  end if;
  if proj.batch_id is not null then
    -- a video in a batch belongs with its batch owner; reassigning takes it out of the batch
    update public.video_projects set batch_id = null where id = proj.id;
  end if;
  update public.video_projects set created_by = target.id where id = proj.id returning * into v_row;
  -- the new owner no longer needs a separate assignment
  delete from public.project_members where project_id = proj.id and user_id = target.id;
  perform private.audit_as(caller.id, caller.organization_id, 'project.reassigned', 'video_project', proj.id::text,
    jsonb_build_object('title', proj.title, 'from', proj.created_by, 'to', target.id));
  return v_row;
end $$;

/*
 * Permanently deletes a video. The title must be typed back exactly. Returns the
 * stored files so the server can remove them from storage too.
 */
create function public.admin_delete_project(p_project uuid, p_confirm_title text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller public.profiles := private.require_super_admin();
  proj public.video_projects := private.admin_project(caller, p_project);
  v_files jsonb;
begin
  if btrim(coalesce(p_confirm_title, '')) <> btrim(proj.title) then
    raise exception 'Type the video''s title exactly to delete it' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(distinct f), '[]'::jsonb) into v_files from (
    select jsonb_build_object('bucket', 'video-exports', 'path', r.output_path) f
      from public.render_jobs r where r.project_id = proj.id and r.output_path is not null
    union all
    select jsonb_build_object('bucket', m.bucket, 'path', m.storage_path)
      from public.media_assets m where m.project_id = proj.id
  ) x;
  perform private.audit_as(caller.id, caller.organization_id, 'project.deleted', 'video_project', proj.id::text,
    jsonb_build_object('title', proj.title, 'owner', proj.created_by, 'files', jsonb_array_length(v_files)));
  delete from public.video_projects where id = proj.id;
  return v_files;
end $$;

revoke all on function private.admin_caller() from public, anon;
revoke all on function private.require_super_admin() from public, anon;
revoke all on function private.admin_project(public.profiles, uuid) from public, anon;
grant execute on function private.admin_caller() to authenticated;
grant execute on function private.require_super_admin() to authenticated;
grant execute on function private.admin_project(public.profiles, uuid) to authenticated;
revoke all on function public.admin_set_project_access(uuid, boolean, boolean) from public, anon;
revoke all on function public.admin_archive_project(uuid, boolean) from public, anon;
revoke all on function public.admin_reassign_project(uuid, uuid) from public, anon;
revoke all on function public.admin_delete_project(uuid, text) from public, anon;
grant execute on function public.admin_set_project_access(uuid, boolean, boolean) to authenticated;
grant execute on function public.admin_archive_project(uuid, boolean) to authenticated;
grant execute on function public.admin_reassign_project(uuid, uuid) to authenticated;
grant execute on function public.admin_delete_project(uuid, text) to authenticated;

-- ── Worker heartbeats ───────────────────────────────────────────────────────
create table public.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 120),
  kind text not null check (kind in ('render', 'ai')),
  host text check (char_length(host) <= 120),
  providers text[] not null default '{}',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_job uuid,
  jobs_done integer not null default 0 check (jobs_done >= 0),
  last_error text check (char_length(last_error) <= 500)
);
alter table public.worker_heartbeats enable row level security;
-- workers are shared by every company on this server; people read them through admin_system_health()
revoke all on public.worker_heartbeats from anon, authenticated;

create function public.worker_heartbeat(p_worker text, p_kind text, p_host text, p_providers text[], p_job uuid, p_done integer, p_error text) returns void
language sql security definer set search_path = '' as $$
  insert into public.worker_heartbeats (worker_id, kind, host, providers, current_job, jobs_done, last_error)
  values (left(p_worker, 120), p_kind, left(p_host, 120), coalesce(p_providers, '{}'), p_job, greatest(coalesce(p_done, 0), 0), left(p_error, 500))
  on conflict (worker_id) do update set last_seen_at = now(), kind = excluded.kind, host = excluded.host, providers = excluded.providers,
    current_job = excluded.current_job, jobs_done = excluded.jobs_done, last_error = coalesce(excluded.last_error, public.worker_heartbeats.last_error);
  delete from public.worker_heartbeats where last_seen_at < now() - interval '7 days';
$$;
revoke all on function public.worker_heartbeat(text, text, text, text[], uuid, integer, text) from public, anon, authenticated;
grant execute on function public.worker_heartbeat(text, text, text, text[], uuid, integer, text) to service_role;

-- ── Read-only overviews for administrators ──────────────────────────────────

/* Company dashboard. Spending is shown to the Super Admin only. */
create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller public.profiles := private.admin_caller();
  v_org uuid := caller.organization_id;
  s public.organization_settings;
  v jsonb;
begin
  select * into s from public.organization_settings where organization_id = v_org;
  select jsonb_build_object(
    'users', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'active'),
                'invited', count(*) filter (where status = 'invited'), 'suspended', count(*) filter (where status = 'suspended'),
                'deactivated', count(*) filter (where status = 'deactivated'))
              from public.profiles where organization_id = v_org),
    'listings', (select count(*) from public.listings where organization_id = v_org),
    'projects', (select jsonb_build_object('total', count(*), 'archived', count(*) filter (where archived_at is not null),
                   'this_month', count(*) filter (where created_at >= date_trunc('month', now())))
                 from public.video_projects where organization_id = v_org),
    'videos', (select jsonb_build_object('total', count(*), 'this_month', count(*) filter (where finished_at >= date_trunc('month', now())))
               from public.render_jobs where organization_id = v_org and status = 'succeeded'),
    'render_queue', (select jsonb_build_object('queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
                       'failed_today', count(*) filter (where status = 'failed' and finished_at >= now() - interval '24 hours'),
                       'oldest_queued_seconds', coalesce(extract(epoch from now() - min(created_at) filter (where status = 'queued'))::integer, 0))
                     from public.render_jobs where organization_id = v_org),
    'ai_jobs', (select jsonb_build_object('total', count(*), 'this_month', count(*) filter (where created_at >= date_trunc('month', now())),
                  'queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
                  'failed_month', count(*) filter (where status = 'failed' and created_at >= date_trunc('month', now())))
                from public.generation_jobs where organization_id = v_org),
    'ai_failures_month', (select count(*) from public.generation_jobs where organization_id = v_org and status = 'failed' and created_at >= date_trunc('month', now()))
                       + (select count(*) from public.director_runs where organization_id = v_org and status = 'failed' and created_at >= date_trunc('month', now()))
                       + (select count(*) from public.ai_usage_events where organization_id = v_org and status = 'failed' and created_at >= date_trunc('month', now())),
    'storage', (select jsonb_build_object('bytes', coalesce(sum(size_bytes), 0), 'files', count(*),
                  'by_bucket', coalesce((select jsonb_object_agg(b, n) from (select bucket b, sum(size_bytes) n from public.media_assets
                                         where organization_id = v_org group by bucket) x), '{}'::jsonb))
                from public.media_assets where organization_id = v_org),
    'spend', case when caller.role = 'super_admin' then jsonb_build_object(
                'month_cents', private.ai_spent_this_month(v_org), 'today_cents', private.ai_spent_today(v_org),
                'monthly_budget_cents', s.monthly_ai_budget_cents, 'daily_budget_cents', s.daily_ai_budget_cents,
                'alert_percent', s.ai_budget_alert_percent,
                'by_provider', coalesce((select jsonb_object_agg(p, c) from (
                    select provider p, sum(coalesce(cost_actual_cents, cost_estimate_cents, 0)) c from public.generation_jobs
                     where organization_id = v_org and created_at >= date_trunc('month', now()) and status <> 'cancelled' group by provider
                    union all
                    select 'claude', sum(cost_cents) from public.director_runs where organization_id = v_org and created_at >= date_trunc('month', now())
                  ) x where c is not null), '{}'::jsonb)) end
  ) into v;
  return v;
end $$;

/* One row per person in the company with what they have made and used. */
create function public.admin_user_activity() returns table (
  id uuid, full_name text, email text, role public.app_role, status text, job_title text,
  can_download boolean, can_use_ai boolean, can_batch_generate boolean,
  max_videos_per_month integer, max_ai_generations_per_month integer,
  projects_owned bigint, projects_assigned bigint, listings_owned bigint,
  videos_rendered bigint, videos_this_month bigint, ai_jobs_this_month bigint, ai_generations_total bigint,
  storage_bytes bigint, last_activity_at timestamptz, last_activity text
)
language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles := private.admin_caller();
begin
  return query
  select p.id, p.full_name, p.email, p.role, p.status, p.job_title, p.can_download, p.can_use_ai, p.can_batch_generate,
    p.max_videos_per_month, p.max_ai_generations_per_month,
    (select count(*) from public.video_projects vp where vp.created_by = p.id),
    (select count(*) from public.project_members m where m.user_id = p.id),
    (select count(*) from public.listings l where l.created_by = p.id),
    (select count(*) from public.render_jobs r where r.requested_by = p.id and r.status = 'succeeded'),
    (select count(*) from public.video_projects vp where vp.created_by = p.id and vp.created_at >= date_trunc('month', now())),
    (select count(*) from public.generation_jobs g where g.requested_by = p.id and g.created_at >= date_trunc('month', now())),
    (select count(*) from public.generation_jobs g where g.requested_by = p.id)
      + (select count(*) from public.director_runs d where d.created_by = p.id)
      + (select count(*) from public.ai_usage_events e where e.user_id = p.id),
    (select coalesce(sum(m.size_bytes), 0)::bigint from public.media_assets m where m.uploaded_by = p.id),
    a.created_at, a.action
  from public.profiles p
  left join lateral (select al.created_at, al.action from public.audit_log al
                     where al.actor_id = p.id order by al.id desc limit 1) a on true
  where p.organization_id = caller.organization_id
  order by p.last_name, p.first_name;
end $$;

/* The AI usage log: paid clips, Director runs, narration and captions (Super Admin). */
create function public.admin_ai_usage(p_kind text default null, p_status text default null, p_user uuid default null,
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
    select e.id::text, e.created_at, e.kind, e.provider, e.model, e.user_id, e.status::text, 0::numeric, e.error_message, e.project_id, null::uuid
      from public.ai_usage_events e where e.organization_id = caller.organization_id
  ) u (id, at, kind, provider, model, user_id, status, cost_cents, error_message, project_id, listing_id)
  where (p_kind is null or u.kind = p_kind) and (p_status is null or u.status = p_status) and (p_user is null or u.user_id = p_user)
    and (p_before is null or u.at < p_before)
  order by u.at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

/* Queue and worker health (administrators). */
create function public.admin_system_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  caller public.profiles := private.admin_caller();
  v_org uuid := caller.organization_id;
begin
  return jsonb_build_object(
    'database_time', now(),
    'render', (select jsonb_build_object('queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
                 'failed_24h', count(*) filter (where status = 'failed' and finished_at >= now() - interval '24 hours'),
                 'succeeded_24h', count(*) filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours'),
                 'stuck', count(*) filter (where status = 'running' and started_at < now() - interval '20 minutes'),
                 'oldest_queued_seconds', coalesce(extract(epoch from now() - min(created_at) filter (where status = 'queued'))::integer, 0))
               from public.render_jobs where organization_id = v_org),
    'ai', (select jsonb_build_object('queued', count(*) filter (where status = 'queued'), 'running', count(*) filter (where status = 'running'),
             'failed_24h', count(*) filter (where status = 'failed' and finished_at >= now() - interval '24 hours'),
             'succeeded_24h', count(*) filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours'),
             'stuck', count(*) filter (where status = 'running' and started_at < now() - interval '30 minutes'),
             'oldest_queued_seconds', coalesce(extract(epoch from now() - min(created_at) filter (where status = 'queued'))::integer, 0))
           from public.generation_jobs where organization_id = v_org),
    'recent_failures', coalesce((select jsonb_agg(f order by f->>'at' desc) from (
        select jsonb_build_object('kind', 'render', 'id', r.id, 'project_id', r.project_id, 'at', r.finished_at, 'error', left(r.error_message, 200)) f
          from public.render_jobs r where r.organization_id = v_org and r.status = 'failed' order by r.finished_at desc nulls last limit 10) x), '[]'::jsonb)
      || coalesce((select jsonb_agg(f) from (
        select jsonb_build_object('kind', 'ai', 'id', g.id, 'provider', g.provider, 'at', g.finished_at, 'error', left(g.error_message, 200)) f
          from public.generation_jobs g where g.organization_id = v_org and g.status = 'failed' order by g.finished_at desc nulls last limit 10) y), '[]'::jsonb),
    'workers', coalesce((select jsonb_agg(jsonb_build_object('id', w.worker_id, 'kind', w.kind, 'host', w.host, 'providers', w.providers,
                           'started_at', w.started_at, 'last_seen_at', w.last_seen_at, 'seconds_since_seen', extract(epoch from now() - w.last_seen_at)::integer,
                           'busy', w.current_job is not null, 'jobs_done', w.jobs_done, 'last_error', w.last_error) order by w.kind, w.last_seen_at desc)
                         from public.worker_heartbeats w where w.last_seen_at > now() - interval '1 day'), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_dashboard() from public, anon;
revoke all on function public.admin_user_activity() from public, anon;
revoke all on function public.admin_ai_usage(text, text, uuid, timestamptz, integer) from public, anon;
revoke all on function public.admin_system_health() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_user_activity() to authenticated;
grant execute on function public.admin_ai_usage(text, text, uuid, timestamptz, integer) to authenticated;
grant execute on function public.admin_system_health() to authenticated;

/* Audit entries for AI settings and provider keys written by the app server (Super Admin, re-checked here). */
create function public.record_admin_action(p_action text, p_meta jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare caller public.profiles := private.require_super_admin();
begin
  if p_action !~ '^(ai|provider|claude|settings)\.[a-z_]{2,40}$' then raise exception 'Unknown action' using errcode = '22023'; end if;
  perform private.audit_as(caller.id, caller.organization_id, p_action, 'organization', caller.organization_id::text, coalesce(p_meta, '{}'::jsonb));
end $$;
revoke all on function public.record_admin_action(text, jsonb) from public, anon;
grant execute on function public.record_admin_action(text, jsonb) to authenticated;

commit;

-- ════════ 20261114000100_production_hardening.sql ════════
begin;

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

commit;
