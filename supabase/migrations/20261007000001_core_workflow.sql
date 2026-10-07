-- ParkWatch T8.3: server-backed core workflow.
--
-- The server owns every sensitive transition. Clients can no longer write
-- reports, cases, inspections, evidence rows, outcomes, ledger entries or
-- notifications directly; they call the SECURITY DEFINER functions below,
-- which (1) identify the caller with auth.uid(), (2) check authorization
-- themselves, and (3) apply the same rules as src/domain:
--   * case lifecycle and the completion-from-state table (caseLifecycle.ts)
--   * CHARGE_ISSUED readiness: 4 checks = yes AND 4 officer photos (inspection.ts)
--   * outcome -> citizen status / reward / notification table (outcomes.ts)
--   * idempotent completion, one reward lifecycle per report (ledger.ts)
-- Every definer function pins search_path = '' and schema-qualifies objects.

-- ---------------------------------------------------------------------------
-- Server settings (single row; service role only). Mirrors src/domain/config.ts.

create table public.app_settings (
  id boolean primary key default true check (id),
  reward_amount_cents integer not null check (reward_amount_cents > 0),
  parking_charge_amount_cents integer not null check (parking_charge_amount_cents > 0),
  -- TEMPORARY development jurisdiction mapping (see resolve_report_jurisdiction).
  default_jurisdiction_id text references public.jurisdictions (id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id, reward_amount_cents, parking_charge_amount_cents) values (true, 500, 6000);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers

-- Raise a typed error the app maps to a domain error code ("CODE: message").
create function public.pw_fail(code text, msg text) returns void
language plpgsql as $$
begin
  raise exception '%: %', code, msg using errcode = 'P0001';
end $$;

create function public.pw_require_user() returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then perform public.pw_fail('UNAUTHENTICATED', 'Sign in required.'); end if;
  return me;
end $$;

create function public.try_uuid(v text) returns uuid
language sql immutable as $$
  select case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end;
$$;

/**
 * Which enforcement jurisdiction a new report belongs to. The client never
 * chooses it. TEMPORARY: until geographic boundaries exist, this returns the
 * server-configured default (app_settings.default_jurisdiction_id), or raises
 * NO_JURISDICTION when none is configured. Replace the body with a real
 * point-in-polygon lookup later; callers do not change.
 */
create function public.resolve_report_jurisdiction(lat double precision, lng double precision) returns text
language plpgsql stable security definer set search_path = '' as $$
declare j text;
begin
  select s.default_jurisdiction_id into j from public.app_settings s where s.id;
  if j is null or not exists (select 1 from public.jurisdictions x where x.id = j) then
    perform public.pw_fail('NO_JURISDICTION', 'No enforcement area covers this location yet.');
  end if;
  return j;
end $$;

create function public.pw_audit(actor uuid, role public.actor_role, entity text, entity_id uuid, event text, meta jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (actor_user_id, actor_role, source, entity_type, entity_id, event_type, metadata)
  values (actor, role, 'USER_ACTION', entity, entity_id, event, coalesce(meta, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Clients no longer insert reports/evidence directly: submit_report() only.

revoke insert on public.reports, public.report_evidence from authenticated;
drop policy if exists reports_insert_own on public.reports;
drop policy if exists report_evidence_insert_own on public.report_evidence;

-- ---------------------------------------------------------------------------
-- Private evidence storage
--   report-evidence:  <citizen uid>/<submission id>/<file>   (uploaded before submit)
--   officer-evidence: <case uuid>/<file>                      (assigned officer, during inspection)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('report-evidence', 'report-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('officer-evidence', 'officer-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false;

-- May the caller upload officer evidence into this object path right now?
create function public.can_upload_officer_evidence(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.officer_cases c
    where c.id = public.try_uuid(split_part(object_name, '/', 1))
      and c.assigned_officer_id = auth.uid()
      and c.status = 'INSPECTION'
      and public.is_enforcement_member_for(c.jurisdiction_id)
  );
$$;

-- May the caller (an enforcement member) read this citizen evidence object?
create function public.can_read_report_evidence_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.report_evidence e
    join public.reports r on r.id = e.report_id
    where e.storage_path = object_name and public.is_enforcement_member_for(r.jurisdiction_id)
  );
$$;

create function public.can_read_officer_evidence_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_access_case(public.try_uuid(split_part(object_name, '/', 1)));
$$;

grant execute on function public.can_upload_officer_evidence(text), public.can_read_report_evidence_object(text),
  public.can_read_officer_evidence_object(text), public.try_uuid(text) to authenticated;

create policy pw_report_evidence_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text);
create policy pw_report_evidence_select_own on storage.objects for select to authenticated
  using (bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text);
create policy pw_report_evidence_select_enforcement on storage.objects for select to authenticated
  using (bucket_id = 'report-evidence' and public.can_read_report_evidence_object(name));
-- Cleanup of failed submissions only: never evidence already attached to a report.
create policy pw_report_evidence_delete_unattached on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text
    and not exists (select 1 from public.report_evidence e where e.storage_path = name)
  );

create policy pw_officer_evidence_insert_assigned on storage.objects for insert to authenticated
  with check (bucket_id = 'officer-evidence' and public.can_upload_officer_evidence(name));
create policy pw_officer_evidence_select_enforcement on storage.objects for select to authenticated
  using (bucket_id = 'officer-evidence' and public.can_read_officer_evidence_object(name));
create policy pw_officer_evidence_delete_unattached on storage.objects for delete to authenticated
  using (
    bucket_id = 'officer-evidence' and public.can_upload_officer_evidence(name)
    and not exists (select 1 from public.officer_evidence e where e.storage_path = name)
  );

-- ---------------------------------------------------------------------------
-- submit_report: report + citizen evidence rows + case + pending reward +
-- notification + audit, in one transaction. Idempotent per (citizen, submission id).

create function public.submit_report(
  p_submission_id text,
  p_violation_type text,
  p_location_address text,
  p_observed_at timestamptz,
  p_submitted_at timestamptz,
  p_evidence jsonb,
  p_notes text default '',
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_location_accuracy_m double precision default null,
  p_location_captured_at timestamptz default null,
  p_plate_raw text default null,
  p_plate_normalized text default null,
  p_plate_country text default null,
  p_vehicle_make text default null,
  p_vehicle_model text default null,
  p_vehicle_color text default null,
  p_vehicle_source public.vehicle_info_source default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  settings public.app_settings;
  v_report public.reports;
  v_case_id uuid;
  v_jurisdiction text;
  ev jsonb;
  prefix text;
  required_count integer;
begin
  if not exists (select 1 from public.profiles p where p.id = me and p.role = 'CITIZEN') then
    perform public.pw_fail('FORBIDDEN', 'Only citizen accounts can submit reports.');
  end if;
  if coalesce(p_submission_id, '') !~ '^[A-Za-z0-9_-]{1,100}$' then
    perform public.pw_fail('INVALID_DRAFT', 'Invalid submission id.');
  end if;

  -- Idempotent retry: the same submission returns the same report.
  select * into v_report from public.reports r where r.citizen_id = me and r.source_draft_id = p_submission_id;
  if found then
    select c.id into v_case_id from public.officer_cases c where c.report_id = v_report.id;
    return jsonb_build_object('report_id', v_report.id, 'public_report_number', v_report.public_report_number,
      'case_id', v_case_id, 'received_at', v_report.received_at, 'created', false);
  end if;

  -- Evidence: exactly FRONT, SIDE, REAR taken with the camera; optional attachments.
  if jsonb_typeof(p_evidence) is distinct from 'array' then
    perform public.pw_fail('INVALID_DRAFT', 'Evidence is missing.');
  end if;
  select count(*) into required_count from jsonb_array_elements(p_evidence) e
    where e ->> 'slot' in ('FRONT', 'SIDE', 'REAR') and e ->> 'capture_source' = 'CAMERA';
  if required_count <> 3 or (select count(distinct e ->> 'slot') from jsonb_array_elements(p_evidence) e where e ->> 'slot' in ('FRONT', 'SIDE', 'REAR')) <> 3 then
    perform public.pw_fail('INVALID_DRAFT', 'Front, side and rear photos taken with the camera are required.');
  end if;
  prefix := me::text || '/' || p_submission_id || '/';
  for ev in select * from jsonb_array_elements(p_evidence) loop
    if (ev ->> 'slot') not in ('FRONT', 'SIDE', 'REAR', 'ATTACHMENT')
       or (ev ->> 'capture_source') not in ('CAMERA', 'LIBRARY')
       or ((ev ->> 'slot') <> 'ATTACHMENT' and (ev ->> 'capture_source') <> 'CAMERA') then
      perform public.pw_fail('INVALID_DRAFT', 'Invalid evidence.');
    end if;
    if left(ev ->> 'storage_path', length(prefix)) <> prefix
       or not exists (select 1 from storage.objects o where o.bucket_id = 'report-evidence' and o.name = ev ->> 'storage_path') then
      perform public.pw_fail('EVIDENCE_NOT_UPLOADED', 'A photo was not uploaded.');
    end if;
  end loop;

  select * into settings from public.app_settings s where s.id;
  v_jurisdiction := public.resolve_report_jurisdiction(p_latitude, p_longitude);

  insert into public.reports (
    citizen_id, source_draft_id, jurisdiction_id, violation_type,
    plate_raw, plate_normalized, plate_country, vehicle_make, vehicle_model, vehicle_color, vehicle_source,
    location_address, latitude, longitude, location_accuracy_m, location_captured_at, notes, observed_at, submitted_at
  ) values (
    me, p_submission_id, v_jurisdiction, p_violation_type,
    p_plate_raw, p_plate_normalized, p_plate_country, p_vehicle_make, p_vehicle_model, p_vehicle_color, p_vehicle_source,
    p_location_address, p_latitude, p_longitude, p_location_accuracy_m, p_location_captured_at, coalesce(p_notes, ''), p_observed_at, p_submitted_at
  )
  on conflict (citizen_id, source_draft_id) do nothing
  returning * into v_report;

  if v_report.id is null then
    -- A concurrent identical submission won the race: return it.
    select * into v_report from public.reports r where r.citizen_id = me and r.source_draft_id = p_submission_id;
    select c.id into v_case_id from public.officer_cases c where c.report_id = v_report.id;
    return jsonb_build_object('report_id', v_report.id, 'public_report_number', v_report.public_report_number,
      'case_id', v_case_id, 'received_at', v_report.received_at, 'created', false);
  end if;

  insert into public.report_evidence (report_id, slot, capture_source, storage_path, captured_at)
  select v_report.id, (e ->> 'slot')::public.citizen_evidence_slot, (e ->> 'capture_source')::public.capture_source,
         e ->> 'storage_path', (e ->> 'captured_at')::timestamptz
  from jsonb_array_elements(p_evidence) e;

  insert into public.officer_cases (report_id, jurisdiction_id, status, priority)
  values (v_report.id, v_jurisdiction, 'NEW', v_report.priority)
  returning id into v_case_id;

  insert into public.reward_ledger (citizen_id, entry_type, amount_cents, report_id, idempotency_key)
  values (me, 'REWARD_PENDING', settings.reward_amount_cents, v_report.id, 'REWARD_PENDING:' || v_report.id);

  insert into public.notifications (recipient_id, recipient_role, type, report_id, idempotency_key)
  values (me, 'CITIZEN', 'REPORT_UNDER_REVIEW', v_report.id, 'REPORT_UNDER_REVIEW:' || v_report.id)
  on conflict (idempotency_key) do nothing;

  perform public.pw_audit(me, 'CITIZEN', 'report', v_report.id, 'REPORT_SUBMITTED', jsonb_build_object('public_report_number', v_report.public_report_number));
  perform public.pw_audit(null, 'SYSTEM', 'officer_case', v_case_id, 'CASE_CREATED', '{}'::jsonb);
  perform public.pw_audit(null, 'SYSTEM', 'reward', v_report.id, 'REWARD_CHANGED', jsonb_build_object('entry', 'REWARD_PENDING', 'amount_cents', settings.reward_amount_cents));

  return jsonb_build_object('report_id', v_report.id, 'public_report_number', v_report.public_report_number,
    'case_id', v_case_id, 'received_at', v_report.received_at, 'created', true);
end $$;

-- ---------------------------------------------------------------------------
-- Officer lifecycle

-- Lock the case and check the caller may act on it as an enforcement member.
create function public.pw_lock_case_for_officer(p_case uuid) returns public.officer_cases
language plpgsql security definer set search_path = '' as $$
declare c public.officer_cases;
begin
  select * into c from public.officer_cases x where x.id = p_case for update;
  if not found then perform public.pw_fail('NOT_FOUND', 'Case not found.'); end if;
  if not public.is_enforcement_member_for(c.jurisdiction_id) then
    perform public.pw_fail('FORBIDDEN', 'You are not authorized for this case.');
  end if;
  return c;
end $$;

-- NEW -> ASSIGNED -> EN_ROUTE atomically (like domain acceptCase). Racing
-- officers serialize on the row lock: exactly one wins, the other gets CASE_TAKEN.
create function public.accept_case(p_case_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  c public.officer_cases := public.pw_lock_case_for_officer(p_case_id);
begin
  if c.status = 'COMPLETED' then perform public.pw_fail('ALREADY_COMPLETED', 'This case is already completed.'); end if;
  if c.assigned_officer_id is not null and c.assigned_officer_id <> me then
    perform public.pw_fail('CASE_TAKEN', 'This case was accepted by another officer.');
  end if;
  if c.status = 'NEW' then
    update public.officer_cases set status = 'EN_ROUTE', assigned_officer_id = me, assigned_at = now(), en_route_at = now()
    where id = c.id;
    insert into public.notifications (recipient_id, recipient_role, type, report_id, case_id, idempotency_key)
    values (me, 'OFFICER', 'CASE_ACCEPTED', c.report_id, c.id, 'CASE_ACCEPTED:' || c.id)
    on conflict (idempotency_key) do nothing;
    perform public.pw_audit(me, 'OFFICER', 'officer_case', c.id, 'CASE_ACCEPTED', '{}'::jsonb);
    perform public.pw_audit(me, 'OFFICER', 'officer_case', c.id, 'EN_ROUTE_STARTED', '{}'::jsonb);
    return jsonb_build_object('changed', true);
  end if;
  if c.status = 'ASSIGNED' then
    update public.officer_cases set status = 'EN_ROUTE', en_route_at = now() where id = c.id;
    perform public.pw_audit(me, 'OFFICER', 'officer_case', c.id, 'EN_ROUTE_STARTED', '{}'::jsonb);
    return jsonb_build_object('changed', true);
  end if;
  -- Already accepted by me (network retry): nothing to do.
  return jsonb_build_object('changed', false);
end $$;

create function public.start_en_route(p_case_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  c public.officer_cases := public.pw_lock_case_for_officer(p_case_id);
begin
  if c.assigned_officer_id is distinct from me then
    perform public.pw_fail(case when c.assigned_officer_id is null then 'INVALID_TRANSITION' else 'CASE_TAKEN' end, 'Not your case.');
  end if;
  if c.status = 'EN_ROUTE' then return jsonb_build_object('changed', false); end if;
  if c.status <> 'ASSIGNED' then perform public.pw_fail('INVALID_TRANSITION', 'The case is not waiting to start.'); end if;
  update public.officer_cases set status = 'EN_ROUTE', en_route_at = coalesce(en_route_at, now()) where id = c.id;
  perform public.pw_audit(me, 'OFFICER', 'officer_case', c.id, 'EN_ROUTE_STARTED', '{}'::jsonb);
  return jsonb_build_object('changed', true);
end $$;

-- EN_ROUTE/ON_SITE -> INSPECTION; creates the inspection and its four
-- unanswered checks. Idempotent once in INSPECTION (never wipes answers).
create function public.start_inspection(p_case_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  c public.officer_cases := public.pw_lock_case_for_officer(p_case_id);
  v_inspection uuid;
  changed boolean := false;
begin
  if c.assigned_officer_id is distinct from me then
    perform public.pw_fail(case when c.assigned_officer_id is null then 'INVALID_TRANSITION' else 'CASE_TAKEN' end, 'Not your case.');
  end if;
  if c.status in ('EN_ROUTE', 'ON_SITE') then
    update public.officer_cases set status = 'INSPECTION', inspection_started_at = coalesce(inspection_started_at, now()) where id = c.id;
    changed := true;
  elsif c.status <> 'INSPECTION' then
    perform public.pw_fail('INVALID_TRANSITION', 'The inspection can start only on the way or on site.');
  end if;
  insert into public.inspections (case_id, started_at) values (c.id, now()) on conflict (case_id) do nothing;
  select i.id into v_inspection from public.inspections i where i.case_id = c.id;
  insert into public.inspection_checks (inspection_id, check_key, answer, answered_at)
  select v_inspection, k, null, null from unnest(enum_range(null::public.inspection_check_key)) k
  on conflict (inspection_id, check_key) do nothing;
  if changed then perform public.pw_audit(me, 'OFFICER', 'inspection', v_inspection, 'INSPECTION_STARTED', jsonb_build_object('case_id', c.id)); end if;
  return jsonb_build_object('changed', changed, 'inspection_id', v_inspection);
end $$;

-- The assigned officer's open inspection for this case (locks the case).
create function public.pw_my_open_inspection(p_case uuid) returns public.inspections
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  c public.officer_cases := public.pw_lock_case_for_officer(p_case);
  i public.inspections;
begin
  if c.assigned_officer_id is distinct from me then perform public.pw_fail('CASE_TAKEN', 'Not your case.'); end if;
  if c.status <> 'INSPECTION' then perform public.pw_fail('INVALID_TRANSITION', 'The case is not in inspection.'); end if;
  select * into i from public.inspections x where x.case_id = c.id;
  if not found then perform public.pw_fail('NOT_FOUND', 'No inspection for this case.'); end if;
  if i.completed_at is not null then perform public.pw_fail('INSPECTION_COMPLETED', 'The inspection is completed.'); end if;
  return i;
end $$;

-- Tri-state answer: true = yes, false = no, null = unanswered (kept distinct).
create function public.set_inspection_check(p_case_id uuid, p_check_key public.inspection_check_key, p_answer boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.inspections := public.pw_my_open_inspection(p_case_id);
begin
  insert into public.inspection_checks (inspection_id, check_key, answer, answered_at)
  values (i.id, p_check_key, p_answer, case when p_answer is null then null else now() end)
  on conflict (inspection_id, check_key) do update set answer = excluded.answer, answered_at = excluded.answered_at;
  perform public.pw_audit(auth.uid(), 'OFFICER', 'inspection', i.id, 'CHECK_CHANGED',
    jsonb_build_object('check', p_check_key::text, 'answer', p_answer));
  return jsonb_build_object('changed', true);
end $$;

-- Officer's manual plate confirmation via the (simulated, non-OCR) control.
create function public.confirm_plate_by_scan(p_case_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.inspections := public.pw_my_open_inspection(p_case_id);
begin
  update public.inspection_checks set answer = true, answered_at = now() where inspection_id = i.id and check_key = 'plateMatches';
  update public.inspections set plate_confirmed_via_scan_at = now() where id = i.id;
  perform public.pw_audit(auth.uid(), 'OFFICER', 'inspection', i.id, 'CHECK_CHANGED', jsonb_build_object('check', 'plateMatches', 'answer', true, 'via', 'confirm_plate'));
  return jsonb_build_object('changed', true);
end $$;

-- Attach (or replace) one officer camera photo already uploaded to officer-evidence.
create function public.add_officer_evidence(p_case_id uuid, p_evidence_type public.officer_evidence_type, p_storage_path text, p_captured_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.inspections := public.pw_my_open_inspection(p_case_id);
  v_id uuid;
begin
  if left(p_storage_path, length(p_case_id::text) + 1) <> p_case_id::text || '/'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'officer-evidence' and o.name = p_storage_path) then
    perform public.pw_fail('EVIDENCE_NOT_UPLOADED', 'The photo was not uploaded.');
  end if;
  insert into public.officer_evidence (inspection_id, case_id, evidence_type, capture_source, storage_path, captured_at)
  values (i.id, p_case_id, p_evidence_type, 'CAMERA', p_storage_path, p_captured_at)
  on conflict (inspection_id, evidence_type) do update
    set storage_path = excluded.storage_path, captured_at = excluded.captured_at, created_at = now()
  returning id into v_id;
  perform public.pw_audit(auth.uid(), 'OFFICER', 'evidence', v_id, 'EVIDENCE_ADDED', jsonb_build_object('type', p_evidence_type::text, 'case_id', p_case_id));
  return jsonb_build_object('evidence_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- complete_case: the outcome and ALL its consequences, atomically.

create function public.complete_case(p_case_id uuid, p_code public.enforcement_outcome_code, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  c public.officer_cases := public.pw_lock_case_for_officer(p_case_id);
  existing public.enforcement_outcomes;
  r public.reports;
  i public.inspections;
  settings public.app_settings;
  pending public.reward_ledger;
  charge integer;
  credited integer := 0;
  allowed public.case_status[];
  new_status public.citizen_report_status;
begin
  if c.status = 'COMPLETED' then
    select * into existing from public.enforcement_outcomes o where o.case_id = c.id;
    if existing.code = p_code then return jsonb_build_object('changed', false, 'credited_cents', 0); end if;
    perform public.pw_fail('ALREADY_COMPLETED', 'This case was already completed with a different result.');
  end if;
  if c.assigned_officer_id is not null and c.assigned_officer_id <> me then
    perform public.pw_fail('CASE_TAKEN', 'This case is assigned to another officer.');
  end if;

  -- Same table as domain COMPLETION_ALLOWED_FROM.
  allowed := case p_code
    when 'CHARGE_ISSUED' then array['INSPECTION']::public.case_status[]
    when 'REPORT_REJECTED' then array['NEW', 'ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'INSPECTION']::public.case_status[]
    when 'DUPLICATE' then array['NEW', 'ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'INSPECTION']::public.case_status[]
    when 'VEHICLE_MOVED' then array['EN_ROUTE', 'ON_SITE', 'INSPECTION']::public.case_status[]
    when 'VALID_PERMIT' then array['ON_SITE', 'INSPECTION']::public.case_status[]
    when 'OTHER' then array['EN_ROUTE', 'ON_SITE', 'INSPECTION']::public.case_status[]
  end;
  if not (c.status = any (allowed)) then
    perform public.pw_fail('INVALID_TRANSITION', 'This result is not possible at the case''s current stage.');
  end if;

  select * into i from public.inspections x where x.case_id = c.id;
  if c.status = 'INSPECTION' and not found then perform public.pw_fail('NOT_FOUND', 'No inspection for this case.'); end if;

  -- CHARGE_ISSUED readiness, checked on the server (never trusted from the app).
  if p_code = 'CHARGE_ISSUED' then
    if (select count(*) from public.inspection_checks k where k.inspection_id = i.id and k.answer is true) <> 4
       or (select count(distinct e.evidence_type) from public.officer_evidence e
           where e.inspection_id = i.id and e.capture_source in ('CAMERA', 'SEED')) <> 4 then
      perform public.pw_fail('INSPECTION_NOT_READY', 'All four checks and all four officer photos are required for a parking charge.');
    end if;
  end if;

  select * into settings from public.app_settings s where s.id;
  charge := case when p_code = 'CHARGE_ISSUED' then settings.parking_charge_amount_cents end;

  insert into public.enforcement_outcomes (case_id, inspection_id, code, decided_by, decided_at, notes, parking_charge_amount_cents)
  values (c.id, i.id, p_code, me, now(), nullif(btrim(coalesce(p_notes, '')), ''), charge);
  update public.officer_cases set status = 'COMPLETED', completed_at = now() where id = c.id;
  if i.id is not null then update public.inspections set completed_at = now() where id = i.id; end if;

  -- Citizen status (outcomes.ts): only CHARGE_ISSUED / REPORT_REJECTED resolve it.
  select * into r from public.reports x where x.id = c.report_id for update;
  new_status := case p_code when 'CHARGE_ISSUED' then 'VERIFIED' when 'REPORT_REJECTED' then 'REJECTED' end;
  if new_status is not null and r.status = 'UNDER_REVIEW' then
    update public.reports set status = new_status, resolved_at = now() where id = r.id;
    perform public.pw_audit(me, 'OFFICER', 'report', r.id, 'REPORT_STATUS_RESOLVED',
      jsonb_build_object('from', 'UNDER_REVIEW', 'to', new_status::text, 'outcome', p_code::text));
  end if;

  -- Reward: release on CHARGE_ISSUED, cancel otherwise (once per report).
  select * into pending from public.reward_ledger l where l.report_id = r.id and l.entry_type = 'REWARD_PENDING';
  if found and not exists (select 1 from public.reward_ledger l where l.report_id = r.id and l.entry_type in ('REWARD_RELEASED', 'REWARD_VOIDED')) then
    if p_code = 'CHARGE_ISSUED' then
      insert into public.reward_ledger (citizen_id, entry_type, amount_cents, report_id, idempotency_key)
      values (r.citizen_id, 'REWARD_RELEASED', pending.amount_cents, r.id, 'REWARD_RELEASED:' || r.id);
      credited := pending.amount_cents;
    else
      insert into public.reward_ledger (citizen_id, entry_type, amount_cents, report_id, idempotency_key)
      values (r.citizen_id, 'REWARD_VOIDED', pending.amount_cents, r.id, 'REWARD_VOIDED:' || r.id);
    end if;
    perform public.pw_audit(me, 'OFFICER', 'reward', r.id, 'REWARD_CHANGED',
      jsonb_build_object('entry', case when p_code = 'CHARGE_ISSUED' then 'REWARD_RELEASED' else 'REWARD_VOIDED' end, 'amount_cents', pending.amount_cents));
  end if;

  -- Notifications (notifications.ts): citizen only for VERIFIED / REJECTED.
  if p_code = 'CHARGE_ISSUED' then
    insert into public.notifications (recipient_id, recipient_role, type, report_id, case_id, amount_cents, idempotency_key)
    values (r.citizen_id, 'CITIZEN', 'REPORT_VERIFIED', r.id, c.id, nullif(credited, 0), 'REPORT_VERIFIED:' || r.id)
    on conflict (idempotency_key) do nothing;
  elsif p_code = 'REPORT_REJECTED' then
    insert into public.notifications (recipient_id, recipient_role, type, report_id, case_id, idempotency_key)
    values (r.citizen_id, 'CITIZEN', 'REPORT_REJECTED', r.id, c.id, 'REPORT_REJECTED:' || r.id)
    on conflict (idempotency_key) do nothing;
  end if;
  insert into public.notifications (recipient_id, recipient_role, type, report_id, case_id, amount_cents, idempotency_key)
  values (me, 'OFFICER', case when p_code = 'CHARGE_ISSUED' then 'PARKING_CHARGE_ISSUED' else 'CASE_CLOSED_WITHOUT_CHARGE' end::public.notification_type,
          r.id, c.id, charge,
          case when p_code = 'CHARGE_ISSUED' then 'PARKING_CHARGE_ISSUED:' else 'CASE_CLOSED_WITHOUT_CHARGE:' end || c.id)
  on conflict (idempotency_key) do nothing;

  perform public.pw_audit(me, 'OFFICER', 'outcome', c.id, 'OUTCOME_RECORDED', jsonb_build_object('code', p_code::text, 'charge_cents', charge));
  perform public.pw_audit(me, 'OFFICER', 'officer_case', c.id, 'CASE_COMPLETED', '{}'::jsonb);
  return jsonb_build_object('changed', true, 'credited_cents', credited);
end $$;

-- ---------------------------------------------------------------------------
-- Reads (SECURITY INVOKER: Row Level Security decides what each caller sees)

create function public.get_core_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.submitted_at desc) from (select * from public.reports order by submitted_at desc limit 300) r), '[]'::jsonb),
    'report_evidence', coalesce((select jsonb_agg(to_jsonb(e)) from public.report_evidence e
                                 where e.report_id in (select id from public.reports order by submitted_at desc limit 300)), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(to_jsonb(c)) from (select * from public.officer_cases order by created_at desc limit 300) c), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(to_jsonb(o)) from public.enforcement_outcomes o), '[]'::jsonb),
    'inspections', coalesce((select jsonb_agg(to_jsonb(i)) from public.inspections i), '[]'::jsonb),
    'inspection_checks', coalesce((select jsonb_agg(to_jsonb(k)) from public.inspection_checks k), '[]'::jsonb),
    'officer_evidence', coalesce((select jsonb_agg(to_jsonb(v)) from public.officer_evidence v), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.reward_ledger l), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from (select * from public.notifications order by created_at desc limit 200) n), '[]'::jsonb)
  );
$$;

create function public.mark_my_notifications_read() returns jsonb
language sql security invoker set search_path = '' as $$
  with updated as (
    update public.notifications set read_at = now() where recipient_id = auth.uid() and read_at is null returning 1
  )
  select jsonb_build_object('updated', (select count(*) from updated));
$$;

-- ---------------------------------------------------------------------------
-- Privileges for the new functions

revoke all on function
  public.pw_fail(text, text), public.pw_require_user(), public.pw_audit(uuid, public.actor_role, text, uuid, text, jsonb),
  public.resolve_report_jurisdiction(double precision, double precision), public.pw_lock_case_for_officer(uuid),
  public.pw_my_open_inspection(uuid)
from public, anon, authenticated;

revoke all on function
  public.submit_report(text, text, text, timestamptz, timestamptz, jsonb, text, double precision, double precision, double precision, timestamptz, text, text, text, text, text, text, public.vehicle_info_source),
  public.accept_case(uuid), public.start_en_route(uuid), public.start_inspection(uuid),
  public.set_inspection_check(uuid, public.inspection_check_key, boolean), public.confirm_plate_by_scan(uuid),
  public.add_officer_evidence(uuid, public.officer_evidence_type, text, timestamptz), public.complete_case(uuid, public.enforcement_outcome_code, text),
  public.get_core_snapshot(), public.mark_my_notifications_read()
from public, anon;

grant execute on function
  public.submit_report(text, text, text, timestamptz, timestamptz, jsonb, text, double precision, double precision, double precision, timestamptz, text, text, text, text, text, text, public.vehicle_info_source),
  public.accept_case(uuid), public.start_en_route(uuid), public.start_inspection(uuid),
  public.set_inspection_check(uuid, public.inspection_check_key, boolean), public.confirm_plate_by_scan(uuid),
  public.add_officer_evidence(uuid, public.officer_evidence_type, text, timestamptz), public.complete_case(uuid, public.enforcement_outcome_code, text),
  public.get_core_snapshot(), public.mark_my_notifications_read()
to authenticated;
