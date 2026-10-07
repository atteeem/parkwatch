-- ParkWatch backend foundation (T8.1): core reporting / enforcement schema.
--
-- Mirrors the existing domain in src/domain. Business rules (case lifecycle,
-- outcome consequences, reward release, evidence requirements) stay in the
-- domain layer and, after cutover, in server-side functions that call the
-- same rules. The database only enforces structural invariants that must
-- never be violated (ownership, one-per-x uniqueness, idempotency, cents,
-- append-only history, citizen/officer evidence separation).
--
-- Not in this schema (deliberately): simulated parking (local only),
-- payouts, provider integrations, storage buckets (T8.2+).

-- ---------------------------------------------------------------------------
-- Enums (values are the exact domain codes)

create type public.app_role as enum ('CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN');
create type public.actor_role as enum ('CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN', 'SYSTEM');
create type public.event_source as enum ('USER_ACTION', 'SYSTEM', 'SEED', 'INTEGRATION', 'MIGRATION');
create type public.citizen_report_status as enum ('UNDER_REVIEW', 'VERIFIED', 'REJECTED');
create type public.report_priority as enum ('NORMAL', 'MEDIUM', 'HIGH');
create type public.vehicle_info_source as enum ('MOCK_DETECTED', 'OCR_DETECTED', 'CITIZEN_CONFIRMED');
create type public.citizen_evidence_slot as enum ('FRONT', 'SIDE', 'REAR', 'ATTACHMENT');
create type public.officer_evidence_type as enum ('VEHICLE_OVERVIEW', 'LICENSE_PLATE', 'PARKING_SIGN', 'VIOLATION_CONTEXT');
create type public.capture_source as enum ('CAMERA', 'LIBRARY', 'SEED');
-- Domain CaseStatus. ASSIGNED = "accepted by an officer".
create type public.case_status as enum ('NEW', 'ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'INSPECTION', 'COMPLETED');
create type public.inspection_check_key as enum ('vehiclePresent', 'plateMatches', 'violationConfirmed', 'restrictionVerified');
create type public.enforcement_outcome_code as enum ('CHARGE_ISSUED', 'REPORT_REJECTED', 'VEHICLE_MOVED', 'VALID_PERMIT', 'DUPLICATE', 'OTHER');
create type public.reward_entry_type as enum ('OPENING_BALANCE', 'REWARD_PENDING', 'REWARD_RELEASED', 'REWARD_VOIDED', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_PAID');
create type public.notification_type as enum (
  'REPORT_UNDER_REVIEW', 'REPORT_VERIFIED', 'REPORT_REJECTED', 'WITHDRAWAL_REQUESTED',
  'CASE_ACCEPTED', 'PARKING_CHARGE_ISSUED', 'CASE_CLOSED_WITHOUT_CHARGE', 'SYSTEM'
);
create type public.org_member_role as enum ('OFFICER', 'SUPERVISOR', 'ADMIN');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Append-only tables: history is never rewritten, not even by the API.
create function public.reject_modification() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only (% not allowed)', tg_table_name, tg_op using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- Identity, organizations, jurisdictions

-- One profile per auth user. `role` is NOT trusted for officer access: officer
-- powers come only from organization_members, which clients cannot write.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'CITIZEN',
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

-- Minimal enforcement organisation (municipality / operator). No UI yet.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

-- Area of responsibility. Text id matches the domain jurisdictionId ("helsinki-demo").
create table public.jurisdictions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now()
);

-- Server-controlled authorization: who may act as officer/supervisor for which
-- organization. Only the service role (admin tooling) writes this table.
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role public.org_member_role not null,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles (id),
  primary key (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Citizen reports and citizen evidence

create sequence public.report_number_seq start with 100000;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  -- Human-readable number shown to citizens ("#100023"); never the primary key.
  public_report_number bigint not null unique default nextval('public.report_number_seq'),
  citizen_id uuid not null references public.profiles (id) on delete restrict,
  -- Client draft id: resubmitting the same draft must not create a second report.
  source_draft_id text not null check (char_length(source_draft_id) between 1 and 100),
  jurisdiction_id text not null references public.jurisdictions (id),
  status public.citizen_report_status not null default 'UNDER_REVIEW',
  priority public.report_priority not null default 'NORMAL',
  violation_type text not null check (violation_type ~ '^[a-z0-9-]{1,40}$'),
  plate_raw text check (char_length(plate_raw) <= 20),
  plate_normalized text check (plate_normalized ~ '^[A-Z0-9ÅÄÖ]{1,15}$'),
  plate_country text check (plate_country ~ '^[A-Z]{2}$'),
  vehicle_make text check (char_length(vehicle_make) <= 60),
  vehicle_model text check (char_length(vehicle_model) <= 60),
  vehicle_color text check (char_length(vehicle_color) <= 40),
  vehicle_source public.vehicle_info_source,
  location_address text not null check (char_length(location_address) between 1 and 200),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  location_accuracy_m double precision check (location_accuracy_m >= 0),
  location_captured_at timestamptz,
  notes text not null default '' check (char_length(notes) <= 2000),
  -- Device clock (untrusted) vs trusted server receipt time.
  observed_at timestamptz not null,
  submitted_at timestamptz not null,
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  incident_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (citizen_id, source_draft_id),
  check ((latitude is null) = (longitude is null)),
  check ((plate_raw is null) = (plate_normalized is null)),
  check ((status = 'UNDER_REVIEW') = (resolved_at is null))
);
create index reports_citizen_idx on public.reports (citizen_id, submitted_at desc);
create index reports_jurisdiction_status_idx on public.reports (jurisdiction_id, status);
create trigger reports_updated_at before update on public.reports for each row execute function public.set_updated_at();

-- Citizen evidence only. Officer evidence lives in officer_evidence: the two
-- can never be mixed up by a missing filter.
create table public.report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  slot public.citizen_evidence_slot not null,
  capture_source public.capture_source not null,
  -- Object path inside the private evidence bucket (T8.2); never a device file:// URI.
  storage_path text not null check (storage_path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$' and storage_path !~ '\.\.'),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Required angles must be real photos taken at the scene (library images are attachments only).
  check (slot = 'ATTACHMENT' or capture_source in ('CAMERA', 'SEED'))
);
-- One photo per required angle per report (attachments may repeat).
create unique index report_evidence_one_per_slot on public.report_evidence (report_id, slot) where slot <> 'ATTACHMENT';

-- ---------------------------------------------------------------------------
-- Officer cases, inspections, officer evidence, outcomes

create table public.officer_cases (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports (id) on delete restrict,
  jurisdiction_id text not null references public.jurisdictions (id),
  status public.case_status not null default 'NEW',
  priority public.report_priority not null default 'NORMAL',
  assigned_officer_id uuid references public.profiles (id),
  -- First time the case entered each status (domain statusTimestamps).
  assigned_at timestamptz,
  en_route_at timestamptz,
  on_site_at timestamptz,
  inspection_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'NEW') or assigned_officer_id is not null or status = 'COMPLETED'),
  check ((status = 'COMPLETED') = (completed_at is not null))
);
create index officer_cases_queue_idx on public.officer_cases (jurisdiction_id, status, created_at desc);
create index officer_cases_officer_idx on public.officer_cases (assigned_officer_id, status);
create trigger officer_cases_updated_at before update on public.officer_cases for each row execute function public.set_updated_at();

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.officer_cases (id) on delete restrict,
  started_at timestamptz not null,
  notes text not null default '' check (char_length(notes) <= 2000),
  -- The officer confirmed the plate with the (simulated, non-OCR) control.
  plate_confirmed_via_scan_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger inspections_updated_at before update on public.inspections for each row execute function public.set_updated_at();

