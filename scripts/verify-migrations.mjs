// Offline verification of supabase/migrations against a real Postgres
// (PGlite, WASM) with a minimal stand-in for Supabase's `auth` schema and
// roles. Runs the migrations, then exercises constraints and Row Level
// Security as different users. No Supabase account or network needed.
//
//   node scripts/verify-migrations.mjs        -> prints JSON, exit 1 on failure

import { PGlite } from "@electric-sql/pglite";
import { runT83 } from "./verify-t83.mjs";
import { runT84 } from "./verify-t84.mjs";
import { runT85, runT85SearchPath } from "./verify-t85.mjs";
import { runT87, runT87EnumRename } from "./verify-t87.mjs";
import { runT90 } from "./verify-t90.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const results = [];
const db = new PGlite();

// --- Minimal Supabase environment -----------------------------------------
const SETUP_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase default privileges (as on a real project): new tables, sequences and
  -- functions in public are granted to anon/authenticated unless a migration revokes.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text not null, owner uuid, created_at timestamptz default now(), metadata jsonb, unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;
await db.exec(SETUP_SQL);

const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of migrations) {
  try {
    await db.exec(readFileSync(join(migrationsDir, f), "utf8"));
    results.push({ name: `migration ${f} applies`, ok: true });
  } catch (e) {
    results.push({ name: `migration ${f} applies`, ok: false, detail: String(e.message) });
    console.log(JSON.stringify({ ok: false, results }, null, 2));
    process.exit(1);
  }
}
await db.exec(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;`);

// --- helpers -------------------------------------------------------------
const U = {
  citizenA: "00000000-0000-4000-8000-00000000000a",
  citizenB: "00000000-0000-4000-8000-00000000000b",
  officer: "00000000-0000-4000-8000-0000000000c1",
  fakeOfficer: "00000000-0000-4000-8000-0000000000f1",
};
async function as(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function anon(fn) {
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
async function ok(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, ...(detail !== undefined ? { detail } : {}) });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message) });
  }
}
async function fails(name, fn, pattern) {
  try {
    await fn();
    results.push({ name, ok: false, detail: "expected an error, but it succeeded" });
  } catch (e) {
    const msg = String(e.message);
    const matched = !pattern || pattern.test(msg);
    results.push({ name, ok: matched, detail: msg });
  }
}
async function expectRows(name, fn, n) {
  try {
    const rows = (await fn()).rows;
    results.push({ name, ok: rows.length === n, detail: `rows=${rows.length}, expected ${n}` });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message) });
  }
}
const q = (sql, params) => db.query(sql, params);
/** Access denied either way: no rows visible, or no privilege at all. */
async function denied(name, fn) {
  try {
    const rows = (await fn()).rows;
    results.push({ name, ok: rows.length === 0, detail: `rows=${rows.length}` });
  } catch (e) {
    const msg = String(e.message);
    results.push({ name, ok: /permission denied/.test(msg), detail: msg });
  }
}

// --- structure -----------------------------------------------------------
const SENSITIVE = [
  "profiles", "organizations", "jurisdictions", "organization_members", "reports", "report_evidence",
  "officer_cases", "inspections", "inspection_checks", "officer_evidence", "enforcement_outcomes",
  "reward_ledger", "notifications", "audit_events",
];
await ok("all expected tables exist with RLS enabled", async () => {
  const rows = (await q(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).rows;
  const byName = Object.fromEntries(rows.map((r) => [r.relname, r.relrowsecurity]));
  const missing = SENSITIVE.filter((t) => !(t in byName));
  const noRls = Object.entries(byName).filter(([, rls]) => !rls).map(([t]) => t);
  if (missing.length || noRls.length) throw new Error(`missing=${missing} noRls=${noRls}`);
  return `${rows.length} tables`;
});
await ok("no policy is unconditionally true", async () => {
  const rows = (await q(`select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'`)).rows;
  const bad = rows.filter((r) => [r.qual, r.with_check].some((x) => x && /^\(?\s*true\s*\)?$/i.test(x.trim())));
  if (bad.length) throw new Error(JSON.stringify(bad));
  return `${rows.length} policies`;
});

