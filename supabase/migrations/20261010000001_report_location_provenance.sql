-- ============================================================================
-- T8.7: report location provenance.
--
-- The citizen can now correct the report point on the map. A corrected point
-- is NOT a GPS fix, so it must not carry the fix's accuracy/capture time:
--
--   latitude/longitude      the report (incident) point officers navigate to
--   location_source         GPS (the point is the device fix) or MAP_SELECTED
--                           (picked on the map; accuracy/captured_at are null)
--
-- Data minimization: after a map correction the citizen's original GPS fix is
-- NOT stored separately; it stays only in the unsent draft on the phone.
--
-- Existing rows: a point already stored came from GPS (the map was not
-- interactive before T8.7), so it is backfilled as GPS; readers treat a point
-- with a null source the same way. No RLS change.
-- ============================================================================

alter table public.reports
  add column location_source text check (location_source in ('GPS', 'MAP_SELECTED'));

update public.reports set location_source = 'GPS' where latitude is not null and location_source is null;

alter table public.reports
  -- No point, no source. (A point with a null source is older data: GPS.)
  add constraint reports_location_source_needs_point check (location_source is null or latitude is not null),
  -- A point picked on the map has no GPS accuracy or capture time of its own.
  add constraint reports_map_point_not_gps check (
    location_source is distinct from 'MAP_SELECTED' or (location_accuracy_m is null and location_captured_at is null)
  );

-- submit_report gains one optional trailing parameter. The old signature is
-- dropped (an overload with defaults would make named-argument calls ambiguous).
drop function public.submit_report(text, text, text, timestamptz, timestamptz, jsonb, text, double precision, double precision, double precision, timestamptz, text, text, text, text, text, text, public.vehicle_info_source);

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
  p_vehicle_source public.vehicle_info_source default null,
  p_location_source text default null
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
    location_address, latitude, longitude, location_accuracy_m, location_captured_at, notes, observed_at, submitted_at,
    location_source
  ) values (
    me, p_submission_id, v_jurisdiction, p_violation_type,
    p_plate_raw, p_plate_normalized, p_plate_country, p_vehicle_make, p_vehicle_model, p_vehicle_color, p_vehicle_source,
    p_location_address, p_latitude, p_longitude, p_location_accuracy_m, p_location_captured_at, coalesce(p_notes, ''), p_observed_at, p_submitted_at,
    -- No point -> no source. A point without a stated source is legacy GPS.
    case when p_latitude is null then null else coalesce(p_location_source, 'GPS') end
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

revoke all on function public.submit_report(text, text, text, timestamptz, timestamptz, jsonb, text, double precision, double precision, double precision, timestamptz, text, text, text, text, text, text, public.vehicle_info_source, text) from public, anon;
grant execute on function public.submit_report(text, text, text, timestamptz, timestamptz, jsonb, text, double precision, double precision, double precision, timestamptz, text, text, text, text, text, text, public.vehicle_info_source, text) to authenticated;
