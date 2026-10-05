-- ParkWatch T8.2: secure account / profile bootstrap. Builds on T8.1.
--
-- * Sign-up always creates a CITIZEN profile. The display name may come from
--   sign-up metadata; a role in metadata is IGNORED (metadata is user-editable).
-- * ensure_my_profile(): safe recovery when an authenticated user has no
--   profile row (e.g. created before the trigger existed). Creates CITIZEN only,
--   for the caller only, never changes an existing profile.
-- * Officer data access now requires BOTH an active organization membership
--   AND a server-set officer/supervisor profile role (defense in depth; both
--   are writable only by the service role / admin tooling).

-- Display name from sign-up metadata, sanitized; role is always CITIZEN.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  requested_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
begin
  insert into public.profiles (id, role, display_name)
  values (new.id, 'CITIZEN', requested_name)
  on conflict (id) do nothing;
  return new;
end $$;

create function public.ensure_my_profile() returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  result public.profiles;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.profiles (id, role, display_name) values (me, 'CITIZEN', '')
  on conflict (id) do nothing;
  select * into result from public.profiles where id = me;
  return result;
end $$;

revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;

-- Officer access: active membership AND a server-set enforcement profile role.
create or replace function public.is_enforcement_member_for(jurisdiction text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.jurisdictions j
    join public.organization_members m on m.organization_id = j.organization_id
    join public.profiles p on p.id = m.user_id
    where j.id = jurisdiction
      and m.user_id = auth.uid()
      and m.active
      and m.member_role in ('OFFICER', 'SUPERVISOR')
      and p.role in ('OFFICER', 'SUPERVISOR')
  );
$$;
