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