// --- users, org, membership (service/admin side) ---------------------------
await db.exec(`insert into auth.users (id) values ('${U.citizenA}'), ('${U.citizenB}'), ('${U.officer}'), ('${U.fakeOfficer}');`);
await ok("auth signup creates a CITIZEN profile automatically", async () => {
  const roles = (await q(`select role from public.profiles order by id`)).rows.map((r) => r.role);
  if (roles.length !== 4 || roles.some((r) => r !== "CITIZEN")) throw new Error(JSON.stringify(roles));
});
const org = (await q(`insert into public.organizations (name) values ('Demo Enforcement') returning id`)).rows[0].id;
await db.exec(`insert into public.jurisdictions (id, organization_id, name) values ('helsinki-demo', '${org}', 'Helsinki (demo)');
  insert into public.organization_members (organization_id, user_id, member_role) values ('${org}', '${U.officer}', 'OFFICER');
  update public.profiles set role = 'OFFICER' where id in ('${U.officer}', '${U.fakeOfficer}');`);

// --- profiles --------------------------------------------------------------
await expectRows("citizen sees only their own profile", () => as(U.citizenA, () => q(`select id from public.profiles`)), 1);
await ok("citizen can edit their display name", () => as(U.citizenA, () => q(`update public.profiles set display_name = 'Mika' where id = '${U.citizenA}'`)));
await fails("citizen cannot make themselves an officer", () => as(U.citizenA, () => q(`update public.profiles set role = 'OFFICER' where id = '${U.citizenA}'`)), /permission denied/);
await fails("a client cannot grant itself organization membership", () =>
  as(U.fakeOfficer, () => q(`insert into public.organization_members (organization_id, user_id, member_role) values ('${org}', '${U.fakeOfficer}', 'OFFICER')`)), /permission denied/);
await denied("anonymous users see no profiles", () => anon(() => q(`select id from public.profiles`)));
await denied("anonymous users see no reports", () => anon(() => q(`select id from public.reports`)));

// --- reports (citizen) -------------------------------------------------------
const reportSql = (citizen, draft) => `insert into public.reports
  (citizen_id, source_draft_id, jurisdiction_id, violation_type, plate_raw, plate_normalized, plate_country,
   location_address, latitude, longitude, location_accuracy_m, observed_at, submitted_at)
  values ('${citizen}', '${draft}', 'helsinki-demo', 'no-parking', 'GHC-789', 'GHC789', 'FI',
   'Mannerheimintie 45, Helsinki', 60.1699, 24.9384, 6, now(), now())
  returning id, public_report_number, status, received_at`;
let reportA;
await ok("a report row gets server-assigned number, status and receipt time", async () => {
  const r = (await q(reportSql(U.citizenA, "draft-1"))).rows[0];
  reportA = r;
  if (r.status !== "UNDER_REVIEW" || Number(r.public_report_number) < 100000 || !r.received_at) throw new Error(JSON.stringify(r));
  return `#${r.public_report_number}`;
});
await fails("the same draft cannot be submitted twice", () => q(reportSql(U.citizenA, "draft-1")), /duplicate key/);
await fails("citizens cannot insert reports directly (submit_report only)", () => as(U.citizenA, () => q(reportSql(U.citizenA, "draft-x"))), /permission denied/);
await fails("citizen cannot set the report status", () =>
  as(U.citizenA, () => q(`insert into public.reports (citizen_id, source_draft_id, jurisdiction_id, violation_type, location_address, observed_at, submitted_at, status)
    values ('${U.citizenA}', 'd2', 'helsinki-demo', 'no-parking', 'X', now(), now(), 'VERIFIED')`)), /permission denied/);
await fails("citizen cannot fake the trusted received_at time", () =>
  as(U.citizenA, () => q(`insert into public.reports (citizen_id, source_draft_id, jurisdiction_id, violation_type, location_address, observed_at, submitted_at, received_at)
    values ('${U.citizenA}', 'd3', 'helsinki-demo', 'no-parking', 'X', now(), now(), now())`)), /permission denied/);
