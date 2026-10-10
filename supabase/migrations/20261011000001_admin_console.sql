-- ============================================================================
-- T9.0: Supervisor/Admin operations console (READ-ONLY).
--
-- Who: a signed-in user whose server-set profile role is SUPERVISOR or ADMIN
-- AND who has an ACTIVE organization membership with member_role SUPERVISOR or
-- ADMIN. Both are writable only by the service role / admin tooling. Nothing
-- from the client decides identity, role or organization: every function
-- derives the caller's scope from auth.uid().
--
-- Scope: ONLY the jurisdictions of the caller's console organizations. There
-- is no global/super admin: ADMIN is organization-scoped exactly like
-- SUPERVISOR (the existing model defines no wider authority). A report, case
-- or ledger row outside the caller's scope is indistinguishable from a
-- missing one.
--
-- Read-only: no function here changes data. Existing RLS is unchanged; the
-- only additions are two storage SELECT policies so console members can view
-- (via short-lived signed URLs) the evidence of their own organization.
--
-- Data minimization: citizens appear only as a pseudonymous reference
-- (C-xxxxxxxx); no names, emails or citizen account balances. Officers appear
-- with display name and membership only; no location history.
-- Withdrawals, notifications and profile events are citizen-account data and
-- are not shown.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Scope helpers (internal)

create function public.pw_console_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.organization_id
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
    and m.active
    and m.member_role in ('SUPERVISOR', 'ADMIN')
    and p.role in ('SUPERVISOR', 'ADMIN');
$$;

create function public.pw_console_jurisdiction_ids() returns setof text
language sql stable security definer set search_path = '' as $$
  select j.id from public.jurisdictions j where j.organization_id in (select public.pw_console_org_ids());
$$;

create function public.pw_require_console() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: Sign in required.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.pw_console_org_ids()) then
    raise exception 'FORBIDDEN: The operations console is for active supervisors and administrators.' using errcode = 'P0001';
  end if;
end $$;

-- Pseudonymous citizen reference for operations (stable per citizen, not reversible in the UI).
create function public.pw_citizen_ref(p_citizen uuid) returns text
language sql immutable set search_path = '' as $$
  select 'C-' || upper(left(md5(p_citizen::text), 8));
$$;

create function public.pw_console_limit(p_limit integer) returns integer
language sql immutable set search_path = '' as $$
  select least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

-- Storage policy helper: may the caller (console member) read this evidence object?
create function public.can_console_read_evidence_object(p_bucket text, object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'report-evidence' then exists (
      select 1 from public.report_evidence e join public.reports r on r.id = e.report_id
      where e.storage_path = object_name and r.jurisdiction_id in (select public.pw_console_jurisdiction_ids()))
    when 'officer-evidence' then exists (
      select 1 from public.officer_evidence e join public.officer_cases c on c.id = e.case_id
      where e.storage_path = object_name and c.jurisdiction_id in (select public.pw_console_jurisdiction_ids()))
    else false
  end;
$$;

create policy pw_console_report_evidence_select on storage.objects for select to authenticated
  using (bucket_id = 'report-evidence' and public.can_console_read_evidence_object(bucket_id, name));
create policy pw_console_officer_evidence_select on storage.objects for select to authenticated
  using (bucket_id = 'officer-evidence' and public.can_console_read_evidence_object(bucket_id, name));

-- Reward state of one report from its ledger entries (never by summing rows:
-- PENDING followed by RELEASED is ONE reward, not two).
create function public.pw_report_reward_state(p_report uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.reward_ledger l where l.report_id = p_report and l.entry_type = 'REWARD_RELEASED') then 'AVAILABLE'
    when exists (select 1 from public.reward_ledger l where l.report_id = p_report and l.entry_type = 'REWARD_VOIDED') then 'VOIDED'
    when exists (select 1 from public.reward_ledger l where l.report_id = p_report and l.entry_type = 'REWARD_PENDING') then 'PENDING'
    else 'NONE'
  end;
$$;

-- Display name of an officer/supervisor in one of the caller's organizations (else null).
create function public.pw_console_member_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(p.display_name, '') from public.profiles p
  where p.id = p_user
    and exists (select 1 from public.organization_members m where m.user_id = p_user and m.organization_id in (select public.pw_console_org_ids()));
$$;

-- ---------------------------------------------------------------------------
-- Who am I in the console

create function public.admin_whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.pw_require_console();
  return jsonb_build_object(
    'role', (select p.role from public.profiles p where p.id = auth.uid()),
    'display_name', (select p.display_name from public.profiles p where p.id = auth.uid()),
    'organizations', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'member_role', m.member_role) order by o.name), '[]'::jsonb)
      from public.organizations o join public.organization_members m on m.organization_id = o.id
      where m.user_id = auth.uid() and o.id in (select public.pw_console_org_ids())),
    'jurisdictions', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from public.pw_console_jurisdiction_ids() x)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Overview

