-- ============================================================================
-- T8.4: paginated, filter-aware reads + server-side summary counts.
--
-- Replaces the capped get_core_snapshot() for list screens:
--   * filtering and ordering happen in SQL BEFORE paging, so "no high priority
--     reports" is never claimed while matching rows exist on a later page;
--   * page size is clamped to 1..50;
--   * counts shown on screens come from the server, not from loaded pages.
--
-- Every function is SECURITY INVOKER: Row Level Security decides what the
-- caller sees, exactly as for direct table reads. No function writes.
-- Responses use the same row keys as get_core_snapshot() so the app merges
-- them with one mapper.
-- ============================================================================

-- Rows needed to show the given reports (citizen or officer view).
create function public.pw_report_bundle(p_report_ids uuid[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'reports', coalesce((select jsonb_agg(to_jsonb(r)) from public.reports r where r.id = any(p_report_ids)), '[]'::jsonb),
    'report_evidence', coalesce((select jsonb_agg(to_jsonb(e)) from public.report_evidence e where e.report_id = any(p_report_ids)), '[]'::jsonb)
  );
$$;

-- Rows needed to show and work on the given cases (officer view).
create function public.pw_case_bundle(p_case_ids uuid[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select public.pw_report_bundle(coalesce((select array_agg(c.report_id) from public.officer_cases c where c.id = any(p_case_ids)), '{}'))
    || jsonb_build_object(
      'cases', coalesce((select jsonb_agg(to_jsonb(c)) from public.officer_cases c where c.id = any(p_case_ids)), '[]'::jsonb),
      'outcomes', coalesce((select jsonb_agg(to_jsonb(o)) from public.enforcement_outcomes o where o.case_id = any(p_case_ids)), '[]'::jsonb),
      'inspections', coalesce((select jsonb_agg(to_jsonb(i)) from public.inspections i where i.case_id = any(p_case_ids)), '[]'::jsonb),
      'inspection_checks', coalesce((select jsonb_agg(to_jsonb(k)) from public.inspection_checks k
                                     join public.inspections i on i.id = k.inspection_id where i.case_id = any(p_case_ids)), '[]'::jsonb),
      'officer_evidence', coalesce((select jsonb_agg(to_jsonb(v)) from public.officer_evidence v where v.case_id = any(p_case_ids)), '[]'::jsonb)
    );
$$;

create function public.pw_page_limit(p_limit integer) returns integer
language sql immutable set search_path = '' as $$ select greatest(1, least(coalesce(p_limit, 25), 50)) $$;

-- ---------------------------------------------------------------------------
-- Citizen

-- My reports, newest first, optionally one status. Keyset cursor (submitted_at, id).
create function public.page_my_reports(
  p_status public.citizen_report_status default null,
  p_before_ts timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  lim integer := public.pw_page_limit(p_limit);
  ids uuid[];
  last_row record;
  more boolean;
begin
  select array_agg(x.id order by x.submitted_at desc, x.id desc) into ids from (
    select r.id, r.submitted_at from public.reports r
    where r.citizen_id = auth.uid()
      and (p_status is null or r.status = p_status)
      and (p_before_ts is null or (r.submitted_at, r.id) < (p_before_ts, p_before_id))
    order by r.submitted_at desc, r.id desc
    limit lim + 1
  ) x;
  ids := coalesce(ids, '{}');
  more := array_length(ids, 1) > lim;
  if more then ids := ids[1:lim]; end if;
  select r.submitted_at, r.id into last_row from public.reports r where r.id = ids[array_length(ids, 1)];
  return public.pw_report_bundle(ids) || jsonb_build_object(
    'ids', to_jsonb(ids),
    'next_cursor', case when more then jsonb_build_object('ts', last_row.submitted_at, 'id', last_row.id) else null end
  );
end;
$$;

-- One of my reports by its public number (deep links, report details).
create function public.get_my_report(p_public_number bigint) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select public.pw_report_bundle(coalesce(
    (select array_agg(r.id) from public.reports r where r.public_report_number = p_public_number and r.citizen_id = auth.uid()), '{}'));
$$;

-- Counts for the citizen's screens (all time and since p_since).
create function public.get_citizen_summary(p_since timestamptz default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'under_review', count(*) filter (where r.status = 'UNDER_REVIEW'),
    'verified', count(*) filter (where r.status = 'VERIFIED'),
    'rejected', count(*) filter (where r.status = 'REJECTED'),
    'since_total', count(*) filter (where p_since is not null and r.submitted_at >= p_since),
    'since_verified', count(*) filter (where p_since is not null and r.submitted_at >= p_since and r.status = 'VERIFIED'),
    'since_rejected', count(*) filter (where p_since is not null and r.submitted_at >= p_since and r.status = 'REJECTED'),
    'unread_notifications', (select count(*) from public.notifications n where n.recipient_id = auth.uid() and n.read_at is null)
  )
  from public.reports r where r.citizen_id = auth.uid();
$$;

-- The citizen's own reward ledger (wallet + earnings). Ledger rows are few per report.
create function public.get_my_ledger() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at), '[]'::jsonb) from public.reward_ledger l where l.citizen_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Notifications (both roles): newest first, keyset cursor (created_at, id).

create function public.page_my_notifications(
  p_before_ts timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  lim integer := public.pw_page_limit(p_limit);
  rows_ jsonb;
  ids uuid[];
  last_row record;
  more boolean;
  report_ids uuid[];
  case_ids uuid[];
begin
  select array_agg(x.id order by x.created_at desc, x.id desc) into ids from (
    select n.id, n.created_at from public.notifications n
    where n.recipient_id = auth.uid()
      and (p_before_ts is null or (n.created_at, n.id) < (p_before_ts, p_before_id))
    order by n.created_at desc, n.id desc
    limit lim + 1
  ) x;
  ids := coalesce(ids, '{}');
  more := array_length(ids, 1) > lim;
  if more then ids := ids[1:lim]; end if;
  select n.created_at, n.id into last_row from public.notifications n where n.id = ids[array_length(ids, 1)];
  select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb), array_agg(distinct n.report_id) filter (where n.report_id is not null),
         array_agg(distinct n.case_id) filter (where n.case_id is not null)
    into rows_, report_ids, case_ids
  from public.notifications n where n.id = any(ids);
  -- Referenced reports/cases (as far as RLS allows) so texts can show report numbers.
  return public.pw_report_bundle(coalesce(report_ids, '{}'))
    || jsonb_build_object(
      'cases', coalesce((select jsonb_agg(to_jsonb(c)) from public.officer_cases c where c.id = any(coalesce(case_ids, '{}'))), '[]'::jsonb),
      'outcomes', coalesce((select jsonb_agg(to_jsonb(o)) from public.enforcement_outcomes o where o.case_id = any(coalesce(case_ids, '{}'))), '[]'::jsonb),
      'notifications', rows_,
      'ids', to_jsonb(ids),
      'next_cursor', case when more then jsonb_build_object('ts', last_row.created_at, 'id', last_row.id) else null end
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Officer

-- Open cases the officer may see, filtered BEFORE paging.
--   p_filter: 'all' | 'new' | 'high' | 'assigned' (same meaning as the app's queue tabs)
-- Order: nearest first when a position is given (cases without coordinates
-- last), else priority, newest report, id. Offset paging (distance order has
-- no stable keyset); the app de-duplicates rows across pages.
create function public.page_officer_queue(
  p_filter text default 'all',
  p_lat double precision default null,
  p_lng double precision default null,
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  lim integer := public.pw_page_limit(p_limit);
  off integer := greatest(0, coalesce(p_offset, 0));
  ids uuid[];
  more boolean;
begin
  if coalesce(p_filter, 'all') not in ('all', 'new', 'high', 'assigned') then
    raise exception 'INVALID_DATA: Unknown filter.' using errcode = 'P0001';
  end if;
  select array_agg(x.id order by x.ord) into ids from (
    select c.id, row_number() over (order by
        case when p_lat is null or r.latitude is null then 1 else 0 end,
        case when p_lat is null or r.latitude is null then null else
          2 * 6371000 * asin(sqrt(power(sin(radians(r.latitude - p_lat) / 2), 2)
            + cos(radians(p_lat)) * cos(radians(r.latitude)) * power(sin(radians(r.longitude - p_lng) / 2), 2))) end,
        case c.priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,
        r.submitted_at desc, c.id) as ord
    from public.officer_cases c join public.reports r on r.id = c.report_id
    where c.status <> 'COMPLETED'
      and case coalesce(p_filter, 'all')
            when 'new' then c.status = 'NEW'
            when 'high' then c.priority = 'HIGH'
            when 'assigned' then c.assigned_officer_id = auth.uid()
            else true end
    order by ord
    offset off limit lim + 1
  ) x;
  ids := coalesce(ids, '{}');
  more := array_length(ids, 1) > lim;
  if more then ids := ids[1:lim]; end if;
  return public.pw_case_bundle(ids) || jsonb_build_object(
    'ids', to_jsonb(ids),
    'next_offset', case when more then off + lim else null end
  );
end;
$$;

-- Cases this officer handled (assigned to them or decided by them).
--   p_tab: 'all' | 'completed' | 'issued' | 'rejected'
-- Newest first by (completed_at, else report time); keyset cursor (sort_ts, id).
create function public.page_my_cases(
  p_tab text default 'all',
  p_before_ts timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  lim integer := public.pw_page_limit(p_limit);
  ids uuid[];
  last_ts timestamptz;
  more boolean;
begin
  if coalesce(p_tab, 'all') not in ('all', 'completed', 'issued', 'rejected') then
    raise exception 'INVALID_DATA: Unknown tab.' using errcode = 'P0001';
  end if;
  select array_agg(x.id order by x.sort_ts desc, x.id desc) into ids from (
    select c.id, coalesce(c.completed_at, r.submitted_at) as sort_ts
    from public.officer_cases c
    join public.reports r on r.id = c.report_id
    left join public.enforcement_outcomes o on o.case_id = c.id
    where (c.assigned_officer_id = auth.uid() or o.decided_by = auth.uid())
      and case coalesce(p_tab, 'all')
            when 'completed' then c.status = 'COMPLETED'
            when 'issued' then o.code = 'CHARGE_ISSUED'
            when 'rejected' then o.code = 'REPORT_REJECTED'
            else true end
      and (p_before_ts is null or (coalesce(c.completed_at, r.submitted_at), c.id) < (p_before_ts, p_before_id))
    order by sort_ts desc, c.id desc
    limit lim + 1
  ) x;
  ids := coalesce(ids, '{}');
  more := array_length(ids, 1) > lim;
  if more then ids := ids[1:lim]; end if;
  select coalesce(c.completed_at, r.submitted_at) into last_ts
    from public.officer_cases c join public.reports r on r.id = c.report_id where c.id = ids[array_length(ids, 1)];
  return public.pw_case_bundle(ids) || jsonb_build_object(
    'ids', to_jsonb(ids),
    'next_cursor', case when more then jsonb_build_object('ts', last_ts, 'id', ids[array_length(ids, 1)]) else null end
  );
end;
$$;

-- Everything needed for one case's screens (details, route, inspection, result).
create function public.get_case_detail(p_case_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select public.pw_case_bundle(array[p_case_id]) $$;

-- Counts for the officer's screens (all visible open cases; this officer's cases).
create function public.get_officer_summary(p_since timestamptz default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with open_cases as (
    select c.* from public.officer_cases c where c.status <> 'COMPLETED'
  ), mine as (
    select c.status, c.completed_at, o.code from public.officer_cases c
    left join public.enforcement_outcomes o on o.case_id = c.id
    where c.assigned_officer_id = auth.uid() or o.decided_by = auth.uid()
  )
  select jsonb_build_object(
    'open', (select count(*) from open_cases),
    'new', (select count(*) from open_cases where status = 'NEW'),
    'high_new', (select count(*) from open_cases where status = 'NEW' and priority = 'HIGH'),
    'high_open', (select count(*) from open_cases where priority = 'HIGH'),
    'assigned_to_me', (select count(*) from open_cases where assigned_officer_id = auth.uid()),
    'mine_total', (select count(*) from mine),
    'mine_completed', (select count(*) from mine where status = 'COMPLETED'),
    'mine_issued', (select count(*) from mine where code = 'CHARGE_ISSUED'),
    'mine_rejected', (select count(*) from mine where code = 'REPORT_REJECTED'),
    'since_completed', (select count(*) from mine where p_since is not null and completed_at >= p_since),
    'since_issued', (select count(*) from mine where p_since is not null and completed_at >= p_since and code = 'CHARGE_ISSUED'),
    'since_rejected', (select count(*) from mine where p_since is not null and completed_at >= p_since and code = 'REPORT_REJECTED'),
    'unread_notifications', (select count(*) from public.notifications n where n.recipient_id = auth.uid() and n.read_at is null)
  );
$$;

-- ---------------------------------------------------------------------------
-- Privileges

revoke all on function public.pw_report_bundle(uuid[]), public.pw_case_bundle(uuid[]), public.pw_page_limit(integer) from public, anon;
grant execute on function public.pw_report_bundle(uuid[]), public.pw_case_bundle(uuid[]), public.pw_page_limit(integer) to authenticated;

revoke all on function
  public.page_my_reports(public.citizen_report_status, timestamptz, uuid, integer),
  public.get_my_report(bigint),
  public.get_citizen_summary(timestamptz),
  public.get_my_ledger(),
  public.page_my_notifications(timestamptz, uuid, integer),
  public.page_officer_queue(text, double precision, double precision, integer, integer),
  public.page_my_cases(text, timestamptz, uuid, integer),
  public.get_case_detail(uuid),
  public.get_officer_summary(timestamptz)
from public, anon;

grant execute on function
  public.page_my_reports(public.citizen_report_status, timestamptz, uuid, integer),
  public.get_my_report(bigint),
  public.get_citizen_summary(timestamptz),
  public.get_my_ledger(),
  public.page_my_notifications(timestamptz, uuid, integer),
  public.page_officer_queue(text, double precision, double precision, integer, integer),
  public.page_my_cases(text, timestamptz, uuid, integer),
  public.get_case_detail(uuid),
  public.get_officer_summary(timestamptz)
to authenticated;

-- Development note: reports are routed to app_settings.default_jurisdiction_id
-- (one configured area, set by the ParkWatch team on the server; citizens never
-- choose an organization). Geographic routing replaces this later.
comment on column public.app_settings.default_jurisdiction_id is
  'DEVELOPMENT routing: every new report goes to this jurisdiction until geographic routing exists. Server-controlled only.';
