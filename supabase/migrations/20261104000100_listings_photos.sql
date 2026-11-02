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