create function public.admin_overview(p_time_zone text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := coalesce(nullif(btrim(p_time_zone), ''), 'UTC');
  today_start timestamptz;
  result jsonb;
begin
  perform public.pw_require_console();
  begin
    today_start := (date_trunc('day', now() at time zone tz)) at time zone tz;
  exception when others then
    tz := 'UTC';
    today_start := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  end;

  with r as (select * from public.reports x where x.jurisdiction_id in (select public.pw_console_jurisdiction_ids())),
  c as (select * from public.officer_cases x where x.jurisdiction_id in (select public.pw_console_jurisdiction_ids())),
  o as (select x.* from public.enforcement_outcomes x join c on c.id = x.case_id),
  rs as (select r.id, public.pw_report_reward_state(r.id) st from r),
  days as (select generate_series(0, 6) d)
  select jsonb_build_object(
    'reports_under_review', (select count(*) from r where r.status = 'UNDER_REVIEW'),
    'reports_received_today', (select count(*) from r where r.received_at >= today_start),
    'cases_active', (select count(*) from c where c.status <> 'COMPLETED'),
    'cases_new', (select count(*) from c where c.status = 'NEW'),
    'cases_assigned', (select count(*) from c where c.status = 'ASSIGNED'),
    'cases_en_route', (select count(*) from c where c.status = 'EN_ROUTE'),
    'cases_on_site', (select count(*) from c where c.status in ('ON_SITE', 'INSPECTION')),
    'cases_high_priority_open', (select count(*) from c where c.status <> 'COMPLETED' and c.priority = 'HIGH'),
    'completed_today', (select count(*) from o where o.decided_at >= today_start),
    'charges_today', (select count(*) from o where o.decided_at >= today_start and o.code = 'CHARGE_ISSUED'),
    'rejected_today', (select count(*) from o where o.decided_at >= today_start and o.code = 'REPORT_REJECTED'),
    'no_charge_today', (select count(*) from o where o.decided_at >= today_start and o.code in ('VEHICLE_MOVED', 'VALID_PERMIT', 'DUPLICATE', 'OTHER')),
    'rewards_pending_count', (select count(*) from rs where st = 'PENDING'),
    'rewards_pending_cents', (select coalesce(sum(l.amount_cents), 0) from rs join public.reward_ledger l on l.report_id = rs.id and l.entry_type = 'REWARD_PENDING' where rs.st = 'PENDING'),
    'rewards_available_count', (select count(*) from rs where st = 'AVAILABLE'),
    'rewards_available_cents', (select coalesce(sum(l.amount_cents), 0) from rs join public.reward_ledger l on l.report_id = rs.id and l.entry_type = 'REWARD_RELEASED' where rs.st = 'AVAILABLE'),
    'last_7_days', (
      select jsonb_agg(jsonb_build_object(
        'day', to_char((today_start - make_interval(days => d)) at time zone tz, 'YYYY-MM-DD'),
        'received', (select count(*) from r where r.received_at >= today_start - make_interval(days => d) and r.received_at < today_start - make_interval(days => d - 1)),
        'completed', (select count(*) from o where o.decided_at >= today_start - make_interval(days => d) and o.decided_at < today_start - make_interval(days => d - 1))
      ) order by d desc) from days),
    'time_zone', tz
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Reports

create function public.pw_plate_key(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9ÅÄÖåäö]', '', 'g')), '');
$$;

create function public.admin_page_reports(
  p_status public.citizen_report_status default null,
  p_priority public.report_priority default null,
  p_case_state text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  lim integer := public.pw_console_limit(p_limit);
  off integer := greatest(coalesce(p_offset, 0), 0);
  q text := nullif(btrim(coalesce(p_search, '')), '');
  num bigint := case when q ~ '^#?[0-9]{1,12}$' then ltrim(q, '#')::bigint end;
  plate text := public.pw_plate_key(q);
  result jsonb;
begin
  perform public.pw_require_console();
  if p_case_state is not null and p_case_state not in ('active', 'completed') then
    raise exception 'INVALID_INPUT: Unknown case filter.' using errcode = 'P0001';
  end if;
  with f as (
    select r.*, c.id case_id, c.status case_status, c.assigned_officer_id, o.code outcome_code
    from public.reports r
    left join public.officer_cases c on c.report_id = r.id
    left join public.enforcement_outcomes o on o.case_id = c.id
    where r.jurisdiction_id in (select public.pw_console_jurisdiction_ids())
      and (p_status is null or r.status = p_status)
      and (p_priority is null or r.priority = p_priority)
      and (p_case_state is null or (p_case_state = 'active' and c.status <> 'COMPLETED') or (p_case_state = 'completed' and c.status = 'COMPLETED'))
      and (p_from is null or r.received_at >= p_from)
      and (p_to is null or r.received_at < p_to)
      and (q is null or r.public_report_number = num or (plate is not null and r.plate_normalized like '%' || plate || '%'))
  ), page as (
    select * from f order by f.received_at desc, f.id desc offset off limit lim
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'next_offset', case when (select count(*) from f) > off + lim then off + lim end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'public_report_number', p.public_report_number, 'status', p.status, 'priority', p.priority,
      'submitted_at', p.submitted_at, 'received_at', p.received_at, 'observed_at', p.observed_at,
      'plate_raw', p.plate_raw, 'violation_type', p.violation_type, 'location_address', p.location_address,
      'case_id', p.case_id, 'case_status', p.case_status, 'outcome_code', p.outcome_code,
      'assigned_officer_name', public.pw_console_member_name(p.assigned_officer_id)
    ) order by p.received_at desc, p.id desc) from page p), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- Audit events of one report and everything hanging off it (case, inspection, evidence, outcome, reward).
create function public.pw_report_audit(p_report uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ents as (
    select 'report'::text t, p_report id
    union all select 'reward', p_report
    union all select 'officer_case', c.id from public.officer_cases c where c.report_id = p_report
    union all select 'inspection', i.id from public.inspections i join public.officer_cases c on c.id = i.case_id where c.report_id = p_report
    union all select 'evidence', e.id from public.officer_evidence e join public.officer_cases c on c.id = e.case_id where c.report_id = p_report
    union all select 'outcome', o.id from public.enforcement_outcomes o join public.officer_cases c on c.id = o.case_id where c.report_id = p_report
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'created_at', a.created_at, 'actor_role', a.actor_role, 'source', a.source,
    'actor_label', case when a.actor_role = 'CITIZEN' and a.actor_user_id is not null then public.pw_citizen_ref(a.actor_user_id)
                        when a.actor_role = 'SYSTEM' then 'ParkWatch'
                        else coalesce(public.pw_console_member_name(a.actor_user_id), initcap(a.actor_role::text)) end,
    'entity_type', a.entity_type, 'event_type', a.event_type, 'metadata', a.metadata
  ) order by a.created_at, a.id), '[]'::jsonb)
  from public.audit_events a join ents on ents.t = a.entity_type and ents.id = a.entity_id;