await fails("citizen cannot change a submitted report", () => as(U.citizenA, () => q(`update public.reports set status = 'VERIFIED' where id = '${reportA.id}'`)), /permission denied/);
await expectRows("another citizen cannot see the report", () => as(U.citizenB, () => q(`select id from public.reports`)), 0);
await expectRows("the owner can see the report", () => as(U.citizenA, () => q(`select id from public.reports`)), 1);

// --- citizen evidence --------------------------------------------------------
const evSql = (report, slot, source, path) =>
  `insert into public.report_evidence (report_id, slot, capture_source, storage_path, captured_at) values ('${report}', '${slot}', '${source}', '${path}', now())`;
await ok("a camera photo row is attached to the report", () => q(evSql(reportA.id, "FRONT", "CAMERA", `citizen/${reportA.id}/front.jpg`)));
await fails("a library image cannot fill a required angle", () => q(evSql(reportA.id, "SIDE", "LIBRARY", `citizen/${reportA.id}/side.jpg`)), /check constraint/);
await ok("a library image is fine as an attachment", () => q(evSql(reportA.id, "ATTACHMENT", "LIBRARY", `citizen/${reportA.id}/extra.jpg`)));
await fails("a device file:// URI is not a storage path", () => q(evSql(reportA.id, "REAR", "CAMERA", "file:///data/rear.jpg")), /check constraint/);
await fails("only one photo per required angle", () => q(evSql(reportA.id, "FRONT", "CAMERA", `citizen/${reportA.id}/front2.jpg`)), /duplicate key/);
await fails("citizens cannot insert evidence rows directly", () => as(U.citizenA, () => q(evSql(reportA.id, "REAR", "CAMERA", `citizen/${reportA.id}/rear.jpg`))), /permission denied/);

// --- enforcement side (server-created) ----------------------------------------
const caseId = (await q(`insert into public.officer_cases (report_id, jurisdiction_id, status, assigned_officer_id, assigned_at, en_route_at, inspection_started_at)
  values ('${reportA.id}', 'helsinki-demo', 'INSPECTION', '${U.officer}', now(), now(), now()) returning id`)).rows[0].id;
const inspId = (await q(`insert into public.inspections (case_id, started_at) values ('${caseId}', now()) returning id`)).rows[0].id;
await ok("tri-state checks: yes, no and unanswered are all storable", () =>
  q(`insert into public.inspection_checks (inspection_id, check_key, answer, answered_at) values
     ('${inspId}', 'vehiclePresent', true, now()), ('${inspId}', 'plateMatches', false, now()),
     ('${inspId}', 'violationConfirmed', null, null), ('${inspId}', 'restrictionVerified', null, null)`));
await fails("an answer without an answer time is rejected", () =>
  q(`update public.inspection_checks set answer = true where inspection_id = '${inspId}' and check_key = 'violationConfirmed'`), /check constraint/);
await fails("officer evidence cannot come from the photo library", () =>
  q(`insert into public.officer_evidence (inspection_id, case_id, evidence_type, capture_source, storage_path, captured_at)
     values ('${inspId}', '${caseId}', 'PARKING_SIGN', 'LIBRARY', 'officer/x/sign.jpg', now())`), /check constraint/);
await ok("officer evidence is linked to the inspection and case", () =>
  q(`insert into public.officer_evidence (inspection_id, case_id, evidence_type, capture_source, storage_path, captured_at)
     values ('${inspId}', '${caseId}', 'PARKING_SIGN', 'CAMERA', 'officer/${caseId}/sign.jpg', now())`));
await fails("CHARGE_ISSUED requires a parking charge amount", () =>
  q(`insert into public.enforcement_outcomes (case_id, code, decided_by, decided_at) values ('${caseId}', 'CHARGE_ISSUED', '${U.officer}', now())`), /check constraint/);
await fails("only CHARGE_ISSUED may carry a parking charge", () =>
  q(`insert into public.enforcement_outcomes (case_id, code, decided_by, decided_at, parking_charge_amount_cents) values ('${caseId}', 'REPORT_REJECTED', '${U.officer}', now(), 6000)`), /check constraint/);
await ok("an outcome is recorded once", () =>
  q(`insert into public.enforcement_outcomes (case_id, inspection_id, code, decided_by, decided_at, parking_charge_amount_cents) values ('${caseId}', '${inspId}', 'CHARGE_ISSUED', '${U.officer}', now(), 6000)`));
