-- ============================================================================
-- T9.5: citizen reporting moderation (restrictions with a 3-strike rule).
--
-- MODEL: an append-only event log, state derived from it (no cached flags).
--
--   moderation_actions
--     RESTRICTION_ISSUED   one strike; 30 days, or indefinite on the 3rd strike
--                          of the current cycle
--     RESTRICTION_REVOKED  lifts exactly one issued restriction (never deletes it)
--
--   Strike cycles: strikes count inside a moderation cycle. Revoking a
--   temporary restriction does NOT remove its strike. Lifting an indefinite
--   (3rd-strike) restriction closes the cycle: lifetime strikes keep the full
--   history, the next restriction is strike 1 of 3 in the next cycle.
--
--   "Restricted" = an issued restriction that is not revoked and is
--   indefinite or not yet expired. Expiry needs no job: it is the clock.
--
-- WHO: active enforcement members (OFFICER / SUPERVISOR) of the organization
-- that owns the case, or console members (SUPERVISOR / ADMIN) in scope. Staff
-- act FROM A CASE and only ever see the pseudonymous citizen reference. Roles
-- come from the server, never from the client. Only CITIZEN accounts can be
-- restricted (no staff, no self). Internal notes / revoke reasons are staff-only.
--
-- ENFORCEMENT: a BEFORE INSERT trigger on reports (every creation path) and
-- the report-evidence upload policy. Signing in, reading own reports and
-- the moderation status keep working.
-- ============================================================================

create type public.moderation_action_type as enum ('RESTRICTION_ISSUED', 'RESTRICTION_REVOKED');
create type public.moderation_reason as enum ('SPAM_INVALID', 'FALSE_REPORT', 'INAPPROPRIATE_CONTENT', 'HARASSMENT', 'MANIPULATED_EVIDENCE', 'OTHER');

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.profiles (id) on delete restrict,
  action_type public.moderation_action_type not null,
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  actor_role public.actor_role not null check (actor_role in ('OFFICER', 'SUPERVISOR', 'ADMIN')),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  source_case_id uuid references public.officer_cases (id) on delete restrict,
  -- RESTRICTION_ISSUED
  reason public.moderation_reason,
  internal_note text check (internal_note is null or char_length(internal_note) <= 500),
  cycle integer not null check (cycle >= 1),
  strike_in_cycle integer check (strike_in_cycle between 1 and 3),
  lifetime_strike integer check (lifetime_strike >= 1),
  indefinite boolean not null default false,
  expires_at timestamptz,
  -- RESTRICTION_REVOKED
  revokes_action_id uuid references public.moderation_actions (id) on delete restrict,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) between 3 and 500),
  -- idempotency key chosen by the client for one confirmed action
  request_id text not null unique check (request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  created_at timestamptz not null default now(),
  check (citizen_id <> actor_user_id),
  check (
    (action_type = 'RESTRICTION_ISSUED'
      and reason is not null and strike_in_cycle is not null and lifetime_strike is not null
      and revokes_action_id is null and revoke_reason is null
      and ((indefinite and expires_at is null and strike_in_cycle = 3) or (not indefinite and expires_at is not null and strike_in_cycle < 3))
      and (reason <> 'OTHER' or char_length(btrim(coalesce(internal_note, ''))) >= 3))
    or
    (action_type = 'RESTRICTION_REVOKED'
      and revokes_action_id is not null and revoke_reason is not null
      and reason is null and internal_note is null and strike_in_cycle is null and lifetime_strike is null
      and not indefinite and expires_at is null)
  )
);
-- A restriction can be lifted once.
create unique index moderation_actions_one_revocation on public.moderation_actions (revokes_action_id) where revokes_action_id is not null;
create index moderation_actions_citizen on public.moderation_actions (citizen_id, created_at desc);

-- History is never edited or deleted (also not by SECURITY DEFINER code).
create function public.pw_moderation_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: Moderation history cannot be changed or deleted.' using errcode = 'P0001';
end $$;
create trigger moderation_actions_immutable before update or delete on public.moderation_actions
  for each row execute function public.pw_moderation_immutable();

alter table public.moderation_actions enable row level security; -- no policies: read through functions only
revoke all on table public.moderation_actions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Derived state (internal)

