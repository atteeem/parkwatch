-- ============================================================================
-- T8.7: officer Monthly Statistics, computed on the server.
--
-- get_officer_monthly_stats(from, to, time_zone): counts of the enforcement
-- outcomes the SIGNED-IN officer decided in [from, to), plus a per-day
-- breakdown in the officer's time zone. Only data the server records:
-- outcome code and decision time. No response times, distances, money
-- collected or scores.
--
-- SECURITY INVOKER: Row Level Security still applies (enforcement_outcomes
-- is visible only to active enforcement members), and the query is limited
-- to decided_by = auth.uid(), so an officer only ever sees their own numbers.
-- A deactivated officer sees zeros (same rule as every other officer read).
-- ============================================================================

create function public.get_officer_monthly_stats(p_from timestamptz, p_to timestamptz, p_time_zone text default 'UTC')
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  me uuid := auth.uid();
  tz text := coalesce(nullif(btrim(p_time_zone), ''), 'UTC');
  result jsonb;
begin
  if me is null then
    raise exception 'UNAUTHENTICATED: Sign in required.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = me and p.role in ('OFFICER', 'SUPERVISOR')) then
    raise exception 'FORBIDDEN: Officer statistics are for enforcement accounts.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'INVALID_INPUT: Invalid period.' using errcode = 'P0001';
  end if;
  begin
    perform now() at time zone tz;
  exception when others then
    tz := 'UTC'; -- unknown zone name: fall back instead of failing the screen
  end;

  with mine as (
    select o.code, (o.decided_at at time zone tz)::date as day
    from public.enforcement_outcomes o
    where o.decided_by = me and o.decided_at >= p_from and o.decided_at < p_to
  ), per_day as (
    select day,
      count(*) as completed,
      count(*) filter (where code = 'CHARGE_ISSUED') as issued,
      count(*) filter (where code = 'REPORT_REJECTED') as rejected,
      count(*) filter (where code in ('VEHICLE_MOVED', 'VALID_PERMIT', 'DUPLICATE', 'OTHER')) as no_charge
    from mine group by day
  )
  select jsonb_build_object(
    'completed', (select count(*) from mine),
    'issued', (select count(*) from mine where code = 'CHARGE_ISSUED'),
    'rejected', (select count(*) from mine where code = 'REPORT_REJECTED'),
    'no_charge', (select count(*) from mine where code in ('VEHICLE_MOVED', 'VALID_PERMIT', 'DUPLICATE', 'OTHER')),
    'by_code', coalesce((select jsonb_object_agg(code, n) from (select code::text, count(*) as n from mine group by code) c), '{}'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'completed', completed, 'issued', issued,
                       'rejected', rejected, 'no_charge', no_charge) order by day) from per_day), '[]'::jsonb),
    'time_zone', tz
  ) into result;
  return result;
end $$;

revoke all on function public.get_officer_monthly_stats(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.get_officer_monthly_stats(timestamptz, timestamptz, text) to authenticated;