$$;

create function public.admin_get_report(p_public_number bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  c public.officer_cases;
begin
  perform public.pw_require_console();
  select * into r from public.reports x
  where x.public_report_number = p_public_number and x.jurisdiction_id in (select public.pw_console_jurisdiction_ids());
  if not found then return null; end if; -- missing and out-of-scope look the same
  select * into c from public.officer_cases x where x.report_id = r.id;
  return jsonb_build_object(
    'report', jsonb_build_object(
      'id', r.id, 'public_report_number', r.public_report_number, 'status', r.status, 'priority', r.priority,
      'violation_type', r.violation_type, 'plate_raw', r.plate_raw, 'vehicle_make', r.vehicle_make, 'vehicle_model', r.vehicle_model,
      'vehicle_color', r.vehicle_color, 'vehicle_source', r.vehicle_source,
      'location_address', r.location_address, 'latitude', r.latitude, 'longitude', r.longitude,
      'location_accuracy_m', r.location_accuracy_m, 'location_source', r.location_source,
      'notes', r.notes, 'observed_at', r.observed_at, 'submitted_at', r.submitted_at, 'received_at', r.received_at,
      'resolved_at', r.resolved_at, 'citizen_ref', public.pw_citizen_ref(r.citizen_id)),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('slot', e.slot, 'capture_source', e.capture_source, 'storage_path', e.storage_path, 'captured_at', e.captured_at) order by e.slot, e.created_at)
                          from public.report_evidence e where e.report_id = r.id), '[]'::jsonb),
    'case', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'status', c.status, 'priority', c.priority, 'assigned_officer_name', public.pw_console_member_name(c.assigned_officer_id),
      'created_at', c.created_at, 'assigned_at', c.assigned_at, 'en_route_at', c.en_route_at, 'on_site_at', c.on_site_at,
      'inspection_started_at', c.inspection_started_at, 'completed_at', c.completed_at) end,
    'outcome', (select jsonb_build_object('code', o.code, 'decided_at', o.decided_at, 'decided_by_name', public.pw_console_member_name(o.decided_by),
                  'parking_charge_amount_cents', o.parking_charge_amount_cents, 'notes', o.notes)
                from public.enforcement_outcomes o where o.case_id = c.id),
    'reward_state', public.pw_report_reward_state(r.id),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'entry_type', l.entry_type, 'amount_cents', l.amount_cents, 'created_at', l.created_at) order by l.created_at, l.id)
                        from public.reward_ledger l where l.report_id = r.id), '[]'::jsonb),
    'audit', public.pw_report_audit(r.id)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Cases

