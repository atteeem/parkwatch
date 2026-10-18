-- ============================================================================
-- ROLLBACK for 20261018000001_username.sql (DEVELOPMENT). Not a migration; not
-- run automatically. Removes all usernames. Restores request_account_deletion
-- to its T9.3 body (without the username lines).
-- ============================================================================

begin;
drop function if exists public.set_username(text);
drop function if exists public.pw_normalize_username(text);
drop table if exists public.reserved_usernames;
drop index if exists public.profiles_username_key;
alter table public.profiles drop constraint if exists profiles_username_format;

create or replace function public.request_account_deletion(p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  p public.profiles;
  old_avatar text;
  removed_notifications integer;
begin
  if coalesce(p_confirm, '') <> 'DELETE' then
    perform public.pw_fail('INVALID_INPUT', 'Type DELETE to confirm.');
  end if;
  select * into p from public.profiles x where x.id = me for update;
  if not found then perform public.pw_fail('NOT_FOUND', 'Profile not found.'); end if;
  if p.role <> 'CITIZEN' then
    perform public.pw_fail('FORBIDDEN', 'This account is managed by your organization.');
  end if;
  if p.deletion_requested_at is not null then
    return jsonb_build_object('requested', true, 'changed', false, 'avatar_path', null);
  end if;
  old_avatar := p.avatar_storage_path;
  update public.profiles
    set deletion_requested_at = now(), display_name = '', avatar_storage_path = null
    where id = me;
  delete from public.push_devices where user_id = me;
  delete from public.notifications where recipient_id = me;
  get diagnostics removed_notifications = row_count;
  perform public.pw_audit(me, 'CITIZEN', 'profile', me, 'ACCOUNT_DELETION_REQUESTED', '{}'::jsonb);
  return jsonb_build_object('requested', true, 'changed', true, 'avatar_path', old_avatar);
end $$;
revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;

alter table public.profiles drop column if exists username, drop column if exists username_changed_at;
delete from supabase_migrations.schema_migrations where version = '20261018000001';
commit;