await fails("a second outcome for the same case is refused", () =>
  q(`insert into public.enforcement_outcomes (case_id, code, decided_by, decided_at) values ('${caseId}', 'OTHER', '${U.officer}', now())`), /duplicate key/);
await fails("outcomes are append-only", () => q(`update public.enforcement_outcomes set code = 'OTHER' where case_id = '${caseId}'`), /append-only/);

await expectRows("an authorized officer (active member) sees the case", () => as(U.officer, () => q(`select id from public.officer_cases`)), 1);
await expectRows("an authorized officer sees the report in their jurisdiction", () => as(U.officer, () => q(`select id from public.reports`)), 1);
await expectRows("an authorized officer sees the citizen evidence", () => as(U.officer, () => q(`select id from public.report_evidence`)), 2);
await expectRows("an authorized officer sees inspection, checks, officer evidence and outcome", () =>
  as(U.officer, () => q(`select 1 from public.inspections union all select 1 from public.inspection_checks union all select 1 from public.officer_evidence union all select 1 from public.enforcement_outcomes`)), 1 + 4 + 1 + 1);
await expectRows("a user whose profile merely SAYS officer sees no cases", () => as(U.fakeOfficer, () => q(`select id from public.officer_cases`)), 0);
await expectRows("a user whose profile merely SAYS officer sees no reports", () => as(U.fakeOfficer, () => q(`select id from public.reports`)), 0);
await expectRows("the citizen does not see the officer case", () => as(U.citizenA, () => q(`select id from public.officer_cases`)), 0);
await expectRows("the citizen does not see officer evidence", () => as(U.citizenA, () => q(`select id from public.officer_evidence`)), 0);
await fails("officers cannot change cases directly (server functions only)", () => as(U.officer, () => q(`update public.officer_cases set status = 'COMPLETED' where id = '${caseId}'`)), /permission denied/);
await fails("officers cannot write outcomes directly", () =>
  as(U.officer, () => q(`insert into public.enforcement_outcomes (case_id, code, decided_by, decided_at) values ('${caseId}', 'OTHER', '${U.officer}', now())`)), /permission denied/);
await db.exec(`update public.organization_members set active = false where user_id = '${U.officer}'`);
await expectRows("a deactivated officer loses access immediately", () => as(U.officer, () => q(`select id from public.officer_cases`)), 0);
await db.exec(`update public.organization_members set active = true where user_id = '${U.officer}'`);

// --- reward ledger ----------------------------------------------------------
const led = (type, key, extra = "") =>
  `insert into public.reward_ledger (citizen_id, entry_type, amount_cents, report_id, withdrawal_id, idempotency_key)
   values ('${U.citizenA}', '${type}', 500, ${type.startsWith("REWARD") ? `'${reportA.id}'` : "null"}, ${type.startsWith("WITHDRAWAL") ? "'11111111-1111-4111-8111-111111111111'" : "null"}, '${key}') ${extra}`;