create function public.admin_page_cases(
  p_status public.case_status default null,
  p_officer uuid default null,
  p_outcome public.enforcement_outcome_code default null,
  p_priority public.report_priority default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  lim integer := public.pw_console_limit(p_limit);
  off integer := greatest(coalesce(p_offset, 0), 0);
  q text := nullif(btrim(coalesce(p_search, '')), '');
  num bigint := case when q ~ '^#?[0-9]{1,12}$' then ltrim(q, '#')::bigint end;
  plate text := public.pw_plate_key(q);
  result jsonb;
begin
  perform public.pw_require_console();
  with f as (
    select c.*, r.public_report_number, r.plate_raw, r.violation_type, r.location_address, o.code outcome_code, o.decided_at,
           o.parking_charge_amount_cents
    from public.officer_cases c
    join public.reports r on r.id = c.report_id
    left join public.enforcement_outcomes o on o.case_id = c.id
    where c.jurisdiction_id in (select public.pw_console_jurisdiction_ids())
      and (p_status is null or c.status = p_status)
      and (p_officer is null or c.assigned_officer_id = p_officer)
      and (p_outcome is null or o.code = p_outcome)
      and (p_priority is null or c.priority = p_priority)
      and (p_from is null or c.created_at >= p_from)
      and (p_to is null or c.created_at < p_to)
      and (q is null or r.public_report_number = num or (plate is not null and r.plate_normalized like '%' || plate || '%'))
  ), page as (
    select * from f order by f.created_at desc, f.id desc offset off limit lim
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'next_offset', case when (select count(*) from f) > off + lim then off + lim end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'public_report_number', p.public_report_number, 'status', p.status, 'priority', p.priority,
      'assigned_officer_id', p.assigned_officer_id, 'assigned_officer_name', public.pw_console_member_name(p.assigned_officer_id),
      'location_address', p.location_address, 'plate_raw', p.plate_raw, 'violation_type', p.violation_type,
      'created_at', p.created_at, 'assigned_at', p.assigned_at, 'inspection_started_at', p.inspection_started_at, 'completed_at', p.completed_at,
      'outcome_code', p.outcome_code, 'decided_at', p.decided_at,
      'parking_charge_amount_cents', case when p.outcome_code = 'CHARGE_ISSUED' then p.parking_charge_amount_cents end
    ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb)
  ) into result;
  return result;
