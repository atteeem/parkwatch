-- ============================================================================
-- T9.2 (3/3): minimum supervisor write actions + "needs attention".
--
-- Supervisor/Admin (same console scope as T9.0: active SUPERVISOR/ADMIN
-- membership + profile role, organization-scoped, no global admin) may:
--   * assign   a NEW case (nobody has it)            NEW      -> ASSIGNED
--   * reassign an ASSIGNED case (not started yet)    ASSIGNED -> ASSIGNED (other officer)
--   * return   an ASSIGNED case to the queue         ASSIGNED -> NEW
-- Once the officer has started (EN_ROUTE / ON_SITE / INSPECTION) the case is
-- NOT moved by the console: the officer is travelling or holds evidence, and
-- moving it would invent a lifecycle transition. COMPLETED is final.
--
-- Concurrency: every write takes the case row lock and requires the
-- assignment_version the supervisor's screen was showing; anything changed in
-- between (another supervisor, the officer starting the case) -> STALE_ASSIGNMENT
-- or NOT_ASSIGNABLE. Retrying the same successful request is a no-op
-- (changed=false): no second notification, push or audit event.
--
-- Target officer: ACTIVE member_role OFFICER of the case's organization with
-- profile role OFFICER. Never another organization. Identity/role/organization
-- are derived from auth.uid(); no client parameter carries them.
--
-- assigned_at now means "when the CURRENT assignment was made" (set on
-- assign/reassign, cleared on return to queue); history lives in audit_events.
-- ============================================================================

alter table public.officer_cases
  add column assignment_version integer not null default 0 check (assignment_version >= 0);

-- "Needs attention" thresholds (minutes in the current status). Server config
-- (service role only), mirrored by DEFAULT_ATTENTION_THRESHOLDS in
-- src/admin/attention.ts for the local demo. Lifecycle timestamps only: no
-- location, no tracking.
alter table public.app_settings
  add column attention_new_minutes integer not null default 30 check (attention_new_minutes > 0),
  add column attention_assigned_minutes integer not null default 20 check (attention_assigned_minutes > 0),
  add column attention_en_route_minutes integer not null default 45 check (attention_en_route_minutes > 0),
  add column attention_on_site_minutes integer not null default 20 check (attention_on_site_minutes > 0),
  add column attention_inspection_minutes integer not null default 30 check (attention_inspection_minutes > 0);

-- ---------------------------------------------------------------------------
-- Attention helpers

-- When the case entered its current status (COMPLETED -> null: never flagged).
create function public.pw_case_status_since(
  p_status public.case_status, p_created timestamptz, p_assigned timestamptz,
  p_en_route timestamptz, p_on_site timestamptz, p_inspection timestamptz
) returns timestamptz
language sql immutable set search_path = '' as $$
  select case p_status
    when 'NEW' then p_created
    when 'ASSIGNED' then coalesce(p_assigned, p_created)
    when 'EN_ROUTE' then coalesce(p_en_route, p_assigned, p_created)
    when 'ON_SITE' then coalesce(p_on_site, p_en_route, p_created)
    when 'INSPECTION' then coalesce(p_inspection, p_on_site, p_en_route, p_created)
  end;
$$;

create function public.pw_attention_minutes(p_status public.case_status) returns integer
language sql stable security definer set search_path = '' as $$
  select case p_status
    when 'NEW' then s.attention_new_minutes
    when 'ASSIGNED' then s.attention_assigned_minutes
    when 'EN_ROUTE' then s.attention_en_route_minutes
    when 'ON_SITE' then s.attention_on_site_minutes
    when 'INSPECTION' then s.attention_inspection_minutes
  end
  from public.app_settings s where s.id;
$$;