-- Tri-state checklist: answer = true (yes) / false (no) / null (unanswered).
create table public.inspection_checks (
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  check_key public.inspection_check_key not null,
  answer boolean,
  answered_at timestamptz,
  primary key (inspection_id, check_key),
  check ((answer is null) = (answered_at is null))
);

create table public.officer_evidence (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  case_id uuid not null references public.officer_cases (id) on delete cascade,
  evidence_type public.officer_evidence_type not null,
  -- Enforcement evidence is taken on site: never a library image.
  capture_source public.capture_source not null check (capture_source in ('CAMERA', 'SEED')),
  storage_path text not null check (storage_path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$' and storage_path !~ '\.\.'),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- One photo per required slot per inspection (retake replaces).
  unique (inspection_id, evidence_type)
);

-- Exactly one outcome per case, recorded by an officer.
create table public.enforcement_outcomes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.officer_cases (id) on delete restrict,
  inspection_id uuid references public.inspections (id),
  code public.enforcement_outcome_code not null,
  decided_by uuid not null references public.profiles (id),
  decided_at timestamptz not null,
  notes text check (char_length(notes) <= 2000),
  -- A private "parking charge" (not a criminal fine). Only for CHARGE_ISSUED.
  parking_charge_amount_cents integer check (parking_charge_amount_cents > 0),
  created_at timestamptz not null default now(),
  check ((code = 'CHARGE_ISSUED') = (parking_charge_amount_cents is not null))
);
create trigger enforcement_outcomes_append_only before update or delete on public.enforcement_outcomes
  for each row execute function public.reject_modification();

