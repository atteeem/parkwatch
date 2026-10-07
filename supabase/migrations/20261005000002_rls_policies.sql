-- ParkWatch backend foundation (T8.1): Row Level Security and privileges.
--
-- Model:
-- * Deny by default. RLS is enabled on every table; anything without a
--   policy is invisible/unwritable for the anon and authenticated roles.
-- * Citizens see only their own profile, reports, evidence, rewards and
--   notifications, and may create reports owned by themselves.
-- * Officers are NOT trusted because a client says so (profiles.role is not
--   used for access). Officer read access comes only from an ACTIVE row in
--   organization_members for the organization that owns the jurisdiction.
--   That table is writable only by the service role (admin tooling).
-- * No client writes to cases, inspections, officer evidence, outcomes,
--   ledger or audit events. Those changes must go through server-side
--   functions that apply the domain rules (T8.2+). Until then, deny.
-- * The service role (server only, never in the app) bypasses RLS.

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing for client roles, then grant the minimum.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

grant select on
  public.profiles, public.organizations, public.jurisdictions, public.organization_members,
  public.reports, public.report_evidence, public.officer_cases, public.inspections,
  public.inspection_checks, public.officer_evidence, public.enforcement_outcomes,
  public.reward_ledger, public.reward_balances, public.notifications
to authenticated;

-- Citizens create reports. Column list excludes server-owned fields: id,
-- public_report_number, status, priority, received_at (trusted receipt
-- time), resolved_at, incident_id, timestamps.
grant insert (
  citizen_id, source_draft_id, jurisdiction_id, violation_type,
  plate_raw, plate_normalized, plate_country, vehicle_make, vehicle_model, vehicle_color, vehicle_source,
  location_address, latitude, longitude, location_accuracy_m, location_captured_at,
  notes, observed_at, submitted_at
) on public.reports to authenticated;
grant usage on sequence public.report_number_seq to authenticated;

grant insert (report_id, slot, capture_source, storage_path, captured_at) on public.report_evidence to authenticated;

-- Only these columns are ever client-editable.
grant update (display_name) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Authorization helpers (server-controlled membership; never client input)

-- Is the current user an ACTIVE officer/supervisor of the organization that
-- owns this jurisdiction?
create function public.is_enforcement_member_for(jurisdiction text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.jurisdictions j
    join public.organization_members m on m.organization_id = j.organization_id
    where j.id = jurisdiction
      and m.user_id = auth.uid()
      and m.active
      and m.member_role in ('OFFICER', 'SUPERVISOR')
  );
$$;

-- Can the current user (as an enforcement member) see this case?
create function public.can_access_case(target_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.officer_cases c
    where c.id = target_case and public.is_enforcement_member_for(c.jurisdiction_id)
  );
$$;

grant execute on function public.is_enforcement_member_for(text) to authenticated;
grant execute on function public.can_access_case(uuid) to authenticated;

-- New auth users get a CITIZEN profile. Officer status is never self-assigned.
create function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, display_name) values (new.id, 'CITIZEN', '');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.jurisdictions enable row level security;
alter table public.organization_members enable row level security;
alter table public.reports enable row level security;
alter table public.report_evidence enable row level security;
alter table public.officer_cases enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_checks enable row level security;
alter table public.officer_evidence enable row level security;
alter table public.enforcement_outcomes enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Profiles and organizations

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Organization/jurisdiction names are needed to submit and route reports.
create policy organizations_select_signed_in on public.organizations
  for select to authenticated using (auth.uid() is not null);
create policy jurisdictions_select_signed_in on public.jurisdictions
  for select to authenticated using (auth.uid() is not null);

create policy organization_members_select_own on public.organization_members
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reports and citizen evidence

create policy reports_select_own on public.reports
  for select to authenticated using (citizen_id = auth.uid());
create policy reports_select_enforcement on public.reports
  for select to authenticated using (public.is_enforcement_member_for(jurisdiction_id));
create policy reports_insert_own on public.reports
  for insert to authenticated with check (citizen_id = auth.uid());

create policy report_evidence_select_own on public.report_evidence
  for select to authenticated using (
    exists (select 1 from public.reports r where r.id = report_id and r.citizen_id = auth.uid())
  );
create policy report_evidence_select_enforcement on public.report_evidence
  for select to authenticated using (
    exists (select 1 from public.reports r where r.id = report_id and public.is_enforcement_member_for(r.jurisdiction_id))
  );
create policy report_evidence_insert_own on public.report_evidence
  for insert to authenticated with check (
    exists (select 1 from public.reports r where r.id = report_id and r.citizen_id = auth.uid() and r.status = 'UNDER_REVIEW')
  );

-- ---------------------------------------------------------------------------
-- Enforcement side: readable by members of the owning organization only.
-- Citizens never see cases, inspections, officer evidence or outcomes
-- directly (their report status carries the result). No client writes.

create policy officer_cases_select_enforcement on public.officer_cases
  for select to authenticated using (public.is_enforcement_member_for(jurisdiction_id));
create policy inspections_select_enforcement on public.inspections
  for select to authenticated using (public.can_access_case(case_id));
create policy inspection_checks_select_enforcement on public.inspection_checks
  for select to authenticated using (
    exists (select 1 from public.inspections i where i.id = inspection_id and public.can_access_case(i.case_id))
  );
create policy officer_evidence_select_enforcement on public.officer_evidence
  for select to authenticated using (public.can_access_case(case_id));
create policy enforcement_outcomes_select_enforcement on public.enforcement_outcomes
  for select to authenticated using (public.can_access_case(case_id));

-- ---------------------------------------------------------------------------
-- Rewards and notifications

create policy reward_ledger_select_own on public.reward_ledger
  for select to authenticated using (citizen_id = auth.uid());

create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid());
create policy notifications_mark_read_own on public.notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- audit_events: RLS on, no policies -> no client access at all (read access for
-- supervisors/admins comes with the admin milestone).
