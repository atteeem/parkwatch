-- ============================================================================
-- T9.2 ROLLBACK / RECOVERY (DEVELOPMENT project). NOT a migration and NOT run
-- automatically. Run only on explicit approval, e.g.:
--   npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f supabase/rollback/20261014_t92_rollback.sql
--
-- Reverses the reversible parts of:
--   20261014000003_t92_case_assignment.sql   (assignment RPCs, attention, console reads)
--   20261014000002_t92_push_notifications.sql (push tables, trigger, push RPCs)
-- and removes the three T9.2 rows from supabase_migrations.schema_migrations.
--
-- NOT reversed (deliberately):
--   * notification_type values CASE_ASSIGNED and CASE_ASSIGNMENT_REMOVED
--     (20261014000001). PostgreSQL cannot drop an enum value without rebuilding
--     the type and every dependent column/function. They are effectively
--     irreversible but harmless: nothing creates them once migration 3 is gone.
--     Existing notification rows of these types stay (the T9.2 app shows them;
--     an older app build would show them without copy). If they must go, delete
--     them explicitly and separately after review:
--       delete from public.notifications where type::text in ('CASE_ASSIGNED', 'CASE_ASSIGNMENT_REMOVED');
--   * audit_events rows (append-only by design): CASE_ASSIGNED / CASE_REASSIGNED /
--     CASE_UNASSIGNED history remains.
--   * Case state: cases a supervisor assigned stay ASSIGNED to that officer (a
--     valid T9.0 state: the officer can Start Route / accept). Cases returned to
--     the queue stay NEW.
--   * Push data (tokens, outbox, tickets) is DELETED with its tables.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 3. Case assignment + attention

drop function if exists public.admin_assign_case(uuid, uuid, integer);
drop function if exists public.admin_unassign_case(uuid, integer);
drop function if exists public.admin_list_assignable_officers(uuid);
drop function if exists public.pw_lock_case_for_console(uuid);
drop function if exists public.pw_console_actor_role();
drop function if exists public.pw_is_assignable_officer(text, uuid);

-- Console reads: back to the T9.0 definitions (verbatim from 20261011000001_admin_console.sql).
drop function if exists public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer, boolean);

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

create or replace function public.admin_get_case(p_case_id uuid) returns jsonb
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
    'entity_type', a.entity_type, 'event_type', a.event_type, 'metadata', public.pw_console_audit_metadata(a.metadata)
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
    -- OUTCOME_RECORDED uses the case id as entity id (see complete_case).
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
      'entity_type', p.entity_type, 'event_type', p.event_type, 'public_report_number', p.num, 'metadata', public.pw_console_audit_metadata(p.metadata)
    ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb)
  ) into result;
  return result;
end $$;

drop function if exists public.pw_console_audit_view(jsonb);
drop function if exists public.pw_needs_attention(public.case_status, timestamptz);
drop function if exists public.pw_attention_minutes(public.case_status);
drop function if exists public.pw_case_status_since(public.case_status, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz);

alter table public.app_settings
  drop column if exists attention_new_minutes,
  drop column if exists attention_assigned_minutes,
  drop column if exists attention_en_route_minutes,
  drop column if exists attention_on_site_minutes,
  drop column if exists attention_inspection_minutes;
alter table public.officer_cases drop column if exists assignment_version;

-- Same privileges as T9.0 for the restored console reads.
revoke all on function public.pw_report_audit(uuid) from public, anon, authenticated;
revoke all on function
  public.admin_overview(text), public.admin_get_case(uuid),
  public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer),
  public.admin_page_audit(public.actor_role, text, text, text, timestamptz, timestamptz, integer, integer)
from public, anon;
grant execute on function
  public.admin_overview(text), public.admin_get_case(uuid),
  public.admin_page_cases(public.case_status, uuid, public.enforcement_outcome_code, public.report_priority, timestamptz, timestamptz, text, integer, integer),
  public.admin_page_audit(public.actor_role, text, text, text, timestamptz, timestamptz, integer, integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Push

drop trigger if exists notifications_enqueue_push on public.notifications;
drop function if exists public.pw_enqueue_push();
drop function if exists public.pw_push_eligible(public.notification_type);
drop function if exists public.register_push_device(text, text, text);
drop function if exists public.unregister_push_device(text);
drop function if exists public.push_claim_batch(integer, integer);
drop function if exists public.push_record_result(uuid, jsonb, text);
drop function if exists public.push_pending_receipts(integer);
drop function if exists public.push_record_receipts(jsonb);
drop table if exists public.push_tickets;
drop table if exists public.push_outbox;
drop table if exists public.push_devices;

-- ---------------------------------------------------------------------------
-- Migration history (1 included: its enum values stay, see header)

delete from supabase_migrations.schema_migrations where version in ('20261014000001', '20261014000002', '20261014000003');

commit;
