-- ============================================================================
-- T9.2 real-cloud database QA (DEVELOPMENT project only).
--
--   npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f scripts/sql/t92-cloud-qa.sql
--
-- NOTHING PERSISTS: everything runs inside one DO block that always ends by
-- raising T92QA_RESULT with the results, so PostgreSQL rolls back every
-- fixture, report, case, notification, outbox row and audit row it created.
-- (Only sequence values - report numbers - are not transactional.)
--
-- Calls are made with the real database roles exactly as PostgREST does:
-- SET ROLE authenticated/anon + request.jwt.claims. Fake Expo token strings
-- only; no token value appears in the output. No push is sent.
--
-- Fixtures: the existing dev accounts (2 citizens, 2 active officers, 1
-- supervisor of organization A) plus temporary accounts created inside the
-- transaction (ADMIN, inactive supervisor, inactive officer, organization B
-- with a supervisor and an officer).
-- ============================================================================

-- Run one statement as a role; returns the first column of the first row as jsonb, or {"error": msg}.
create or replace function pg_temp.t92_as(p_uid uuid, p_sql text) returns jsonb
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
    -- the savepoint of this block undoes the role switch and any partial change
    return jsonb_build_object('error', left(sqlerrm, 160));
  end;
end $f$;

-- The trusted sender's view (service_role), as the Edge Function would call it.
create or replace function pg_temp.t92_service(p_sql text) returns jsonb
language plpgsql as $f$
declare r jsonb;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role service_role';
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
  offA2 uuid := '284c680a-9522-4583-b3bc-db8e07e25136';
  supA uuid := 'a3baee62-5f3c-47c7-a3a8-157ea5316bd1';
  adminA uuid := gen_random_uuid();
  supInactive uuid := gen_random_uuid();
  offInactive uuid := gen_random_uuid();
  supB uuid := gen_random_uuid();
  offB uuid := gen_random_uuid();
  orgA uuid;
  orgB uuid;
  r jsonb;
  c record;
  k record;
  n int;
  seq int := 0;
  v_case uuid;
  v_report uuid;
  report_no bigint;
  oid_ uuid;
  tok_ok boolean;
