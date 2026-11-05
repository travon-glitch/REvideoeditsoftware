-- ════════════════════════════════════════════════════════════════════════════
-- Every company always has its settings row.
--
-- The row is made by the first-login setup. If the first account was created some other way
-- (by hand in the Supabase dashboard), it was missing and the admin pages said
-- "Settings are not available". This adds it now, and lets an administrator's page add it
-- again if it's ever missing.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.organization_settings (organization_id)
select id from public.organizations
on conflict do nothing;

create function public.ensure_org_settings() returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org_id();
begin
  if v_org is null or not private.has_role('admin') then
    raise exception 'Only administrators can do this' using errcode = '42501';
  end if;
  insert into public.organization_settings (organization_id) values (v_org) on conflict do nothing;
end $$;
revoke all on function public.ensure_org_settings() from public, anon;
grant execute on function public.ensure_org_settings() to authenticated;
