-- ============================================================================
-- T8.7: profile pictures.
--
-- * Private bucket `profile-avatars` (never public; images only; 2 MB max).
--   Objects live under "<user id>/<file>"; a signed-in user can read, write
--   and delete ONLY their own folder. Nobody else (not officers, not anon)
--   can read another user's avatar.
-- * profiles.avatar_storage_path stores only the object path (never image
--   data, never a URL). It is NOT client-writable: the column grant still
--   allows only display_name. It changes through set_my_avatar(), which checks
--   that the path is in the caller's own folder and that the object exists.
-- * set_my_avatar() returns the previous path so the app deletes the replaced
--   object (old avatars do not pile up). Role/authorization data is untouched.
-- ============================================================================

alter table public.profiles
  add column avatar_storage_path text
    check (avatar_storage_path is null or avatar_storage_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$');

alter table public.profiles
  add constraint profiles_avatar_in_own_folder check (avatar_storage_path is null or split_part(avatar_storage_path, '/', 1) = id::text);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Own folder only, for every operation.
create policy pw_avatar_select_own on storage.objects for select to authenticated
  using (bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy pw_avatar_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy pw_avatar_update_own on storage.objects for update to authenticated
  using (bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy pw_avatar_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'profile-avatars' and split_part(name, '/', 1) = auth.uid()::text);

-- Set (p_path) or remove (null) the caller's avatar. Returns the previous path.
create function public.set_my_avatar(p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  previous text;
begin
  if me is null then
    raise exception 'UNAUTHENTICATED: Sign in required.' using errcode = 'P0001';
  end if;
  if p_path is not null then
    if split_part(p_path, '/', 1) <> me::text
       or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$' then
      raise exception 'FORBIDDEN: Not your avatar.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'profile-avatars' and o.name = p_path) then
      raise exception 'EVIDENCE_NOT_UPLOADED: The photo was not uploaded.' using errcode = 'P0001';
    end if;
  end if;
  select p.avatar_storage_path into previous from public.profiles p where p.id = me for update;
  if not found then
    raise exception 'NOT_FOUND: Profile not found.' using errcode = 'P0001';
  end if;
  update public.profiles set avatar_storage_path = p_path where id = me;
  return jsonb_build_object('previous_path', previous, 'path', p_path);
end $$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;