create function public.pw_needs_attention(p_status public.case_status, p_since timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_status <> 'COMPLETED' and p_since is not null
     and now() - p_since >= make_interval(mins => coalesce(public.pw_attention_minutes(p_status), 2147483647));
$$;

-- ---------------------------------------------------------------------------
-- Audit view for the console: the T9.0 allow-list, plus officer NAMES for
-- assignment events (raw officer ids stay in the database).

create function public.pw_console_audit_view(p_metadata jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.pw_console_audit_metadata(p_metadata) || jsonb_strip_nulls(jsonb_build_object(
    'from_officer', case when jsonb_typeof(p_metadata -> 'from_officer') = 'string'
                         then coalesce(public.pw_console_member_name(public.try_uuid(p_metadata ->> 'from_officer')), 'Officer') end,
    'to_officer', case when jsonb_typeof(p_metadata -> 'to_officer') = 'string'
                       then coalesce(public.pw_console_member_name(public.try_uuid(p_metadata ->> 'to_officer')), 'Officer') end));
$$;

create or replace function public.pw_report_audit(p_report uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ents as (
    select 'report'::text t, p_report id
    union all select 'reward', p_report
    union all select 'officer_case', c.id from public.officer_cases c where c.report_id = p_report
    union all select 'inspection', i.id from public.inspections i join public.officer_cases c on c.id = i.case_id where c.report_id = p_report
    union all select 'evidence', e.id from public.officer_evidence e join public.officer_cases c on c.id = e.case_id where c.report_id = p_report
    union all select 'outcome', o.case_id from public.enforcement_outcomes o join public.officer_cases c on c.id = o.case_id where c.report_id = p_report
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'created_at', a.created_at, 'actor_role', a.actor_role, 'source', a.source,
    'actor_label', case when a.actor_role = 'CITIZEN' and a.actor_user_id is not null then public.pw_citizen_ref(a.actor_user_id)
                        when a.actor_role = 'SYSTEM' then 'ParkWatch'
                        else coalesce(public.pw_console_member_name(a.actor_user_id), initcap(a.actor_role::text)) end,
    'entity_type', a.entity_type, 'event_type', a.event_type, 'metadata', public.pw_console_audit_view(a.metadata)
  ) order by a.created_at, a.id), '[]'::jsonb)
  from public.audit_events a join ents on ents.t = a.entity_type and ents.id = a.entity_id;
$$;

create or replace function public.admin_page_audit(
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
    union all select 'outcome', o.case_id, sr.public_report_number from public.enforcement_outcomes o join public.officer_cases c on c.id = o.case_id join sr on sr.id = c.report_id
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
      'entity_type', p.entity_type, 'event_type', p.event_type, 'public_report_number', p.num, 'metadata', public.pw_console_audit_view(p.metadata)
    ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Reads: attention + assignment version in the console

create or replace function public.admin_overview(p_time_zone text default 'UTC') returns jsonb
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
    'cases_needing_attention', (select count(*) from c where public.pw_needs_attention(c.status,
        public.pw_case_status_since(c.status, c.created_at, c.assigned_at, c.en_route_at, c.on_site_at, c.inspection_started_at))),
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

-- New optional filter p_attention (signature change: drop + recreate).
drop function public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer);

create function public.admin_page_cases(
  p_status public.case_status default null,
  p_officer uuid default null,
  p_outcome public.enforcement_outcome_code default null,
  p_priority public.report_priority default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 25,
  p_attention boolean default null
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
  with base as (
    select c.*, r.public_report_number, r.plate_raw, r.violation_type, r.location_address, o.code outcome_code, o.decided_at,
           o.parking_charge_amount_cents,
           public.pw_case_status_since(c.status, c.created_at, c.assigned_at, c.en_route_at, c.on_site_at, c.inspection_started_at) status_since
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
  ), f as (
    select base.*, public.pw_needs_attention(base.status, base.status_since) needs_attention from base
  ), g as (
    select * from f where p_attention is null or f.needs_attention = p_attention
  ), page as (
    select * from g order by g.created_at desc, g.id desc offset off limit lim
  )
  select jsonb_build_object(
    'total', (select count(*) from g),
    'next_offset', case when (select count(*) from g) > off + lim then off + lim end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'public_report_number', p.public_report_number, 'status', p.status, 'priority', p.priority,
      'assigned_officer_id', p.assigned_officer_id, 'assigned_officer_name', public.pw_console_member_name(p.assigned_officer_id),
      'location_address', p.location_address, 'plate_raw', p.plate_raw, 'violation_type', p.violation_type,
      'created_at', p.created_at, 'assigned_at', p.assigned_at, 'inspection_started_at', p.inspection_started_at, 'completed_at', p.completed_at,
      'outcome_code', p.outcome_code, 'decided_at', p.decided_at,
      'parking_charge_amount_cents', case when p.outcome_code = 'CHARGE_ISSUED' then p.parking_charge_amount_cents end,
      'status_since', case when p.status <> 'COMPLETED' then p.status_since end,
      'needs_attention', p.needs_attention
    ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.admin_get_case(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.officer_cases;
  r public.reports;
  i public.inspections;
  since timestamptz;
begin
  perform public.pw_require_console();
  select * into c from public.officer_cases x where x.id = p_case_id and x.jurisdiction_id in (select public.pw_console_jurisdiction_ids());
  if not found then return null; end if;
  select * into r from public.reports x where x.id = c.report_id;
  select * into i from public.inspections x where x.case_id = c.id;
  since := public.pw_case_status_since(c.status, c.created_at, c.assigned_at, c.en_route_at, c.on_site_at, c.inspection_started_at);
  return jsonb_build_object(
    'case', jsonb_build_object(
      'id', c.id, 'status', c.status, 'priority', c.priority, 'assigned_officer_name', public.pw_console_member_name(c.assigned_officer_id),
      'assigned_officer_id', c.assigned_officer_id, 'assignment_version', c.assignment_version,
      'status_since', since, 'needs_attention', public.pw_needs_attention(c.status, since),
      'attention_minutes', public.pw_attention_minutes(c.status),
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
-- Assignment

-- Is p_officer an active OFFICER of the organization that owns this jurisdiction?
create function public.pw_is_assignable_officer(p_jurisdiction text, p_officer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jurisdictions j
    join public.organization_members m on m.organization_id = j.organization_id
    join public.profiles p on p.id = m.user_id
    where j.id = p_jurisdiction and m.user_id = p_officer and m.active and m.member_role = 'OFFICER' and p.role = 'OFFICER'
  );
$$;

-- The caller's console role for audit rows (SUPERVISOR / ADMIN).
create function public.pw_console_actor_role() returns public.actor_role
language sql stable security definer set search_path = '' as $$
  select p.role::text::public.actor_role from public.profiles p where p.id = auth.uid();
$$;

-- Lock a case inside the caller's console scope (out of scope == missing).
create function public.pw_lock_case_for_console(p_case uuid) returns public.officer_cases
language plpgsql security definer set search_path = '' as $$
declare c public.officer_cases;
begin
  perform public.pw_require_console();
  select * into c from public.officer_cases x
  where x.id = p_case and x.jurisdiction_id in (select public.pw_console_jurisdiction_ids())
  for update;
  if not found then perform public.pw_fail('NOT_FOUND', 'Case not found.'); end if;
  return c;
end $$;

-- Officers a supervisor may assign this case to (active OFFICERs of its organization).
create function public.admin_list_assignable_officers(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.officer_cases;
  org uuid;
begin
  perform public.pw_require_console();
  select * into c from public.officer_cases x where x.id = p_case_id and x.jurisdiction_id in (select public.pw_console_jurisdiction_ids());
  if not found then return null; end if;
  select j.organization_id into org from public.jurisdictions j where j.id = c.jurisdiction_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', nullif(p.display_name, ''),
      'active_cases', (select count(*) from public.officer_cases x
                       where x.assigned_officer_id = m.user_id and x.status <> 'COMPLETED'
                         and x.jurisdiction_id in (select j.id from public.jurisdictions j where j.organization_id = org)),
      'is_current', m.user_id is not distinct from c.assigned_officer_id
    ) order by p.display_name, m.user_id)
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = org and m.active and m.member_role = 'OFFICER' and p.role = 'OFFICER'
  ), '[]'::jsonb);
end $$;

-- Assign (NEW) or reassign (ASSIGNED, not started) to p_officer_id.
create function public.admin_assign_case(p_case_id uuid, p_officer_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  c public.officer_cases := public.pw_lock_case_for_console(p_case_id);
  prev uuid;
  ver integer;
begin
  if p_officer_id is null or p_expected_version is null then perform public.pw_fail('INVALID_INPUT', 'Officer and version are required.'); end if;
  -- The same request already succeeded (lost response, double click): nothing more happens.
  if c.status = 'ASSIGNED' and c.assigned_officer_id = p_officer_id and c.assignment_version = p_expected_version + 1 then
    return jsonb_build_object('changed', false, 'assignment_version', c.assignment_version);
  end if;
  if c.status = 'COMPLETED' then perform public.pw_fail('ALREADY_COMPLETED', 'This case is already completed.'); end if;
  if c.assignment_version <> p_expected_version then
    perform public.pw_fail('STALE_ASSIGNMENT', 'The case changed since it was loaded. Reload and try again.');
  end if;
  if c.status not in ('NEW', 'ASSIGNED') then
    perform public.pw_fail('NOT_ASSIGNABLE', 'The officer has already started this case.');
  end if;
  if c.assigned_officer_id = p_officer_id then
    return jsonb_build_object('changed', false, 'assignment_version', c.assignment_version);
  end if;
  if not public.pw_is_assignable_officer(c.jurisdiction_id, p_officer_id) then
    perform public.pw_fail('INVALID_OFFICER', 'Choose an active officer of this organization.');
  end if;

  prev := c.assigned_officer_id;
  ver := c.assignment_version + 1;
  update public.officer_cases
    set status = 'ASSIGNED', assigned_officer_id = p_officer_id, assigned_at = now(), assignment_version = ver
    where id = c.id;

  -- New officer: in-app + push (push via the outbox trigger). Previous officer: in-app only.
  insert into public.notifications (recipient_id, recipient_role, type, report_id, case_id, idempotency_key)
  values (p_officer_id, 'OFFICER', 'CASE_ASSIGNED', c.report_id, c.id, 'CASE_ASSIGNED:' || c.id || ':' || ver)
  on conflict (idempotency_key) do nothing;
  if prev is not null then
    insert into public.notifications (recipient_id, recipient_role, type, report_id, case_id, idempotency_key)
    values (prev, 'OFFICER', 'CASE_ASSIGNMENT_REMOVED', c.report_id, c.id, 'CASE_ASSIGNMENT_REMOVED:' || c.id || ':' || ver)
    on conflict (idempotency_key) do nothing;
  end if;

  perform public.pw_audit(me, public.pw_console_actor_role(), 'officer_case', c.id,
    case when prev is null then 'CASE_ASSIGNED' else 'CASE_REASSIGNED' end,
    jsonb_strip_nulls(jsonb_build_object('from', c.status::text, 'to', 'ASSIGNED', 'from_officer', prev, 'to_officer', p_officer_id)));
  return jsonb_build_object('changed', true, 'assignment_version', ver);
end $$;

-- Return an ASSIGNED (not started) case to the queue: ASSIGNED -> NEW.
create function public.admin_unassign_case(p_case_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  c public.officer_cases := public.pw_lock_case_for_console(p_case_id);
  prev uuid;
  ver integer;
begin
  if p_expected_version is null then perform public.pw_fail('INVALID_INPUT', 'Version is required.'); end if;
  if c.status = 'NEW' and c.assigned_officer_id is null and c.assignment_version in (p_expected_version, p_expected_version + 1) then
    return jsonb_build_object('changed', false, 'assignment_version', c.assignment_version);
  end if;
  if c.status = 'COMPLETED' then perform public.pw_fail('ALREADY_COMPLETED', 'This case is already completed.'); end if;
  if c.assignment_version <> p_expected_version then
    perform public.pw_fail('STALE_ASSIGNMENT', 'The case changed since it was loaded. Reload and try again.');
  end if;
  if c.status <> 'ASSIGNED' then
    perform public.pw_fail('NOT_ASSIGNABLE', 'Only an assigned case that has not been started can return to the queue.');
  end if;

  prev := c.assigned_officer_id;
  ver := c.assignment_version + 1;
  update public.officer_cases
    set status = 'NEW', assigned_officer_id = null, assigned_at = null, assignment_version = ver
    where id = c.id;
  insert into public.notifications (recipient_id, recipient_role, type, report_id, case_id, idempotency_key)
  values (prev, 'OFFICER', 'CASE_ASSIGNMENT_REMOVED', c.report_id, c.id, 'CASE_ASSIGNMENT_REMOVED:' || c.id || ':' || ver)
  on conflict (idempotency_key) do nothing;
  perform public.pw_audit(me, public.pw_console_actor_role(), 'officer_case', c.id, 'CASE_UNASSIGNED',
    jsonb_build_object('from', 'ASSIGNED', 'to', 'NEW', 'from_officer', prev));
  return jsonb_build_object('changed', true, 'assignment_version', ver);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges

revoke all on function
  public.pw_case_status_since(public.case_status, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz),
  public.pw_attention_minutes(public.case_status), public.pw_needs_attention(public.case_status, timestamptz),
  public.pw_console_audit_view(jsonb), public.pw_is_assignable_officer(text, uuid), public.pw_console_actor_role(),
  public.pw_lock_case_for_console(uuid)
from public, anon, authenticated;

revoke all on function
  public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer, boolean),
  public.admin_list_assignable_officers(uuid), public.admin_assign_case(uuid, uuid, integer), public.admin_unassign_case(uuid, integer)
from public, anon;
grant execute on function
  public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer, boolean),
  public.admin_list_assignable_officers(uuid), public.admin_assign_case(uuid, uuid, integer), public.admin_unassign_case(uuid, integer)
to authenticated;
