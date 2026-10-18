-- ============================================================================
-- T9.4: citizen username (public handle) with a 30-day change cooldown.
--
-- * profiles.username: lowercase a-z 0-9 _ , 3-24 characters, unique (so
--   uniqueness is case-insensitive by construction). Null until chosen.
--   Separate from display_name, which stays the person's (private) name.
-- * CITIZEN accounts only in v1; staff keep their operational display names.
-- * Only through set_username(): the caller is auth.uid() (no user parameter),
--   the columns have no client UPDATE grant. Server time only.
-- * Any successful set (including the first) starts a 30-day cooldown; asking
--   for the current name again changes nothing and does not restart it.
-- * Reserved names live in a table the app cannot read.
-- * Audit: USERNAME_CHANGED with empty metadata (no old/new names kept).
-- * Closing the account clears the username (request_account_deletion below).
-- ============================================================================

alter table public.profiles
  add column username text,
  add column username_changed_at timestamptz,
  add constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,24}$');
create unique index profiles_username_key on public.profiles (username);

create table public.reserved_usernames (
  name text primary key check (name ~ '^[a-z0-9_]{1,24}$')
);
alter table public.reserved_usernames enable row level security; -- no policies: not readable by clients
revoke all on table public.reserved_usernames from public, anon, authenticated;
insert into public.reserved_usernames (name) values
  ('admin'), ('administrator'), ('root'), ('system'), ('sysadmin'), ('superuser'), ('owner'),
  ('parkwatch'), ('support'), ('help'), ('helpdesk'), ('info'), ('contact'), ('team'), ('staff'),
  ('official'), ('officer'), ('supervisor'), ('moderator'), ('mod'), ('security'), ('privacy'),
  ('legal'), ('police'), ('poliisi'), ('pysakointi'), ('pysakoinninvalvonta'), ('valvoja'),
  ('api'), ('null'), ('undefined'), ('anonymous'), ('deleted'), ('unknown'), ('me'), ('you'), ('user');

-- Same normalization as the app (src/auth/username.ts): trim, lowercase.
create function public.pw_normalize_username(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(p, '')));
$$;

create function public.set_username(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  p public.profiles;
  v text := public.pw_normalize_username(p_username);
  cooldown constant interval := interval '30 days';
begin
  if v !~ '^[a-z0-9_]{3,24}$' then
    perform public.pw_fail('INVALID_INPUT', 'Use 3-24 letters a-z, numbers or underscore.');
  end if;
  if exists (select 1 from public.reserved_usernames r where r.name = v) or v ~ '^(parkwatch|admin)' then
    perform public.pw_fail('INVALID_INPUT', 'This username is not available.');
  end if;

  select * into p from public.profiles x where x.id = me for update;
  if not found then perform public.pw_fail('NOT_FOUND', 'Profile not found.'); end if;
  if p.deletion_requested_at is not null then perform public.pw_fail('FORBIDDEN', 'This account has been closed.'); end if;
  if p.role <> 'CITIZEN' then perform public.pw_fail('FORBIDDEN', 'Usernames are for citizen accounts.'); end if;

  if p.username is not distinct from v then
    return jsonb_build_object('changed', false, 'username', p.username,
      'next_change_at', p.username_changed_at + cooldown);
  end if;
  if p.username_changed_at is not null and p.username_changed_at + cooldown > now() then
    return jsonb_build_object('changed', false, 'reason', 'COOLDOWN', 'username', p.username,
      'next_change_at', p.username_changed_at + cooldown);
  end if;

  begin
    update public.profiles set username = v, username_changed_at = now() where id = me;
  exception when unique_violation then
    -- also settles two accounts claiming the same name at the same moment: one wins
    return jsonb_build_object('changed', false, 'reason', 'TAKEN', 'username', p.username,
      'next_change_at', case when p.username_changed_at is null then null else p.username_changed_at + cooldown end);
  end;

  perform public.pw_audit(me, 'CITIZEN', 'profile', me, 'USERNAME_CHANGED', '{}'::jsonb);
  return jsonb_build_object('changed', true, 'username', v, 'next_change_at', now() + cooldown);
end $$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;
revoke all on function public.pw_normalize_username(text) from public, anon, authenticated;

-- Account closure (T9.3) now also clears the username, which frees it.
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
    set deletion_requested_at = now(), display_name = '', avatar_storage_path = null,
        username = null, username_changed_at = null
    where id = me;
  delete from public.push_devices where user_id = me;
  delete from public.notifications where recipient_id = me;
  get diagnostics removed_notifications = row_count;

  perform public.pw_audit(me, 'CITIZEN', 'profile', me, 'ACCOUNT_DELETION_REQUESTED', '{}'::jsonb);
  return jsonb_build_object('requested', true, 'changed', true, 'avatar_path', old_avatar);
end $$;
revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;