-- ---------------------------------------------------------------------------
-- Reward ledger (append-only; balances are derived, never stored)

create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.profiles (id) on delete restrict,
  entry_type public.reward_entry_type not null,
  amount_cents integer not null check (amount_cents > 0),
  report_id uuid references public.reports (id) on delete restrict,
  withdrawal_id uuid,
  -- One logical operation = one key; replaying it can never credit/debit twice.
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now(),
  check (entry_type not in ('REWARD_PENDING', 'REWARD_RELEASED', 'REWARD_VOIDED') or report_id is not null),
  check (entry_type not in ('WITHDRAWAL_REQUESTED', 'WITHDRAWAL_PAID') or withdrawal_id is not null)
);
-- One reward lifecycle per report: one pending, then at most one release OR void.
create unique index reward_one_pending_per_report on public.reward_ledger (report_id) where entry_type = 'REWARD_PENDING';
create unique index reward_one_resolution_per_report on public.reward_ledger (report_id) where entry_type in ('REWARD_RELEASED', 'REWARD_VOIDED');
-- One request and at most one payment per withdrawal.
create unique index withdrawal_one_request on public.reward_ledger (withdrawal_id) where entry_type = 'WITHDRAWAL_REQUESTED';
create unique index withdrawal_one_payment on public.reward_ledger (withdrawal_id) where entry_type = 'WITHDRAWAL_PAID';
create index reward_ledger_citizen_idx on public.reward_ledger (citizen_id, created_at);
create trigger reward_ledger_append_only before update or delete on public.reward_ledger
  for each row execute function public.reject_modification();

-- Derived balances (same formula as domain calculateBalances). security_invoker:
-- callers only see balances for ledger rows RLS lets them read.
create view public.reward_balances with (security_invoker = true) as
select
  citizen_id,
  coalesce(sum(amount_cents) filter (where entry_type = 'REWARD_PENDING'), 0)
    - coalesce(sum(amount_cents) filter (where entry_type in ('REWARD_RELEASED', 'REWARD_VOIDED')), 0) as pending_cents,
  coalesce(sum(amount_cents) filter (where entry_type in ('OPENING_BALANCE', 'REWARD_RELEASED')), 0)
    - coalesce(sum(amount_cents) filter (where entry_type = 'WITHDRAWAL_REQUESTED'), 0) as available_cents,
  coalesce(sum(amount_cents) filter (where entry_type = 'WITHDRAWAL_PAID'), 0) as paid_out_cents
from public.reward_ledger
group by citizen_id;

-- ---------------------------------------------------------------------------
-- Notifications

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  recipient_role public.app_role not null,
  type public.notification_type not null,
  report_id uuid references public.reports (id) on delete cascade,
  case_id uuid references public.officer_cases (id) on delete cascade,
  amount_cents integer check (amount_cents > 0),
  -- Only SYSTEM notifications carry free text; other types get copy from the app.
  title text check (char_length(title) <= 120),
  body text check (char_length(body) <= 500),
  display_hint text check (char_length(display_hint) <= 20),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (type = 'SYSTEM' or (title is null and body is null))
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit events (append-only)

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_role public.actor_role not null,
  source public.event_source not null,
  entity_type text not null check (entity_type in ('report', 'officer_case', 'inspection', 'evidence', 'outcome', 'reward', 'withdrawal', 'notification', 'profile')),
  entity_id uuid not null,
  event_type text not null check (event_type ~ '^[A-Z][A-Z_]{2,48}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  -- Never secrets or image bytes in audit metadata.
  check (not (metadata ?| array['password', 'secret', 'token', 'access_token', 'refresh_token', 'api_key', 'image', 'image_base64', 'base64', 'bytes']))
);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at);
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function public.reject_modification();

-- TRUNCATE bypasses row triggers; block it too on append-only history.
create function public.reject_truncate() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only (TRUNCATE not allowed)', tg_table_name using errcode = 'P0001';
end $$;
create trigger reward_ledger_no_truncate before truncate on public.reward_ledger for each statement execute function public.reject_truncate();
create trigger audit_events_no_truncate before truncate on public.audit_events for each statement execute function public.reject_truncate();
create trigger enforcement_outcomes_no_truncate before truncate on public.enforcement_outcomes for each statement execute function public.reject_truncate();