end $$;

create function public.admin_get_case(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.officer_cases;
  r public.reports;
  i public.inspections;
begin
  perform public.pw_require_console();
  select * into c from public.officer_cases x where x.id = p_case_id and x.jurisdiction_id in (select public.pw_console_jurisdiction_ids());
  if not found then return null; end if;
  select * into r from public.reports x where x.id = c.report_id;
  select * into i from public.inspections x where x.case_id = c.id;
  return jsonb_build_object(
    'case', jsonb_build_object(
      'id', c.id, 'status', c.status, 'priority', c.priority, 'assigned_officer_name', public.pw_console_member_name(c.assigned_officer_id),
      'created_at', c.created_at, 'assigned_at', c.assigned_at, 'en_route_at', c.en_route_at, 'on_site_at', c.on_site_at,
      'inspection_started_at', c.inspection_started_at, 'completed_at', c.completed_at),
    'report', jsonb_build_object(
      'id', r.id, 'public_report_number', r.public_report_number, 'status', r.status, 'violation_type', r.violation_type,
      'plate_raw', r.plate_raw, 'vehicle_make', r.vehicle_make, 'vehicle_model', r.vehicle_model, 'vehicle_color', r.vehicle_color,
      'location_address', r.location_address, 'latitude', r.latitude, 'longitude', r.longitude, 'location_source', r.location_source,
      'notes', r.notes, 'observed_at', r.observed_at, 'received_at', r.received_at, 'citizen_ref', public.pw_citizen_ref(r.citizen_id)),
    'citizen_evidence', coalesce((select jsonb_agg(jsonb_build_object('slot', e.slot, 'capture_source', e.capture_source, 'storage_path', e.storage_path, 'captured_at', e.captured_at) order by e.slot, e.created_at)
                                  from public.report_evidence e where e.report_id = r.id), '[]'::jsonb),
    'officer_evidence', coalesce((select jsonb_agg(jsonb_build_object('evidence_type', e.evidence_type, 'storage_path', e.storage_path, 'captured_at', e.captured_at) order by e.evidence_type)
                                  from public.officer_evidence e where e.case_id = c.id), '[]'::jsonb),
    'inspection', case when i.id is null then null else jsonb_build_object(
      'started_at', i.started_at, 'completed_at', i.completed_at, 'notes', i.notes, 'plate_confirmed_via_scan_at', i.plate_confirmed_via_scan_at,
      'checks', coalesce((select jsonb_agg(jsonb_build_object('key', k.check_key, 'answer', k.answer, 'answered_at', k.answered_at) order by k.check_key)
                          from public.inspection_checks k where k.inspection_id = i.id), '[]'::jsonb)) end,
    'outcome', (select jsonb_build_object('code', o.code, 'decided_at', o.decided_at, 'decided_by_name', public.pw_console_member_name(o.decided_by),
                  'parking_charge_amount_cents', case when o.code = 'CHARGE_ISSUED' then o.parking_charge_amount_cents end, 'notes', o.notes)
                from public.enforcement_outcomes o where o.case_id = c.id),
    'reward_state', public.pw_report_reward_state(r.id),
    'audit', public.pw_report_audit(r.id)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Officers (members of the caller's organizations only; no location data)

create function public.admin_list_officers(p_month_start timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := coalesce(p_month_start, date_trunc('month', now()));
begin
  perform public.pw_require_console();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id, 'display_name', nullif(p.display_name, ''), 'profile_role', p.role,
      'member_role', m.member_role, 'active', m.active, 'organization_id', o.id, 'organization_name', o.name,
      'active_cases', (select count(*) from public.officer_cases c
                       where c.assigned_officer_id = m.user_id and c.status <> 'COMPLETED'
                         and c.jurisdiction_id in (select j.id from public.jurisdictions j where j.organization_id = o.id)),
      'completed_this_month', (select count(*) from public.enforcement_outcomes x join public.officer_cases c on c.id = x.case_id
                               where x.decided_by = m.user_id and x.decided_at >= since
                                 and c.jurisdiction_id in (select j.id from public.jurisdictions j where j.organization_id = o.id))
    ) order by o.name, m.active desc, p.display_name, m.user_id)
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p on p.id = m.user_id
    where m.organization_id in (select public.pw_console_org_ids())
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Reward ledger (monitoring/reconciliation only; no payments)

create function public.admin_page_rewards(
  p_entry_type public.reward_entry_type default null,
  p_state text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  lim integer := public.pw_console_limit(p_limit);
  off integer := greatest(coalesce(p_offset, 0), 0);
  q text := nullif(btrim(coalesce(p_search, '')), '');
  num bigint := case when q ~ '^#?[0-9]{1,12}$' then ltrim(q, '#')::bigint end;
  result jsonb;
begin
  perform public.pw_require_console();
  if p_state is not null and p_state not in ('PENDING', 'AVAILABLE', 'VOIDED') then
    raise exception 'INVALID_INPUT: Unknown reward state.' using errcode = 'P0001';
  end if;
  with sr as (
    select r.id, r.public_report_number, r.citizen_id, public.pw_report_reward_state(r.id) st
    from public.reports r where r.jurisdiction_id in (select public.pw_console_jurisdiction_ids())
  ), f as (
    select l.*, sr.public_report_number, sr.citizen_id report_citizen, sr.st
    from public.reward_ledger l join sr on sr.id = l.report_id
    where (p_entry_type is null or l.entry_type = p_entry_type)
      and (p_state is null or sr.st = p_state)
      and (q is null or sr.public_report_number = num)
      and (p_from is null or l.created_at >= p_from)
      and (p_to is null or l.created_at < p_to)
  ), page as (
    select * from f order by f.created_at desc, f.id desc offset off limit lim
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'next_offset', case when (select count(*) from f) > off + lim then off + lim end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'created_at', p.created_at, 'entry_type', p.entry_type, 'amount_cents', p.amount_cents,
      'public_report_number', p.public_report_number, 'citizen_ref', public.pw_citizen_ref(p.report_citizen), 'reward_state', p.st
    ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb),
    -- One reward per report (by state), never a sum over ledger rows.
    'summary', (select jsonb_build_object(
      'pending_count', count(*) filter (where st = 'PENDING'),
      'available_count', count(*) filter (where st = 'AVAILABLE'),
      'voided_count', count(*) filter (where st = 'VOIDED'),
      'pending_cents', coalesce(sum(l.amount_cents) filter (where st = 'PENDING'), 0),
      'available_cents', coalesce(sum(l.amount_cents) filter (where st = 'AVAILABLE'), 0)
    ) from sr join public.reward_ledger l on l.report_id = sr.id and l.entry_type = 'REWARD_PENDING')
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Audit log (organization entities only)

create function public.admin_page_audit(
  p_actor_role public.actor_role default null,
  p_entity_type text default null,
  p_event_type text default null,
  p_ref text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_offset integer default 0,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  lim integer := public.pw_console_limit(p_limit);
  off integer := greatest(coalesce(p_offset, 0), 0);
  ref text := nullif(btrim(coalesce(p_ref, '')), '');
  ref_num bigint := case when ref ~ '^#?[0-9]{1,12}$' then ltrim(ref, '#')::bigint end;
  ref_uuid uuid := public.try_uuid(ref);
  result jsonb;
begin
  perform public.pw_require_console();
  if p_entity_type is not null and p_entity_type not in ('report', 'officer_case', 'inspection', 'evidence', 'outcome', 'reward') then
    raise exception 'INVALID_INPUT: Unknown entity type.' using errcode = 'P0001';
  end if;
  with sr as (
    select r.id, r.public_report_number from public.reports r
    where r.jurisdiction_id in (select public.pw_console_jurisdiction_ids())
      and (ref is null or r.public_report_number = ref_num
           or exists (select 1 from public.officer_cases c where c.report_id = r.id and c.id = ref_uuid))
  ), ents as (
    select 'report'::text t, sr.id, sr.public_report_number num from sr
    union all select 'reward', sr.id, sr.public_report_number from sr
    union all select 'officer_case', c.id, sr.public_report_number from public.officer_cases c join sr on sr.id = c.report_id
    union all select 'inspection', i.id, sr.public_report_number from public.inspections i join public.officer_cases c on c.id = i.case_id join sr on sr.id = c.report_id
    union all select 'evidence', e.id, sr.public_report_number from public.officer_evidence e join public.officer_cases c on c.id = e.case_id join sr on sr.id = c.report_id
    union all select 'outcome', o.id, sr.public_report_number from public.enforcement_outcomes o join public.officer_cases c on c.id = o.case_id join sr on sr.id = c.report_id
  ), f as (
    select a.*, ents.num from public.audit_events a join ents on ents.t = a.entity_type and ents.id = a.entity_id
    where (p_actor_role is null or a.actor_role = p_actor_role)
      and (p_entity_type is null or a.entity_type = p_entity_type)
      and (p_event_type is null or a.event_type = p_event_type)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
  ), page as (
    select * from f order by f.created_at desc, f.id desc offset off limit lim
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'next_offset', case when (select count(*) from f) > off + lim then off + lim end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'created_at', p.created_at, 'actor_role', p.actor_role, 'source', p.source,
      'actor_label', case when p.actor_role = 'CITIZEN' and p.actor_user_id is not null then public.pw_citizen_ref(p.actor_user_id)
                          when p.actor_role = 'SYSTEM' then 'ParkWatch'
                          else coalesce(public.pw_console_member_name(p.actor_user_id), initcap(p.actor_role::text)) end,
      'entity_type', p.entity_type, 'event_type', p.event_type, 'public_report_number', p.num, 'metadata', p.metadata
    ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges

-- Internal helpers: not client API.
revoke all on function
  public.pw_console_org_ids(), public.pw_console_jurisdiction_ids(), public.pw_require_console(),
  public.pw_citizen_ref(uuid), public.pw_console_limit(integer), public.pw_report_reward_state(uuid),
  public.pw_console_member_name(uuid), public.pw_plate_key(text), public.pw_report_audit(uuid)
from public, anon, authenticated;

-- Storage policy helper: evaluated for signed-in users only.
revoke all on function public.can_console_read_evidence_object(text, text) from public, anon;
grant execute on function public.can_console_read_evidence_object(text, text) to authenticated;

-- Console API: signed-in users only (each function refuses non-console callers itself).
revoke all on function
  public.admin_whoami(), public.admin_overview(text),
  public.admin_page_reports(public.citizen_report_status, public.report_priority, text, timestamptz, timestamptz, text, integer, integer),
  public.admin_get_report(bigint),
  public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer),
  public.admin_get_case(uuid), public.admin_list_officers(timestamptz),
  public.admin_page_rewards(public.reward_entry_type, text, text, timestamptz, timestamptz, integer, integer),
  public.admin_page_audit(public.actor_role, text, text, text, timestamptz, timestamptz, integer, integer)
from public, anon;
grant execute on function
  public.admin_whoami(), public.admin_overview(text),
  public.admin_page_reports(public.citizen_report_status, public.report_priority, text, timestamptz, timestamptz, text, integer, integer),
  public.admin_get_report(bigint),
  public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer),
  public.admin_get_case(uuid), public.admin_list_officers(timestamptz),
  public.admin_page_rewards(public.reward_entry_type, text, text, timestamptz, timestamptz, integer, integer),
  public.admin_page_audit(public.actor_role, text, text, text, timestamptz, timestamptz, integer, integer)
to authenticated;
