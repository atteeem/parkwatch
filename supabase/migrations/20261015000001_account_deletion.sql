-- ============================================================================
-- T9.3: citizen account deletion ("close my account") - retention rules.
--
-- A citizen can close their own account in the app. What happens at once:
--   * profiles.deletion_requested_at is set; display name and profile
--     picture path are cleared (the app deletes the picture object);
--   * the citizen's notifications (personal inbox) and push devices are deleted;
--   * no new report can be submitted for this account (trigger below);
--   * one audit event ACCOUNT_DELETION_REQUESTED.
-- What is KEPT (enforcement records of the organization, see
-- docs/DATA_RETENTION.md): reports, their evidence, cases, outcomes, the reward
-- ledger and audit history. They stay linked only to the account's random id;
-- the console already shows citizens only as a pseudonymous reference.
-- Unpaid rewards are forfeited (there is no payout flow).
--
-- Final erasure of the sign-in identity (email, password) is an operator step
-- with the service role / Supabase Auth admin (docs/DATA_RETENTION.md); the
-- profile row stays because enforcement records reference it.
--
-- Officer / supervisor / admin accounts are managed by their organization
-- and cannot be closed from the app.
-- ============================================================================

alter table public.profiles add column deletion_requested_at timestamptz;

create function public.request_account_deletion(p_confirm text) returns jsonb
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

-- A closed account submits no new reports (also covers any future insert path).
create function public.pw_refuse_report_from_closed_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.citizen_id and p.deletion_requested_at is not null) then
    raise exception 'FORBIDDEN: This account has been closed.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger reports_refuse_closed_account before insert on public.reports
  for each row execute function public.pw_refuse_report_from_closed_account();

revoke all on function public.pw_refuse_report_from_closed_account() from public, anon, authenticated;
revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;