-- Current cycle: 1 + number of indefinite restrictions that were lifted.
create function public.pw_moderation_cycle(p_citizen uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select 1 + count(*)::integer
  from public.moderation_actions r
  join public.moderation_actions i on i.id = r.revokes_action_id
  where r.citizen_id = p_citizen and r.action_type = 'RESTRICTION_REVOKED' and i.indefinite;
$$;

-- The restriction in force now (not revoked; indefinite or not expired), if any.
create function public.pw_active_restriction(p_citizen uuid) returns public.moderation_actions
language sql stable security definer set search_path = '' as $$
  select i.* from public.moderation_actions i
  where i.citizen_id = p_citizen and i.action_type = 'RESTRICTION_ISSUED'
    and (i.indefinite or i.expires_at > now())
    and not exists (select 1 from public.moderation_actions r where r.revokes_action_id = i.id)
  order by i.created_at desc
  limit 1;
$$;

create function public.pw_reporting_restricted(p_citizen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (public.pw_active_restriction(p_citizen)).id is not null;
$$;

-- Status as the citizen may see it (no notes, no staff identities).
create function public.pw_moderation_public_state(p_citizen uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.moderation_actions := public.pw_active_restriction(p_citizen);
  cyc integer := public.pw_moderation_cycle(p_citizen);
  strikes integer;
begin
  select count(*) into strikes from public.moderation_actions m
  where m.citizen_id = p_citizen and m.action_type = 'RESTRICTION_ISSUED' and m.cycle = cyc;
  return jsonb_build_object(
    'status', case when a.id is null then 'ACTIVE' when a.indefinite then 'INDEFINITELY_RESTRICTED' else 'TEMPORARILY_RESTRICTED' end,
    'restricted_until', case when a.id is not null and not a.indefinite then a.expires_at end,
    'restricted_since', a.created_at,
    'reason', a.reason,
    'strikes', strikes,
    'max_strikes', 3
  );
end $$;

-- Staff view of one citizen: state, lifetime counts and the full history.
create function public.pw_moderation_staff_state(p_citizen uuid, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.moderation_actions := public.pw_active_restriction(p_citizen);
  cyc integer := public.pw_moderation_cycle(p_citizen);
begin
  return public.pw_moderation_public_state(p_citizen) || jsonb_build_object(
    'citizen_ref', public.pw_citizen_ref(p_citizen),
    'cycle', cyc,
    'lifetime_strikes', (select count(*) from public.moderation_actions m where m.citizen_id = p_citizen and m.action_type = 'RESTRICTION_ISSUED'),
    'active_action_id', a.id,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'type', m.action_type,
        'created_at', m.created_at,
        'actor_role', m.actor_role,
        -- names only for staff of the viewer's organization
        'actor_name', case when m.organization_id = p_org then (select nullif(p.display_name, '') from public.profiles p where p.id = m.actor_user_id) end,
        'same_organization', m.organization_id = p_org,
        'reason', m.reason,
        'internal_note', case when m.organization_id = p_org then m.internal_note end,
        'cycle', m.cycle,
        'strike_in_cycle', m.strike_in_cycle,
        'lifetime_strike', m.lifetime_strike,
        'indefinite', m.indefinite,
        'expires_at', m.expires_at,
        'revokes_action_id', m.revokes_action_id,
        'revoke_reason', case when m.organization_id = p_org then m.revoke_reason end,
        'revoked_at', (select r.created_at from public.moderation_actions r where r.revokes_action_id = m.id)
      ) order by m.created_at desc, m.id)
      from public.moderation_actions m where m.citizen_id = p_citizen
    ), '[]'::jsonb)
  );
end $$;

-- Who is acting, on which citizen, under which organization. Raises unless
-- the caller is staff with authority over the case and the target is a citizen.
create function public.pw_moderation_scope(p_case uuid, out citizen uuid, out org uuid, out actor public.actor_role)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  my_role public.app_role;
  juris text;
  target_role public.app_role;
begin
  select p.role into my_role from public.profiles p where p.id = me;
  if my_role is null or my_role = 'CITIZEN' then perform public.pw_fail('FORBIDDEN', 'Only enforcement staff can moderate reporting.'); end if;
  select r.citizen_id, c.jurisdiction_id into citizen, juris
  from public.officer_cases c join public.reports r on r.id = c.report_id
  where c.id = p_case;
  if not found then perform public.pw_fail('NOT_FOUND', 'Case not found.'); end if;
  if not (public.is_enforcement_member_for(juris) or juris in (select public.pw_console_jurisdiction_ids())) then
    perform public.pw_fail('NOT_FOUND', 'Case not found.'); -- out of scope == missing
  end if;
  select j.organization_id into org from public.jurisdictions j where j.id = juris;
  if citizen = me then perform public.pw_fail('FORBIDDEN', 'You cannot moderate your own account.'); end if;
  select p.role into target_role from public.profiles p where p.id = citizen;
  if target_role is distinct from 'CITIZEN' then perform public.pw_fail('FORBIDDEN', 'Only citizen accounts can be restricted.'); end if;
  -- Acting role = the caller's strongest ACTIVE membership in the case's organization (memberships are the trusted source).
  select m.member_role::text::public.actor_role into actor from public.organization_members m
  where m.organization_id = org and m.user_id = me and m.active
  order by case m.member_role when 'ADMIN' then 1 when 'SUPERVISOR' then 2 else 3 end
  limit 1;
  if actor is null then perform public.pw_fail('NOT_FOUND', 'Case not found.'); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Staff functions

