-- ============================================================================
-- T9.3 real-cloud database QA: account closure (DEVELOPMENT project only).
--
--   npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f scripts/sql/t93-cloud-qa.sql
--
-- NOTHING PERSISTS: one DO block that always ends by raising T93QA_RESULT, so
-- PostgreSQL rolls back everything it created (only sequence values - report
-- numbers - are not transactional). No real account is closed: the account
-- that is closed is a temporary citizen created inside the transaction.
-- Calls use the real roles as PostgREST does (SET ROLE + request.jwt.claims).
-- Fake Expo token strings only. No push is sent; no storage file is touched.
-- ============================================================================

create or replace function pg_temp.t93_as(p_uid uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare r jsonb;
begin
  begin
    perform set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute case when p_uid is null then 'set local role anon' else 'set local role authenticated' end;
    execute p_sql into r;
    execute 'reset role';
    return coalesce(r, 'null'::jsonb);
  exception when others then
    return jsonb_build_object('error', left(sqlerrm, 160));
  end;
end $f$;

do $qa$
declare
  res jsonb := '[]';
  citA uuid := '995673e9-ca33-4d8e-9ae8-ce5b2510ee65';
  citB uuid := 'b5866d93-2c1b-4eb4-b6d1-ebb7a15bdbbe';
  offA1 uuid := '3ad86131-a63e-460b-aa54-5d9a9db0c05c';
  supA uuid := 'a3baee62-5f3c-47c7-a3a8-157ea5316bd1';
  tmp uuid := gen_random_uuid();
  r jsonb;
  k record;
  n int;
  v_case uuid;
  v_case2 uuid;
  v_report uuid;
  snap_before jsonb;
  snap_after jsonb;
  others_before jsonb;
  others_after jsonb;
begin
  -- -------------------------------------------------------------------------
  -- schema
  res := res || jsonb_build_object('name', 'Schema: request_account_deletion exists exactly once, SECURITY DEFINER, search_path pinned',
    'ok', (select count(*) = 1 and bool_and(p.prosecdef) and bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'request_account_deletion'),
    'detail', (select jsonb_agg(jsonb_build_object('args', pg_get_function_identity_arguments(p.oid), 'config', p.proconfig)) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'request_account_deletion'));
  res := res || jsonb_build_object('name', 'Schema: the RPC has no target-user parameter (only p_confirm)',
    'ok', (select pg_get_function_identity_arguments(p.oid) = 'p_confirm text' from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'request_account_deletion'), 'detail', null);
  res := res || jsonb_build_object('name', 'Schema: profiles.deletion_requested_at timestamptz exists',
    'ok', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'deletion_requested_at' and data_type = 'timestamp with time zone'), 'detail', null);
  res := res || jsonb_build_object('name', 'Grants: authenticated may execute the RPC; anon and PUBLIC may not',
    'ok', has_function_privilege('authenticated', 'public.request_account_deletion(text)', 'execute')
          and not has_function_privilege('anon', 'public.request_account_deletion(text)', 'execute')
          and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.request_account_deletion(text)'::regprocedure and a.grantee = 0), 'detail', null);
  res := res || jsonb_build_object('name', 'Grants: closed-account trigger function not executable by anon/authenticated; search_path pinned',
    'ok', not has_function_privilege('anon', 'public.pw_refuse_report_from_closed_account()', 'execute')
          and not has_function_privilege('authenticated', 'public.pw_refuse_report_from_closed_account()', 'execute')
          and (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.pw_refuse_report_from_closed_account()'::regprocedure), 'detail', null);
  res := res || jsonb_build_object('name', 'Schema: trigger reports_refuse_closed_account exists once (BEFORE INSERT on reports)',
    'ok', (select count(*) = 1 from pg_trigger where tgname = 'reports_refuse_closed_account' and tgrelid = 'public.reports'::regclass), 'detail', null);
  res := res || jsonb_build_object('name', 'Grants: authenticated cannot update deletion_requested_at directly (no re-open)',
    'ok', not has_column_privilege('authenticated', 'public.profiles', 'deletion_requested_at', 'update'), 'detail', null);

  -- -------------------------------------------------------------------------
  -- temporary citizen with real history: a CHARGE_ISSUED report (reward + notification + outbox),
  -- an open report, a push device and a profile picture path
  insert into auth.users (id, email, raw_user_meta_data) values (tmp, 't93qa-citizen@invalid.test', '{}');
  update public.profiles set display_name = 'T93 QA Citizen', avatar_storage_path = tmp || '/avatar-t93qa.jpg' where id = tmp;
  perform pg_temp.t93_as(tmp, $s$select public.register_push_device('inst-t93qa-c1', 'ExponentPushToken[t93qafakeC1aaaa]', 'android')$s$);
  for n in 1..2 loop
    insert into storage.objects (bucket_id, name, owner) select 'report-evidence', tmp || '/t93qa-' || n || '/' || s || '.jpg', tmp from unnest(array['FRONT', 'SIDE', 'REAR']) s;
    r := pg_temp.t93_as(tmp, format($s$select public.submit_report('t93qa-%s', 'no-parking', 'T93 QA street (temporary)', now(), now(),
          (select jsonb_agg(jsonb_build_object('slot', s, 'capture_source', 'CAMERA', 'storage_path', %L || s || '.jpg', 'captured_at', now())) from unnest(array['FRONT','SIDE','REAR']) s))$s$, n, tmp || '/t93qa-' || n || '/'));
    if n = 1 then v_case := (r->>'case_id')::uuid; v_report := (r->>'report_id')::uuid; else v_case2 := (r->>'case_id')::uuid; end if;
  end loop;
  res := res || jsonb_build_object('name', 'Setup: temporary citizen submitted two reports', 'ok', v_case is not null and v_case2 is not null, 'detail', r);
  perform pg_temp.t93_as(offA1, format('select public.accept_case(%L)', v_case));
  perform pg_temp.t93_as(offA1, format('select public.start_inspection(%L)', v_case));
  for k in select unnest(array['vehiclePresent', 'plateMatches', 'violationConfirmed', 'restrictionVerified']) ck loop
    perform pg_temp.t93_as(offA1, format('select public.set_inspection_check(%L, %L::public.inspection_check_key, true)', v_case, k.ck));
  end loop;
  for k in select unnest(array['VEHICLE_FRONT', 'LICENSE_PLATE', 'PARKING_SIGN', 'VEHICLE_REAR']) et loop
    insert into storage.objects (bucket_id, name, owner) values ('officer-evidence', v_case || '/' || k.et || '.jpg', offA1);
    perform pg_temp.t93_as(offA1, format('select public.add_officer_evidence(%L, %L::public.officer_evidence_type, %L, now())', v_case, k.et, v_case || '/' || k.et || '.jpg'));
  end loop;
  r := pg_temp.t93_as(offA1, format($s$select public.complete_case(%L, 'CHARGE_ISSUED')$s$, v_case));
  res := res || jsonb_build_object('name', 'Setup: CHARGE_ISSUED gave the temporary citizen a verified report, reward and notification',
    'ok', (select status::text from public.reports where id = v_report) = 'VERIFIED'
          and exists (select 1 from public.notifications where recipient_id = tmp)
          and exists (select 1 from public.push_devices where user_id = tmp), 'detail', r);

  snap_before := jsonb_build_object(
    'reports', (select count(*) from public.reports where citizen_id = tmp),
    'evidence', (select count(*) from public.report_evidence e join public.reports x on x.id = e.report_id where x.citizen_id = tmp),
    'cases', (select count(*) from public.officer_cases c join public.reports x on x.id = c.report_id where x.citizen_id = tmp),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('t', entry_type, 'c', amount_cents) order by entry_type), '[]') from public.reward_ledger where citizen_id = tmp),
    'officer_evidence', (select count(*) from public.officer_evidence where case_id in (v_case, v_case2)),
    'audit', (select count(*) from public.audit_events where entity_id in (v_case, v_case2, v_report)));
  others_before := jsonb_build_object(
    'profiles', (select jsonb_agg(jsonb_build_object('id', id, 'n', display_name, 'a', avatar_storage_path, 'd', deletion_requested_at) order by id) from public.profiles where id <> tmp),
    'devices', (select count(*) from public.push_devices where user_id <> tmp),
    'notifications', (select count(*) from public.notifications where recipient_id <> tmp),
    'reports', (select count(*) from public.reports where citizen_id <> tmp),
    'ledger', (select count(*) from public.reward_ledger where citizen_id <> tmp));

  -- -------------------------------------------------------------------------
  -- security
  r := pg_temp.t93_as(null, $s$select public.request_account_deletion('DELETE')$s$);
  res := res || jsonb_build_object('name', 'Security: anonymous cannot call the RPC', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
  for k in select * from (values ('officer', offA1), ('supervisor', supA)) v(who, uid) loop
    r := pg_temp.t93_as(k.uid, $s$select public.request_account_deletion('DELETE')$s$);
    res := res || jsonb_build_object('name', format('Security: %s account cannot close itself (managed by organization), nothing changed', k.who),
      'ok', r ? 'error' and r->>'error' ~ '^FORBIDDEN' and (select deletion_requested_at is null from public.profiles where id = k.uid), 'detail', r);
  end loop;
  for k in select * from (values ('missing', 'null'), ('lowercase', '''delete'''), ('other text', '''yes''')) v(what, arg) loop
    r := pg_temp.t93_as(tmp, format('select public.request_account_deletion(%s)', k.arg));
    res := res || jsonb_build_object('name', 'Confirmation: refused when the confirmation is ' || k.what,
      'ok', r ? 'error' and r->>'error' ~ '^INVALID_INPUT' and (select deletion_requested_at is null from public.profiles where id = tmp), 'detail', r);
  end loop;
  r := pg_temp.t93_as(tmp, $s$with x as (update public.profiles set deletion_requested_at = now() where id <> auth.uid() returning 1) select to_jsonb(count(*)) from x$s$);
  res := res || jsonb_build_object('name', 'Security: a citizen cannot mark another account closed by a direct update', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);

  -- -------------------------------------------------------------------------
  -- close the temporary citizen
  r := pg_temp.t93_as(tmp, $s$select public.request_account_deletion('DELETE')$s$);
  res := res || jsonb_build_object('name', 'Close: citizen closes own account (changed, old picture path returned for removal)',
    'ok', (r->>'requested')::boolean and (r->>'changed')::boolean and r->>'avatar_path' = tmp || '/avatar-t93qa.jpg', 'detail', r - 'avatar_path');
  res := res || jsonb_build_object('name', 'Close: profile marked closed; display name and picture path cleared; role unchanged',
    'ok', (select deletion_requested_at is not null and display_name = '' and avatar_storage_path is null and role = 'CITIZEN' from public.profiles where id = tmp), 'detail', null);
  res := res || jsonb_build_object('name', 'Close: push devices removed', 'ok', not exists (select 1 from public.push_devices where user_id = tmp), 'detail', null);
  res := res || jsonb_build_object('name', 'Close: notifications removed', 'ok', not exists (select 1 from public.notifications where recipient_id = tmp), 'detail', null);
  res := res || jsonb_build_object('name', 'Close: exactly one ACCOUNT_DELETION_REQUESTED audit event',
    'ok', (select count(*) = 1 from public.audit_events where entity_id = tmp and event_type = 'ACCOUNT_DELETION_REQUESTED'), 'detail', null);
  snap_after := jsonb_build_object(
    'reports', (select count(*) from public.reports where citizen_id = tmp),
    'evidence', (select count(*) from public.report_evidence e join public.reports x on x.id = e.report_id where x.citizen_id = tmp),
    'cases', (select count(*) from public.officer_cases c join public.reports x on x.id = c.report_id where x.citizen_id = tmp),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('t', entry_type, 'c', amount_cents) order by entry_type), '[]') from public.reward_ledger where citizen_id = tmp),
    'officer_evidence', (select count(*) from public.officer_evidence where case_id in (v_case, v_case2)),
    'audit', (select count(*) from public.audit_events where entity_id in (v_case, v_case2, v_report)));
  res := res || jsonb_build_object('name', 'Retention: reports, evidence, cases, officer evidence, reward ledger and case audit history unchanged',
    'ok', snap_before = snap_after and (snap_before->>'reports')::int = 2, 'detail', jsonb_build_object('before', snap_before, 'after', snap_after));
  res := res || jsonb_build_object('name', 'Retention: verified report still VERIFIED, open case still open',
    'ok', (select status::text from public.reports where id = v_report) = 'VERIFIED' and (select status::text <> 'COMPLETED' from public.officer_cases where id = v_case2), 'detail', null);

  r := pg_temp.t93_as(tmp, $s$select public.request_account_deletion('DELETE')$s$);
  res := res || jsonb_build_object('name', 'Idempotent: a repeated close is safe (changed=false, no second audit event)',
    'ok', (r->>'requested')::boolean and not (r->>'changed')::boolean
          and (select count(*) = 1 from public.audit_events where entity_id = tmp and event_type = 'ACCOUNT_DELETION_REQUESTED'), 'detail', r);

  insert into storage.objects (bucket_id, name, owner) select 'report-evidence', tmp || '/t93qa-3/' || s || '.jpg', tmp from unnest(array['FRONT', 'SIDE', 'REAR']) s;
  r := pg_temp.t93_as(tmp, format($s$select public.submit_report('t93qa-3', 'no-parking', 'T93 QA street (temporary)', now(), now(),
        (select jsonb_agg(jsonb_build_object('slot', s, 'capture_source', 'CAMERA', 'storage_path', %L || s || '.jpg', 'captured_at', now())) from unnest(array['FRONT','SIDE','REAR']) s))$s$, tmp || '/t93qa-3/'));
  res := res || jsonb_build_object('name', 'Closed account: new report refused', 'ok', r ? 'error' and r->>'error' ~ 'closed', 'detail', r);
  r := pg_temp.t93_as(tmp, $s$select public.register_push_device('inst-t93qa-c2', 'ExponentPushToken[t93qafakeC2aaaa]', 'android')$s$);
  res := res || jsonb_build_object('name', 'Closed account: (informational) push registration after closure', 'ok', true,
    'detail', jsonb_build_object('result', case when r ? 'error' then r->>'error' else 'registered' end));

  others_after := jsonb_build_object(
    'profiles', (select jsonb_agg(jsonb_build_object('id', id, 'n', display_name, 'a', avatar_storage_path, 'd', deletion_requested_at) order by id) from public.profiles where id <> tmp),
    'devices', (select count(*) from public.push_devices where user_id <> tmp),
    'notifications', (select count(*) from public.notifications where recipient_id <> tmp),
    'reports', (select count(*) from public.reports where citizen_id <> tmp),
    'ledger', (select count(*) from public.reward_ledger where citizen_id <> tmp));
  res := res || jsonb_build_object('name', 'Isolation: no other account''s profile, devices, notifications, reports or ledger changed',
    'ok', others_before = others_after, 'detail', case when others_before = others_after then null else jsonb_build_object('devices', jsonb_build_array(others_before->'devices', others_after->'devices'), 'notifications', jsonb_build_array(others_before->'notifications', others_after->'notifications')) end);

  -- officer workflow on the closed citizen's open case still works (enforcement continues)
  r := pg_temp.t93_as(offA1, format('select public.accept_case(%L)', v_case2));
  res := res || jsonb_build_object('name', 'Officer semantics: an officer can still work the closed citizen''s open case',
    'ok', not (r ? 'error'), 'detail', r);

  -- existing citizens keep working
  r := pg_temp.t93_as(citA, 'select public.get_my_ledger()');
  res := res || jsonb_build_object('name', 'Regression: existing citizen A still reads own ledger', 'ok', not (r ? 'error'), 'detail', null);
  res := res || jsonb_build_object('name', 'Regression: existing dev accounts are not closed',
    'ok', (select bool_and(deletion_requested_at is null) from public.profiles where id in (citA, citB, offA1, supA)), 'detail', null);

  raise exception 'T93QA_RESULT %', jsonb_build_object('total', jsonb_array_length(res),
    'failed', (select count(*) from jsonb_array_elements(res) x where (x->>'ok')::boolean is not true),
    'failures', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(res) x where (x->>'ok')::boolean is not true),
    'names', (select jsonb_agg(x->>'name') from jsonb_array_elements(res) x))::text;
end
$qa$;