begin
  -- -------------------------------------------------------------------------
  -- temporary fixtures (rolled back)
  select organization_id into orgA from public.jurisdictions where id = 'helsinki-demo';
  insert into public.organizations (name) values ('T92 QA other org (temporary)') returning id into orgB;
  insert into public.jurisdictions (id, organization_id, name) values ('t92-qa-other', orgB, 'T92 QA other (temporary)');
  insert into auth.users (id, email, raw_user_meta_data) values
    (adminA, 't92qa-admin@invalid.test', '{}'), (supInactive, 't92qa-supi@invalid.test', '{}'),
    (offInactive, 't92qa-offi@invalid.test', '{}'), (supB, 't92qa-supb@invalid.test', '{}'), (offB, 't92qa-offb@invalid.test', '{}');
  update public.profiles set role = 'ADMIN', display_name = 'QA Admin' where id = adminA;
  update public.profiles set role = 'SUPERVISOR' where id in (supInactive, supB);
  update public.profiles set role = 'OFFICER' where id in (offInactive, offB);
  insert into public.organization_members (organization_id, user_id, member_role, active) values
    (orgA, adminA, 'ADMIN', true), (orgA, supInactive, 'SUPERVISOR', false), (orgA, offInactive, 'OFFICER', false),
    (orgB, supB, 'SUPERVISOR', true), (orgB, offB, 'OFFICER', true);

  -- helper: a fresh report + NEW case via the real submit_report as citizen A
  -- (evidence objects are inserted as rows only; no files are uploaded)
  -- implemented inline below with a loop counter

  -- =========================================================================
  -- RLS / table privileges
  for k in select * from (values ('anon', null::uuid), ('citizen', citA), ('officer', offA1), ('supervisor', supA), ('admin', adminA)) v(who, uid) loop
    for c in select * from (values ('push_devices'), ('push_outbox'), ('push_tickets')) t(tbl) loop
      r := pg_temp.t92_as(k.uid, format('select to_jsonb(count(*)) from public.%I', c.tbl));
      res := res || jsonb_build_object('name', format('RLS: %s cannot SELECT %s', k.who, c.tbl), 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
      r := pg_temp.t92_as(k.uid, format('with x as (delete from public.%I returning 1) select to_jsonb(count(*)) from x', c.tbl));
      res := res || jsonb_build_object('name', format('RLS: %s cannot DELETE %s', k.who, c.tbl), 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
      r := pg_temp.t92_as(k.uid, format('with x as (update public.%I set created_at = now() returning 1) select to_jsonb(count(*)) from x', c.tbl));
      res := res || jsonb_build_object('name', format('RLS: %s cannot UPDATE %s', k.who, c.tbl), 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
    end loop;
    r := pg_temp.t92_as(k.uid, format($s$with x as (insert into public.push_devices (user_id, installation_id, expo_push_token, platform) values (%L, 'inst-t92qa-direct', 'ExponentPushToken[t92qadirect000]', 'ios') returning 1) select to_jsonb(count(*)) from x$s$, citB));
    res := res || jsonb_build_object('name', format('RLS: %s cannot INSERT a device row (for another user)', k.who), 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
    for c in select * from (values ('push_claim_batch', 'select public.push_claim_batch()'), ('push_record_result', 'select public.push_record_result(gen_random_uuid())'),
                                   ('push_pending_receipts', 'select public.push_pending_receipts()'), ('push_record_receipts', $s$select public.push_record_receipts('[]')$s$)) f(fn, q) loop
      r := pg_temp.t92_as(k.uid, c.q);
      res := res || jsonb_build_object('name', format('Sender RPC: %s cannot call %s', k.who, c.fn), 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
    end loop;
  end loop;
  r := pg_temp.t92_as(null, $s$select public.register_push_device('inst-t92qa-anon01', 'ExponentPushToken[t92qaanon000]', 'ios')$s$);
  res := res || jsonb_build_object('name', 'Device RPC: anonymous cannot register', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);

  -- =========================================================================
  -- Device RPCs (fake tokens; values never output)
  r := pg_temp.t92_as(citA, $s$select public.register_push_device('inst-t92qa-a1', 'ExponentPushToken[t92qafakeA1aaaa]', 'android')$s$);
  select count(*) into n from public.push_devices where installation_id = 'inst-t92qa-a1' and user_id = citA and enabled;
  res := res || jsonb_build_object('name', 'Device RPC: citizen registers own device (row owned by caller)', 'ok', (r->>'registered')::boolean and n = 1, 'detail', jsonb_build_object('changed', r->'changed', 'rows', n));
  r := pg_temp.t92_as(citA, $s$select public.register_push_device('inst-t92qa-a1', 'ExponentPushToken[t92qafakeA1aaaa]', 'android')$s$);
  select count(*) into n from public.push_devices where installation_id = 'inst-t92qa-a1';
  res := res || jsonb_build_object('name', 'Device RPC: same installation again is idempotent (changed=false, one row)', 'ok', (r->>'changed')::boolean = false and n = 1, 'detail', jsonb_build_object('rows', n));
  r := pg_temp.t92_as(citA, $s$select public.register_push_device('inst-t92qa-a1', 'ExponentPushToken[t92qafakeA1bbbb]', 'android')$s$);
  select count(*), bool_and(expo_push_token like '%A1bbbb]') into n, tok_ok from public.push_devices where installation_id = 'inst-t92qa-a1';
  res := res || jsonb_build_object('name', 'Device RPC: refreshed token updates the same row', 'ok', (r->>'changed')::boolean and n = 1 and tok_ok, 'detail', jsonb_build_object('rows', n));
  r := pg_temp.t92_as(citA, $s$select public.register_push_device('inst-t92qa-a2', 'ExponentPushToken[t92qafakeA2aaaa]', 'ios')$s$);
  select count(*) into n from public.push_devices where user_id = citA and enabled and installation_id like 'inst-t92qa-%';
  res := res || jsonb_build_object('name', 'Device RPC: multiple installations per user', 'ok', n = 2, 'detail', jsonb_build_object('enabled_rows', n));
  for c in select * from (values ('malformed token', $s$select public.register_push_device('inst-t92qa-bad', 'not-a-token', 'ios')$s$),
                                 ('malformed installation id', $s$select public.register_push_device('x', 'ExponentPushToken[t92qafakeBAD000]', 'ios')$s$),
                                 ('unknown platform', $s$select public.register_push_device('inst-t92qa-bad', 'ExponentPushToken[t92qafakeBAD000]', 'web')$s$)) v(what, q) loop
    r := pg_temp.t92_as(citA, c.q);
    res := res || jsonb_build_object('name', 'Device RPC: rejects ' || c.what, 'ok', r ? 'error' and r->>'error' ~ '^INVALID_INPUT', 'detail', r);
  end loop;
  r := pg_temp.t92_as(supA, $s$select public.register_push_device('inst-t92qa-sup', 'ExponentPushToken[t92qafakeSUP000]', 'ios')$s$);
  res := res || jsonb_build_object('name', 'Device RPC: supervisor (console) account cannot register', 'ok', r ? 'error' and r->>'error' ~ '^FORBIDDEN', 'detail', r);
  -- "register for another user": the RPC has no user parameter; registering another user's token/installation binds it to the CALLER only
  r := pg_temp.t92_as(citB, $s$select public.register_push_device('inst-t92qa-a2', 'ExponentPushToken[t92qafakeA2aaaa]', 'ios')$s$);
  select count(*) into n from public.push_devices where installation_id = 'inst-t92qa-a2' and user_id = citA and enabled;
  res := res || jsonb_build_object('name', 'Device RPC: no user parameter exists; another account registering a device binds it to itself only (old owner disabled, never written as old owner)',
    'ok', n = 0 and exists (select 1 from public.push_devices where installation_id = 'inst-t92qa-a2' and user_id = citB and enabled)
          and exists (select 1 from public.push_devices where installation_id = 'inst-t92qa-a2' and user_id = citA and disabled_reason = 'MOVED_TO_OTHER_ACCOUNT')
          and (select count(*) from pg_proc p where p.proname = 'register_push_device' and pg_get_function_identity_arguments(p.oid) ~ 'user') = 0,
    'detail', null);
  r := pg_temp.t92_as(citB, $s$select public.unregister_push_device('inst-t92qa-a1')$s$);
  res := res || jsonb_build_object('name', 'Device RPC: cannot unregister another user''s installation', 'ok', (r->>'unregistered')::boolean = false and exists (select 1 from public.push_devices where installation_id = 'inst-t92qa-a1' and enabled), 'detail', r);
  r := pg_temp.t92_as(citA, $s$select public.unregister_push_device('inst-t92qa-a1')$s$);
  res := res || jsonb_build_object('name', 'Device RPC: unregister own installation (sign-out)', 'ok', (r->>'unregistered')::boolean and exists (select 1 from public.push_devices where installation_id = 'inst-t92qa-a1' and not enabled and disabled_reason = 'SIGNED_OUT'), 'detail', r);
  r := pg_temp.t92_as(offA1, $s$select public.register_push_device('inst-t92qa-o1', 'ExponentPushToken[t92qafakeO1aaaa]', 'android')$s$);
  res := res || jsonb_build_object('name', 'Device RPC: officer registers own device', 'ok', (r->>'registered')::boolean, 'detail', null);

  -- =========================================================================
  -- Outcomes -> notifications -> outbox (real submit_report / complete_case)
  -- citizen A signs in again on one device (fake token) so the sender view has one enabled device
  perform pg_temp.t92_as(citA, $s$select public.register_push_device('inst-t92qa-a1', 'ExponentPushToken[t92qafakeA1cccc]', 'android')$s$);
  for c in select * from (values ('CHARGE_ISSUED'), ('REPORT_REJECTED'), ('VEHICLE_MOVED'), ('VALID_PERMIT'), ('DUPLICATE'), ('OTHER')) o(code) loop
    seq := seq + 1;
    insert into storage.objects (bucket_id, name, owner) select 'report-evidence', citA || '/t92qa-' || seq || '/' || s || '.jpg', citA from unnest(array['FRONT', 'SIDE', 'REAR']) s;
    r := pg_temp.t92_as(citA, format($s$select public.submit_report('t92qa-%s', 'no-parking', 'T92 QA street (temporary)', now(), now(),
          (select jsonb_agg(jsonb_build_object('slot', s, 'capture_source', 'CAMERA', 'storage_path', %L || s || '.jpg', 'captured_at', now())) from unnest(array['FRONT','SIDE','REAR']) s))$s$, seq, citA || '/t92qa-' || seq || '/'));
    v_case := (r->>'case_id')::uuid; v_report := (r->>'report_id')::uuid;
    if v_case is null then
      res := res || jsonb_build_object('name', 'Outcome setup failed for ' || c.code, 'ok', false, 'detail', r);
      continue;
    end if;
    if c.code <> 'DUPLICATE' then perform pg_temp.t92_as(offA1, format('select public.accept_case(%L)', v_case)); end if;
    if c.code in ('CHARGE_ISSUED', 'VALID_PERMIT') then perform pg_temp.t92_as(offA1, format('select public.start_inspection(%L)', v_case)); end if;
    if c.code = 'CHARGE_ISSUED' then
      for k in select unnest(array['vehiclePresent', 'plateMatches', 'violationConfirmed', 'restrictionVerified']) ck loop
        perform pg_temp.t92_as(offA1, format('select public.set_inspection_check(%L, %L::public.inspection_check_key, true)', v_case, k.ck));
      end loop;
      for k in select unnest(array['VEHICLE_FRONT', 'LICENSE_PLATE', 'PARKING_SIGN', 'VEHICLE_REAR']) et loop
        insert into storage.objects (bucket_id, name, owner) values ('officer-evidence', v_case || '/' || k.et || '.jpg', offA1);
        perform pg_temp.t92_as(offA1, format('select public.add_officer_evidence(%L, %L::public.officer_evidence_type, %L, now())', v_case, k.et, v_case || '/' || k.et || '.jpg'));
      end loop;
    end if;
    r := pg_temp.t92_as(offA1, format('select public.complete_case(%L, %L::public.enforcement_outcome_code)', v_case, c.code));
    perform pg_temp.t92_as(offA1, format('select public.complete_case(%L, %L::public.enforcement_outcome_code)', v_case, c.code)); -- retry of the same logical event
    res := res || jsonb_build_object('name', format('Outcome %s: case completed', c.code), 'ok', (select status = 'COMPLETED' from public.officer_cases where id = v_case), 'detail', r);
    if c.code in ('CHARGE_ISSUED', 'REPORT_REJECTED') then
      res := res || jsonb_build_object('name', format('Outcome %s: exactly one citizen notification and one outbox row after a retry', c.code),
        'ok', (select count(*) from public.notifications where report_id = v_report and recipient_id = citA and type::text = case c.code when 'CHARGE_ISSUED' then 'REPORT_VERIFIED' else 'REPORT_REJECTED' end) = 1
          and (select count(*) from public.push_outbox o join public.notifications x on x.id = o.notification_id where x.report_id = v_report and o.recipient_id = citA) = 1,
        'detail', null);
      res := res || jsonb_build_object('name', format('Outcome %s: citizen status and reward unchanged from T9.0 rules (one ledger resolution)', c.code),
        'ok', (select status::text from public.reports where id = v_report) = case c.code when 'CHARGE_ISSUED' then 'VERIFIED' else 'REJECTED' end
          and (select count(*) from public.reward_ledger where report_id = v_report and entry_type::text = case c.code when 'CHARGE_ISSUED' then 'REWARD_RELEASED' else 'REWARD_VOIDED' end) = 1
          and (select count(*) from public.reward_ledger where report_id = v_report and entry_type in ('REWARD_RELEASED', 'REWARD_VOIDED')) = 1
          and (c.code <> 'CHARGE_ISSUED' or (select amount_cents from public.notifications where report_id = v_report and type = 'REPORT_VERIFIED') = 500),
        'detail', null);
    else
      res := res || jsonb_build_object('name', format('Outcome %s: NO citizen outcome notification or push; status stays UNDER_REVIEW; reward voided once', c.code),
        'ok', (select count(*) from public.notifications where report_id = v_report and recipient_id = citA and type in ('REPORT_VERIFIED', 'REPORT_REJECTED')) = 0
          and (select count(*) from public.push_outbox o where o.recipient_id = citA and o.notification_id in (select id from public.notifications where report_id = v_report)) = 0
          and (select status::text from public.reports where id = v_report) = 'UNDER_REVIEW'
          and (select count(*) from public.reward_ledger where report_id = v_report and entry_type = 'REWARD_VOIDED') = 1,
        'detail', null);
    end if;
    res := res || jsonb_build_object('name', format('Outcome %s: officer completion notification and submit notification are never pushed', c.code),
      'ok', (select count(*) from public.push_outbox o join public.notifications x on x.id = o.notification_id
             where x.report_id = v_report and x.type in ('PARKING_CHARGE_ISSUED', 'CASE_CLOSED_WITHOUT_CHARGE', 'REPORT_UNDER_REVIEW', 'CASE_ACCEPTED')) = 0,
      'detail', null);
  end loop;
  -- Sender view (service_role): exactly the two citizen outcome pushes are due for citizen A,
  -- each with the one enabled device, and nothing sensitive in the payload. (Nothing is sent.)
  r := pg_temp.t92_service('select public.push_claim_batch(100)');
  res := res || jsonb_build_object('name', 'Outbox (service role claim): citizen pushes = one VERIFIED + one REJECTED, one enabled device each, no evidence/location/plate/identity in payload',
    'ok', not (r ? 'error')
      and (select array_agg(x->'notification'->>'type' order by x->'notification'->>'type') from jsonb_array_elements(r) x where x->'notification'->>'recipient_role' = 'CITIZEN'
             and (x->'notification'->>'report_number')::bigint in (select public_report_number from public.reports where source_draft_id like 't92qa-%' and citizen_id = citA)) = array['REPORT_REJECTED', 'REPORT_VERIFIED']
      and not exists (select 1 from jsonb_array_elements(r) x where x->'notification'->>'recipient_role' = 'CITIZEN' and (x->'notification'->>'report_number')::bigint in (select public_report_number from public.reports where source_draft_id like 't92qa-%') and jsonb_array_length(x->'devices') <> 1)
      and r::text !~* 'storage_path|latitude|longitude|plate|citizen_id|display_name|notes|email',
    'detail', case when r ? 'error' then r end);
  r := pg_temp.t92_as(citA, 'select public.push_claim_batch(100)');
  res := res || jsonb_build_object('name', 'Outbox: a citizen still cannot claim (sender API is service-role only)', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);

  -- =========================================================================
  -- Supervisor assignment
  seq := seq + 1;
  insert into storage.objects (bucket_id, name, owner) select 'report-evidence', citA || '/t92qa-' || seq || '/' || s || '.jpg', citA from unnest(array['FRONT', 'SIDE', 'REAR']) s;
  r := pg_temp.t92_as(citA, format($s$select public.submit_report('t92qa-%s', 'no-parking', 'T92 QA street (temporary)', now(), now(),
        (select jsonb_agg(jsonb_build_object('slot', s, 'capture_source', 'CAMERA', 'storage_path', %L || s || '.jpg', 'captured_at', now())) from unnest(array['FRONT','SIDE','REAR']) s))$s$, seq, citA || '/t92qa-' || seq || '/'));
  v_case := (r->>'case_id')::uuid;

  for k in select * from (values ('citizen', citA, '^FORBIDDEN'), ('officer', offA1, '^FORBIDDEN'), ('inactive supervisor', supInactive, '^FORBIDDEN'), ('other-organization supervisor', supB, '^NOT_FOUND')) v(who, uid, pat) loop
    r := pg_temp.t92_as(k.uid, format('select public.admin_assign_case(%L, %L, 0)', v_case, offA2));
    res := res || jsonb_build_object('name', format('Assign: %s denied', k.who), 'ok', r ? 'error' and r->>'error' ~ k.pat, 'detail', r);
    r := pg_temp.t92_as(k.uid, format('select public.admin_unassign_case(%L, 0)', v_case));
    res := res || jsonb_build_object('name', format('Return to queue: %s denied', k.who), 'ok', r ? 'error' and r->>'error' ~ k.pat, 'detail', r);
  end loop;
  r := pg_temp.t92_as(null, format('select public.admin_assign_case(%L, %L, 0)', v_case, offA2));
  res := res || jsonb_build_object('name', 'Assign: anonymous denied', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
  for k in select * from (values ('inactive officer', offInactive), ('other-organization officer', offB), ('supervisor (not an officer)', supA), ('citizen', citB)) v(who, uid) loop
    r := pg_temp.t92_as(supA, format('select public.admin_assign_case(%L, %L, 0)', v_case, k.uid));
    res := res || jsonb_build_object('name', format('Assign: target %s denied', k.who), 'ok', r ? 'error' and r->>'error' ~ '^INVALID_OFFICER', 'detail', r);
  end loop;
  r := pg_temp.t92_as(supA, format('with x as (update public.officer_cases set assigned_officer_id = %L where id = %L returning 1) select to_jsonb(count(*)) from x', offA2, v_case));
  res := res || jsonb_build_object('name', 'Assign: supervisor cannot update cases directly', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
  r := pg_temp.t92_as(supA, format('select public.admin_list_assignable_officers(%L)', v_case));
  res := res || jsonb_build_object('name', 'Assign: picker lists exactly the active OFFICERs of the organization (no tokens/emails)',
    'ok', (select array_agg(x->>'user_id' order by x->>'user_id') from jsonb_array_elements(r) x) = (select array_agg(u::text order by u::text) from unnest(array[offA1, offA2]) u)
          and r::text !~ 'token|email|latitude', 'detail', null);
  r := pg_temp.t92_as(supB, format('select public.admin_list_assignable_officers(%L)', v_case));
  res := res || jsonb_build_object('name', 'Assign: other organization cannot list officers for this case', 'ok', r = 'null'::jsonb, 'detail', r);

  r := pg_temp.t92_as(supA, format('select public.admin_assign_case(%L, %L, 0)', v_case, offA2));
  res := res || jsonb_build_object('name', 'Assign: supervisor assigns NEW case to active same-org officer',
    'ok', (r->>'changed')::boolean and (select status = 'ASSIGNED' and assigned_officer_id = offA2 and assignment_version = 1 from public.officer_cases where id = v_case), 'detail', r);
  perform pg_temp.t92_as(supA, format('select public.admin_assign_case(%L, %L, 0)', v_case, offA2)); -- retry
  res := res || jsonb_build_object('name', 'Assign: retry is a no-op; one notification, one push, one audit row',
    'ok', (select count(*) from public.notifications where case_id = v_case and type = 'CASE_ASSIGNED' and recipient_id = offA2) = 1
      and (select count(*) from public.push_outbox where recipient_id = offA2 and notification_id in (select id from public.notifications where case_id = v_case)) = 1
      and (select count(*) from public.audit_events where entity_id = v_case and event_type = 'CASE_ASSIGNED' and actor_user_id = supA and actor_role = 'SUPERVISOR') = 1,
    'detail', null);
  r := pg_temp.t92_as(supA, format('select public.admin_assign_case(%L, %L, 0)', v_case, offA1));
  res := res || jsonb_build_object('name', 'Assign: stale assignment_version refused', 'ok', r ? 'error' and r->>'error' ~ '^STALE_ASSIGNMENT', 'detail', r);
  r := pg_temp.t92_as(adminA, format('select public.admin_assign_case(%L, %L, 1)', v_case, offA1));
  res := res || jsonb_build_object('name', 'Reassign (ADMIN, same org): before the officer starts; new officer notified+pushed, previous in-app only, audited once',
    'ok', (r->>'changed')::boolean and (select assigned_officer_id = offA1 and assignment_version = 2 from public.officer_cases where id = v_case)
      and (select count(*) from public.push_outbox where recipient_id = offA1 and notification_id in (select id from public.notifications where case_id = v_case and type = 'CASE_ASSIGNED')) = 1
      and (select count(*) from public.notifications where case_id = v_case and type = 'CASE_ASSIGNMENT_REMOVED' and recipient_id = offA2) = 1
      and (select count(*) from public.push_outbox where recipient_id = offA2 and notification_id in (select id from public.notifications where case_id = v_case)) = 1
      and (select count(*) from public.audit_events where entity_id = v_case and event_type = 'CASE_REASSIGNED' and actor_role = 'ADMIN'
            and metadata->>'from_officer' = offA2::text and metadata->>'to_officer' = offA1::text) = 1,
    'detail', r);
  r := pg_temp.t92_as(supA, format('select public.admin_get_case(%L)', v_case));
  res := res || jsonb_build_object('name', 'Audit view: console shows officer names, never ids, in assignment metadata',
    'ok', not exists (select 1 from jsonb_array_elements(r->'audit') e where (e->'metadata')::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
      and exists (select 1 from jsonb_array_elements(r->'audit') e where e->>'event_type' = 'CASE_REASSIGNED' and e->'metadata' ? 'to_officer'), 'detail', null);
  r := pg_temp.t92_as(supA, format('select public.admin_unassign_case(%L, 2)', v_case));
  perform pg_temp.t92_as(supA, format('select public.admin_unassign_case(%L, 2)', v_case)); -- retry
  res := res || jsonb_build_object('name', 'Return to queue: ASSIGNED -> NEW before the officer starts; audited once; retry no-op',
    'ok', (r->>'changed')::boolean and (select status = 'NEW' and assigned_officer_id is null and assigned_at is null and assignment_version = 3 from public.officer_cases where id = v_case)
      and (select count(*) from public.audit_events where entity_id = v_case and event_type = 'CASE_UNASSIGNED') = 1,
    'detail', r);
  res := res || jsonb_build_object('name', 'Assignment never notifies the citizen',
    'ok', (select count(*) from public.notifications where case_id = v_case and recipient_id in (citA, citB)) = 0, 'detail', null);

  -- started / completed cases are not moved
  perform pg_temp.t92_as(supA, format('select public.admin_assign_case(%L, %L, 3)', v_case, offA2));
  perform pg_temp.t92_as(offA2, format('select public.accept_case(%L)', v_case)); -- EN_ROUTE
  for k in select * from (values ('EN_ROUTE', null), ('ON_SITE', 'set'), ('INSPECTION', 'inspect'), ('COMPLETED', 'complete')) v(st, how) loop
    if k.how = 'set' then update public.officer_cases set status = 'ON_SITE', on_site_at = now() where id = v_case; end if; -- no client path to ON_SITE exists yet
    if k.how = 'inspect' then perform pg_temp.t92_as(offA2, format('select public.start_inspection(%L)', v_case)); end if;
    if k.how = 'complete' then perform pg_temp.t92_as(offA2, format($s$select public.complete_case(%L, 'OTHER')$s$, v_case)); end if;
    select assignment_version into n from public.officer_cases where id = v_case;
    r := pg_temp.t92_as(supA, format('select public.admin_assign_case(%L, %L, %s)', v_case, offA1, n));
    tok_ok := r ? 'error' and r->>'error' ~ case when k.st = 'COMPLETED' then '^ALREADY_COMPLETED' else '^NOT_ASSIGNABLE' end;
    r := pg_temp.t92_as(supA, format('select public.admin_unassign_case(%L, %s)', v_case, n));
    res := res || jsonb_build_object('name', format('Assign/return refused for %s case', k.st),
      'ok', tok_ok and (select status::text = k.st from public.officer_cases where id = v_case) and r ? 'error' and r->>'error' ~ case when k.st = 'COMPLETED' then '^ALREADY_COMPLETED' else '^NOT_ASSIGNABLE' end,
      'detail', r);
  end loop;

  -- attention
  r := pg_temp.t92_as(supA, 'select public.admin_overview(''UTC'')');
  res := res || jsonb_build_object('name', 'Attention: overview exposes cases_needing_attention', 'ok', r ? 'cases_needing_attention', 'detail', null);
  r := pg_temp.t92_as(supA, 'select public.admin_page_cases(p_attention => true, p_limit => 100)');
  res := res || jsonb_build_object('name', 'Attention: filter returns only flagged open cases',
    'ok', not exists (select 1 from jsonb_array_elements(r->'rows') x where (x->>'needs_attention')::boolean is not true or x->>'status' = 'COMPLETED'), 'detail', jsonb_build_object('total', r->'total'));
  r := pg_temp.t92_as(supA, 'select public.admin_page_cases(p_status => ''NEW'', p_offset => 0, p_limit => 25)');
  res := res || jsonb_build_object('name', 'Console: T9.0 named-parameter calls still work after the signature change', 'ok', r ? 'rows' and r ? 'total', 'detail', null);

  raise exception 'T92QA_RESULT %', jsonb_build_object('total', jsonb_array_length(res),
    'failed', (select count(*) from jsonb_array_elements(res) x where (x->>'ok')::boolean is not true),
    'failures', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(res) x where (x->>'ok')::boolean is not true),
    'names', (select jsonb_agg(x->>'name') from jsonb_array_elements(res) x))::text;
end
$qa$;