create function public.get_reporter_moderation(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s record;
begin
  select * into s from public.pw_moderation_scope(p_case_id);
  return public.pw_moderation_staff_state(s.citizen, s.org);
end $$;

create function public.restrict_reporter(p_case_id uuid, p_reason text, p_note text, p_request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  s record;
  prior public.moderation_actions;
  v_reason public.moderation_reason;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  cyc integer;
  strikes integer;
  lifetime integer;
  new_id uuid;
  v_indef boolean;
  v_expires timestamptz;
begin
  select * into s from public.pw_moderation_scope(p_case_id);
  if coalesce(p_request_id, '') !~ '^[A-Za-z0-9_-]{8,80}$' then perform public.pw_fail('INVALID_INPUT', 'Invalid request.'); end if;

  -- Retry of the same confirmed action (double tap, refresh, lost response): same result, nothing new.
  select * into prior from public.moderation_actions m where m.request_id = p_request_id;
  if found then
    if prior.action_type <> 'RESTRICTION_ISSUED' or prior.citizen_id <> s.citizen or prior.actor_user_id <> me then
      perform public.pw_fail('INVALID_INPUT', 'Invalid request.');
    end if;
    return jsonb_build_object('changed', false, 'action_id', prior.id) || public.pw_moderation_staff_state(s.citizen, s.org);
  end if;

  begin
    v_reason := p_reason::public.moderation_reason;
  exception when invalid_text_representation then
    perform public.pw_fail('INVALID_INPUT', 'Choose a reason.');
  end;
  if v_reason = 'OTHER' and char_length(coalesce(v_note, '')) < 3 then perform public.pw_fail('INVALID_INPUT', 'Describe the reason in a note.'); end if;
  if char_length(coalesce(v_note, '')) > 500 then perform public.pw_fail('INVALID_INPUT', 'The note is too long.'); end if;

  -- Serialize every moderation write for this citizen (concurrent officers, double taps).
  perform 1 from public.profiles p where p.id = s.citizen for update;
  if public.pw_reporting_restricted(s.citizen) then
    perform public.pw_fail('ALREADY_RESTRICTED', 'Reporting is already restricted for this account.');
  end if;

  cyc := public.pw_moderation_cycle(s.citizen);
  select count(*) filter (where m.cycle = cyc), count(*) into strikes, lifetime
  from public.moderation_actions m where m.citizen_id = s.citizen and m.action_type = 'RESTRICTION_ISSUED';
  strikes := strikes + 1;
  v_indef := strikes >= 3;
  v_expires := case when v_indef then null else now() + interval '30 days' end;

  insert into public.moderation_actions (citizen_id, action_type, actor_user_id, actor_role, organization_id, source_case_id,
    reason, internal_note, cycle, strike_in_cycle, lifetime_strike, indefinite, expires_at, request_id)
  values (s.citizen, 'RESTRICTION_ISSUED', me, s.actor, s.org, p_case_id,
    v_reason, v_note, cyc, strikes, lifetime + 1, v_indef, v_expires, p_request_id)
  returning id into new_id;

  perform public.pw_audit(me, s.actor, 'profile', s.citizen, case when v_indef then 'REPORTING_RESTRICTED_INDEFINITELY' else 'REPORTING_RESTRICTED' end,
    jsonb_build_object('moderation_action_id', new_id, 'case_id', p_case_id, 'reason', v_reason, 'strike_in_cycle', strikes, 'cycle', cyc,
                       'lifetime_strike', lifetime + 1, 'expires_at', v_expires));
  return jsonb_build_object('changed', true, 'action_id', new_id) || public.pw_moderation_staff_state(s.citizen, s.org);
end $$;

create function public.revoke_reporter_restriction(p_case_id uuid, p_action_id uuid, p_reason text, p_request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.pw_require_user();
  s record;
  prior public.moderation_actions;
  target public.moderation_actions;
  v_reason text := btrim(coalesce(p_reason, ''));
  new_id uuid;
begin
  select * into s from public.pw_moderation_scope(p_case_id);
  if coalesce(p_request_id, '') !~ '^[A-Za-z0-9_-]{8,80}$' then perform public.pw_fail('INVALID_INPUT', 'Invalid request.'); end if;

  select * into prior from public.moderation_actions m where m.request_id = p_request_id;
  if found then
    if prior.action_type <> 'RESTRICTION_REVOKED' or prior.citizen_id <> s.citizen or prior.actor_user_id <> me then
      perform public.pw_fail('INVALID_INPUT', 'Invalid request.');
    end if;
    return jsonb_build_object('changed', false, 'action_id', prior.id) || public.pw_moderation_staff_state(s.citizen, s.org);
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then perform public.pw_fail('INVALID_INPUT', 'Give a reason for lifting the restriction.'); end if;

  perform 1 from public.profiles p where p.id = s.citizen for update;
  select * into target from public.moderation_actions m
  where m.id = p_action_id and m.citizen_id = s.citizen and m.action_type = 'RESTRICTION_ISSUED';
  if not found then perform public.pw_fail('NOT_FOUND', 'Restriction not found.'); end if;
  if (public.pw_active_restriction(s.citizen)).id is distinct from target.id then
    perform public.pw_fail('NOT_ACTIVE', 'This restriction is no longer in force.');
  end if;

  insert into public.moderation_actions (citizen_id, action_type, actor_user_id, actor_role, organization_id, source_case_id,
    cycle, revokes_action_id, revoke_reason, request_id)
  values (s.citizen, 'RESTRICTION_REVOKED', me, s.actor, s.org, p_case_id, target.cycle, target.id, v_reason, p_request_id)
  returning id into new_id;

  perform public.pw_audit(me, s.actor, 'profile', s.citizen,
    case when target.indefinite then 'REPORTING_RESTRICTION_LIFTED_INDEFINITE' else 'REPORTING_RESTRICTION_LIFTED' end,
    jsonb_build_object('moderation_action_id', new_id, 'revoked_action_id', target.id, 'case_id', p_case_id,
                       'strike_in_cycle', target.strike_in_cycle, 'cycle', target.cycle, 'new_cycle_started', target.indefinite));
  return jsonb_build_object('changed', true, 'action_id', new_id) || public.pw_moderation_staff_state(s.citizen, s.org);
end $$;

-- ---------------------------------------------------------------------------
-- Citizen: own status only (no notes, no staff identities, no history of others).

create function public.get_my_moderation() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.pw_require_user();
begin
  return public.pw_moderation_public_state(me);
end $$;

-- For the storage policy (caller only; no argument, so it cannot probe other accounts).
create function public.pw_i_am_reporting_restricted() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.pw_reporting_restricted(auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Enforcement

create function public.pw_refuse_report_when_restricted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.pw_reporting_restricted(new.citizen_id) then
    raise exception 'REPORTING_RESTRICTED: Reporting is restricted for this account.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger reports_refuse_restricted before insert on public.reports
  for each row execute function public.pw_refuse_report_when_restricted();

-- New evidence uploads by a restricted citizen are refused too (they could only become a report).
drop policy pw_report_evidence_insert_own on storage.objects;
create policy pw_report_evidence_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text and not public.pw_i_am_reporting_restricted());

-- ---------------------------------------------------------------------------
-- Grants: everything internal stays internal.

revoke all on function public.pw_moderation_immutable(), public.pw_moderation_cycle(uuid), public.pw_active_restriction(uuid),
  public.pw_reporting_restricted(uuid), public.pw_moderation_public_state(uuid), public.pw_moderation_staff_state(uuid, uuid),
  public.pw_moderation_scope(uuid), public.pw_refuse_report_when_restricted() from public, anon, authenticated;
revoke all on function public.get_reporter_moderation(uuid), public.restrict_reporter(uuid, text, text, text),
  public.revoke_reporter_restriction(uuid, uuid, text, text), public.get_my_moderation(), public.pw_i_am_reporting_restricted() from public, anon;
grant execute on function public.get_reporter_moderation(uuid), public.restrict_reporter(uuid, text, text, text),
  public.revoke_reporter_restriction(uuid, uuid, text, text), public.get_my_moderation(), public.pw_i_am_reporting_restricted() to authenticated;