await ok("pending reward recorded", () => q(led("REWARD_PENDING", `REWARD_PENDING:${reportA.id}`)));
await fails("replaying the same operation never credits twice", () => q(led("REWARD_PENDING", `REWARD_PENDING:${reportA.id}`)), /duplicate key/);
await fails("a second pending reward for the same report is refused", () => q(led("REWARD_PENDING", `other-key`)), /duplicate key/);
await ok("reward released once", () => q(led("REWARD_RELEASED", `REWARD_RELEASED:${reportA.id}`)));
await fails("a released reward cannot also be voided", () => q(led("REWARD_VOIDED", `REWARD_VOIDED:${reportA.id}`)), /duplicate key/);
await ok("withdrawal requested once", () => q(led("WITHDRAWAL_REQUESTED", "WITHDRAWAL_REQUESTED:w1")));
await fails("the same withdrawal cannot be debited twice", () => q(led("WITHDRAWAL_REQUESTED", "WITHDRAWAL_REQUESTED:w1-retry")), /duplicate key/);
await ok("money columns are integer cents", async () => {
  const rows = (await q(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and column_name like '%cents%' and table_name <> 'reward_balances'`)).rows;
  const bad = rows.filter((r) => r.data_type !== "integer");
  if (rows.length < 3 || bad.length) throw new Error(JSON.stringify(rows));
  return rows.map((r) => `${r.table_name}.${r.column_name}`).join(", ");
});
await fails("amounts must be positive", () =>
  q(`insert into public.reward_ledger (citizen_id, entry_type, amount_cents, idempotency_key) values ('${U.citizenA}', 'OPENING_BALANCE', 0, 'zero')`), /check constraint/);
await fails("the ledger is append-only (no updates)", () => q(`update public.reward_ledger set amount_cents = 99999`), /append-only/);
await fails("the ledger is append-only (no deletes)", () => q(`delete from public.reward_ledger`), /append-only/);
await expectRows("citizen reads their own ledger", () => as(U.citizenA, () => q(`select id from public.reward_ledger`)), 3);
await expectRows("another citizen cannot read it", () => as(U.citizenB, () => q(`select id from public.reward_ledger`)), 0);
await ok("derived balance: 5.00 pending->available, minus the 5.00 withdrawal", async () => {
  const b = (await as(U.citizenA, () => q(`select pending_cents, available_cents, paid_out_cents from public.reward_balances`))).rows[0];
  if (Number(b.pending_cents) !== 0 || Number(b.available_cents) !== 0 || Number(b.paid_out_cents) !== 0) throw new Error(JSON.stringify(b));
});
await fails("clients cannot write the ledger", () => as(U.citizenA, () => q(led("OPENING_BALANCE", "self-credit"))), /permission denied/);

// --- notifications -------------------------------------------------------------
const notifId = (await q(`insert into public.notifications (recipient_id, recipient_role, type, report_id, amount_cents, idempotency_key)
  values ('${U.citizenA}', 'CITIZEN', 'REPORT_VERIFIED', '${reportA.id}', 500, 'REPORT_VERIFIED:${reportA.id}') returning id`)).rows[0].id;
await fails("notifications are idempotent", () =>
  q(`insert into public.notifications (recipient_id, recipient_role, type, report_id, idempotency_key) values ('${U.citizenA}', 'CITIZEN', 'REPORT_VERIFIED', '${reportA.id}', 'REPORT_VERIFIED:${reportA.id}')`), /duplicate key/);
await fails("non-SYSTEM notifications carry no free text", () =>
  q(`insert into public.notifications (recipient_id, recipient_role, type, title, idempotency_key) values ('${U.citizenA}', 'CITIZEN', 'REPORT_VERIFIED', 'You won', 'x1')`), /check constraint/);
await ok("recipient marks it read", () => as(U.citizenA, () => q(`update public.notifications set read_at = now() where id = '${notifId}'`)));
await fails("recipient cannot rewrite its content", () => as(U.citizenA, () => q(`update public.notifications set type = 'SYSTEM' where id = '${notifId}'`)), /permission denied/);
await expectRows("another user cannot see it", () => as(U.citizenB, () => q(`select id from public.notifications`)), 0);

// --- audit events ---------------------------------------------------------------
await ok("audit event recorded by the server", () =>
  q(`insert into public.audit_events (actor_user_id, actor_role, source, entity_type, entity_id, event_type, metadata)
     values ('${U.officer}', 'OFFICER', 'USER_ACTION', 'outcome', '${caseId}', 'OUTCOME_RECORDED', '{"code":"CHARGE_ISSUED"}')`));
await fails("audit metadata may not contain secrets or image bytes", () =>
  q(`insert into public.audit_events (actor_role, source, entity_type, entity_id, event_type, metadata)
     values ('SYSTEM', 'SYSTEM', 'report', '${reportA.id}', 'REPORT_SUBMITTED', '{"password":"x"}')`), /check constraint/);
await fails("audit events are append-only", () => q(`update public.audit_events set event_type = 'X_Y_Z'`), /append-only/);
await fails("audit events cannot be truncated", () => q(`truncate public.audit_events`), /append-only/);
await denied("clients cannot read audit events", () => as(U.officer, () => q(`select id from public.audit_events`)));
await fails("clients cannot write audit events", () =>
  as(U.citizenA, () => q(`insert into public.audit_events (actor_role, source, entity_type, entity_id, event_type) values ('CITIZEN', 'USER_ACTION', 'report', '${reportA.id}', 'FAKE_EVENT')`)), /permission denied/);

// --- T8.2: sign-up bootstrap, metadata role injection, recovery, membership+role ---
const NEW_USER = "00000000-0000-4000-8000-0000000000d1";
const INJECT = "00000000-0000-4000-8000-0000000000d2";
const ORPHAN = "00000000-0000-4000-8000-0000000000d3";
const MEMBER_ONLY = "00000000-0000-4000-8000-0000000000d4";
await ok("sign-up copies the display name from metadata (sanitized)", async () => {
  await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${NEW_USER}', '{"display_name":"  Mika Salo  "}')`);
  const p = (await q(`select role, display_name from public.profiles where id = '${NEW_USER}'`)).rows[0];
  if (p.role !== "CITIZEN" || p.display_name !== "Mika Salo") throw new Error(JSON.stringify(p));
});
await ok("a role in sign-up metadata is ignored: the account is CITIZEN", async () => {
  await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${INJECT}', '{"display_name":"x","role":"OFFICER","app_role":"ADMIN"}')`);
  const p = (await q(`select role from public.profiles where id = '${INJECT}'`)).rows[0];
  if (p.role !== "CITIZEN") throw new Error(JSON.stringify(p));
});
await fails("a client cannot insert its own profile (e.g. as OFFICER)", () =>
  as(INJECT, () => q(`insert into public.profiles (id, role) values ('${INJECT}', 'OFFICER')`)), /permission denied/);
await ok("ensure_my_profile recreates a missing profile as CITIZEN for the caller only", async () => {
  await db.exec(`insert into auth.users (id) values ('${ORPHAN}'); delete from public.profiles where id = '${ORPHAN}';`);
  const p = (await as(ORPHAN, () => q(`select id, role from public.ensure_my_profile()`))).rows[0];
  if (p.id !== ORPHAN || p.role !== "CITIZEN") throw new Error(JSON.stringify(p));
});
await ok("ensure_my_profile never changes an existing (officer) profile", async () => {
  const p = (await as(U.officer, () => q(`select role from public.ensure_my_profile()`))).rows[0];
  if (p.role !== "OFFICER") throw new Error(JSON.stringify(p));
});
await denied("anonymous callers cannot use ensure_my_profile", () => anon(() => q(`select * from public.ensure_my_profile()`)));
await ok("a user reads their own memberships (for role resolution)", async () => {
  const rows = (await as(U.officer, () => q(`select member_role, active from public.organization_members`))).rows;
  if (rows.length !== 1 || rows[0].member_role !== "OFFICER" || !rows[0].active) throw new Error(JSON.stringify(rows));
});
await expectRows("a user cannot see other users' memberships", () => as(U.citizenA, () => q(`select 1 from public.organization_members`)), 0);
await ok("membership without a server-set officer profile role gives NO case access", async () => {
  await db.exec(`insert into auth.users (id) values ('${MEMBER_ONLY}');
    insert into public.organization_members (organization_id, user_id, member_role) values ('${org}', '${MEMBER_ONLY}', 'OFFICER');`);
  const rows = (await as(MEMBER_ONLY, () => q(`select id from public.officer_cases`))).rows;
  if (rows.length !== 0) throw new Error(`rows=${rows.length}`);
});
await expectRows("membership + officer profile role still grants access", () => as(U.officer, () => q(`select id from public.officer_cases`)), 1);

await runT83({ db, q, as, anon, ok, fails, expectRows, denied, U, org });
await runT84({ db, q, as, anon, ok, fails, expectRows, denied, U, org });
await runT85({ db, q, as, anon, ok, fails, expectRows, denied, U, org });
await runT85SearchPath({ q, ok });
await runT87({ db, q, as, anon, ok, fails, expectRows, denied, U, org });
await runT87EnumRename({ ok }, { migrationsDir, setupSql: SETUP_SQL });
await runT90({ db, q, as, anon, ok, fails, expectRows, denied, U, org });

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
