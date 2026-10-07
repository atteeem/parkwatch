# ParkWatch backend setup (Supabase)

> **Status (T8.2): accounts are real, app data is still local.** With Supabase
> configured, people sign up / sign in with real Supabase accounts and the app routes
> them by their **server-side** role. Reports, cases, inspections, rewards,
> notifications and parking still live in the app's **local store** (cutover is T8.3).
> Without Supabase configured the app runs as the local investor demo, unchanged.

## 1. Create a Supabase project

1. Sign in at <https://supabase.com> and create a new project (choose an EU region for
   Finnish data).
2. Wait until the project is ready.

## 2. Find the URL and the anon (public) key

Project dashboard → **Project Settings → API**:

- **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
- **anon / publishable key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Both are public client values. **Never** copy the secret / server-only ("service")
key into the app or into `.env`: anything named `EXPO_PUBLIC_*` is bundled into the
mobile app. The app refuses such a key even if it is set by mistake.

## 3. Configure the app

```bash
cp .env.example .env
```

Fill in the two values. `.env` is git-ignored. With the values empty (the default),
the backend layer reports `BACKEND_NOT_CONFIGURED` and nothing else changes.

## 4. Apply the migrations

Migrations live in `supabase/migrations/` and must be applied **in filename order**:

1. `20261005000001_core_schema.sql` — tables, enums, constraints, append-only guards
2. `20261005000002_rls_policies.sql` — privileges and Row Level Security
3. `20261006000001_auth_profiles.sql` — sign-up profile bootstrap, profile recovery, officer access hardening
4. `20261007000001_core_workflow.sql` — server functions for the core workflow, private
   evidence buckets + storage policies, `app_settings` (T8.3)
5. `20261008000001_paged_reads.sql` — paginated, filter-aware reads and server-side
   counts (T8.4; all SECURITY INVOKER, so RLS applies)
6. `20261009000001_function_execute_hardening.sql` — no function is executable by
   `anon`; policy helpers only by signed-in users; trigger functions by nobody; every
   function pins `search_path` (T8.5, found by the Supabase security advisor on the
   real development project)
7. `20261010000001_report_location_provenance.sql` — T8.7: `reports.location_source`
   (`GPS` / `MAP_SELECTED`) + the raw device fix (`device_*`); a map-picked point may
   not carry GPS accuracy/time. `submit_report` gains five optional trailing
   parameters (old signature dropped). Existing points are backfilled as `GPS`.
8. `20261010000002_officer_evidence_front_rear.sql` — T8.7: renames the officer
   evidence enum values in place: `VEHICLE_OVERVIEW → VEHICLE_FRONT`,
   `VIOLATION_CONTEXT → VEHICLE_REAR` (existing rows keep their photos). **Apps older
   than T8.7 send the old labels and stop working for officer photos after this
   migration**; deploy the T8.7 app together with it.
9. `20261010000003_officer_monthly_stats.sql` — T8.7: `get_officer_monthly_stats`
   (SECURITY INVOKER; the signed-in officer's own outcomes only).
10. `20261010000004_profile_avatars.sql` — T8.7: private `profile-avatars` bucket
    (2 MB, JPEG/PNG/WebP) with own-folder-only storage policies,
    `profiles.avatar_storage_path` (path only, not client-writable) and
    `set_my_avatar(path | null)`.

> T8.7 migrations (7–10) are **not applied to the real development project yet**.
> Review them, run `npm run verify:migrations`, then apply in order.

After applying (4), set the enforcement area new reports go to. **This is a
development-only routing setting**, controlled on the server; citizens never choose an
organization. Real geographic jurisdiction resolution comes later. In the SQL editor:

```sql
update public.app_settings set default_jurisdiction_id = 'helsinki-demo';
```

Without it, submitting a report fails with "ParkWatch isn't receiving reports here yet."
(the draft stays saved on the phone). `supabase/seed.dev.sql` sets it for you.

**Option A — Supabase CLI** (recommended):

```bash
npx supabase login
npx supabase init          # only if supabase/config.toml does not exist yet
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Option B — Dashboard:** open **SQL Editor**, paste each file in order and run it.

Optional, development projects only: run `supabase/seed.dev.sql` in the SQL editor. It
creates one demo organization and the `helsinki-demo` jurisdiction. It is not a
migration and is never applied automatically.

## 5. Check that it worked

In **Table Editor** you should see: `profiles`, `organizations`, `jurisdictions`,
`organization_members`, `reports`, `report_evidence`, `officer_cases`, `inspections`,
`inspection_checks`, `officer_evidence`, `enforcement_outcomes`, `reward_ledger`,
`notifications`, `audit_events` (plus the `reward_balances` view). Every table shows
**RLS enabled**.

Or in the SQL editor:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
```

You can verify the same migrations offline at any time (no account needed):

```bash
node scripts/verify-migrations.mjs
```

It applies them to an in-process Postgres and runs ~216 checks (constraints,
idempotency, append-only history, RLS as citizen / officer / impostor / anonymous, the
core workflow functions, storage policies and the paginated reads).

## How access works

- **Deny by default.** RLS is on for every table; no policy is `USING (true)`.
- **Citizens** read their own profile, reports, report photos, reward ledger and
  notifications. They create reports only through the `submit_report` server function
  (direct inserts are revoked); the server sets the owner, status, report number,
  receipt time and reward.
- **Officers** are not trusted because a client says so. Access needs BOTH a
  server-set `profiles.role = 'OFFICER'` (or SUPERVISOR) and an active row in
  `organization_members` for the organization that owns the report's jurisdiction.
  Only the server (service role / admin tooling) can write either.
- **No client writes** to reports, cases, inspections, officer evidence, outcomes, the
  reward ledger, notifications or audit events. Every change goes through a server
  function that applies the domain rules atomically (T8.3, see
  [CORE_BACKEND_ARCHITECTURE.md](CORE_BACKEND_ARCHITECTURE.md)).
- Citizen and officer evidence are separate tables. Evidence rows store a
  `storage_path` in a **private** bucket (`report-evidence`, `officer-evidence`),
  never a device `file://` URI and never image bytes.
- The reward ledger, enforcement outcomes and audit events are append-only.

## Accounts and sign-in (T8.2)

**Two runtime modes**, chosen automatically:

| | No Supabase env (default) | Supabase env set |
|---|---|---|
| Mode | `LOCAL_DEMO` | `BACKEND` |
| Sign in / sign up | not shown | real Supabase Auth (email + password) |
| Role | dev role switch (Profile → Demo tools, dev builds only) | from the server only |
| Demo tools | shown in dev builds | hidden |
| Sign Out | "not available in demo" | real, with confirmation |

**Auth settings in Supabase** (Authentication → Providers → Email): enable Email.
*Confirm email* may be on or off; the app handles both truthfully:

- **On:** after sign-up the app shows "Check your email" and is NOT signed in until
  the link is opened and the user signs in.
- **Off:** sign-up returns a session and the user lands in the citizen app.

Sessions are persisted by supabase-js itself (AsyncStorage adapter) and refreshed
while the app is in the foreground. The app never stores or logs passwords or tokens.

**How profiles are created:** a database trigger creates a `CITIZEN` profile for every
new auth user. The sign-up display name is copied; any role in sign-up metadata is
ignored. If a signed-in user has no profile, the app calls `ensure_my_profile()`, which
can only create a `CITIZEN` profile for the caller. There is no role choice anywhere in
the app.

**How officers are provisioned (server/admin only):** an officer needs BOTH

1. `profiles.role = 'OFFICER'`, and
2. an **active** `organization_members` row (`member_role` OFFICER or SUPERVISOR) for
   the organization that owns the jurisdiction.

Both tables are writable only with the service role (SQL editor as project owner, or
future admin tooling). Example, run as the project owner:

```sql
update public.profiles set role = 'OFFICER' where id = (select id from auth.users where email = 'officer@example.test');
insert into public.organization_members (organization_id, user_id, member_role)
select '<organization-id>', id, 'OFFICER' from auth.users where email = 'officer@example.test';
```

To revoke: `update public.organization_members set active = false where user_id = …`.
The app re-checks profile and membership when it starts and whenever it returns to the
foreground, so revoked access disappears without reinstalling (the user sees "Officer
access is not active"). Supervisor/admin accounts see a truthful placeholder.
`user_metadata` is never used for authorization.

**Testing backend mode without a cloud project:** `npm run mock:backend` starts a local
stand-in (development only) that runs the real migrations in an in-process Postgres and
serves auth, the server functions (as the signed-in user) and private storage with
signed URLs. Test accounts are in the header of `scripts/mock-supabase-backend.mjs`.
Then `node scripts/dev-web-backend.mjs` starts the web app against it (or set
`EXPO_PUBLIC_SUPABASE_URL=http://localhost:54399 EXPO_PUBLIC_SUPABASE_ANON_KEY=mock-anon`).
The mock is not Supabase; passing against it does not verify a real project.

## Development cloud setup checklist (T8.4)

Use a **separate development project**. Never use production data. Nothing below needs
a service-role key in the app.

1. Create the project (section 1). In **Authentication → Providers → Email**, decide
   whether email confirmation is on (the app handles both).
2. Apply the migrations in order (section 4; ten as of T8.7).
3. Run `supabase/seed.dev.sql` (demo organization, `helsinki-demo` jurisdiction,
   default jurisdiction).
4. Verify in the SQL editor:

   ```sql
   -- RLS on every public table (all rows: true)
   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
   -- private buckets (public = false for both)
   select id, public, file_size_limit from storage.buckets where id in ('report-evidence', 'officer-evidence');
   -- profile bootstrap trigger exists
   select tgname from pg_trigger where tgname = 'on_auth_user_created';
   -- development routing is set
   select default_jurisdiction_id from public.app_settings;
   -- every SECURITY DEFINER function pins search_path (expect 0 rows)
   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
   ```

5. **Citizen test accounts:** sign up in the app (or Authentication → Users → Add user).
   The trigger creates a CITIZEN profile. Make two (A and B) for isolation checks.
6. **Officer test account:** create the user in the dashboard (there is no officer
   self-registration), then as the project owner:

   ```sql
   update public.profiles set role = 'OFFICER'
   where id = (select id from auth.users where email = 'officer-dev@example.test');
   insert into public.organization_members (organization_id, user_id, member_role)
   select '0a7c0000-0000-4000-8000-000000000001', id, 'OFFICER'
   from auth.users where email = 'officer-dev@example.test';
   ```

   For the cross-organization check, create a second organization + jurisdiction and a
   second officer there. To test revocation:
   `update public.organization_members set active = false where user_id = …`.
7. **Metadata check:** sign up a citizen with `role: "OFFICER"` in user metadata (e.g.
   via the dashboard) and confirm the app still treats them as a citizen.
8. Put the URL and anon key in your local `.env` only (section 3) and follow
   [REAL_DEVICE_QA.md](REAL_DEVICE_QA.md).

### Local mock backend (no cloud project)

`npm run mock:backend` (port 54399) runs the real migrations in an in-process Postgres
and serves auth, the server functions (executed as the signed-in user) and private
storage. `node scripts/dev-web-backend.mjs` starts the web app against it.
`node scripts/mock-camera-steps.mjs submit` / `officer-photos <report no>` perform
camera steps for browsers without a camera. The mock's accounts and the password
`mock-password-1` exist **only inside that local mock** (in memory) — they are not real
credentials and never work against a Supabase project.

### Cloud smoke test (optional)

`npm run test:cloud-smoke` runs one citizen → officer → citizen flow plus security spot
checks against a **development** project: citizen submits a report with 3 private
photos → officer finds the same case, accepts, inspects, uploads 4 private photos,
issues CHARGE_ISSUED → citizen sees VERIFIED, €5 available and one notification.

- Not part of `npm test`/Jest. Without `PARKWATCH_RUN_CLOUD_SMOKE=1` it does nothing
  (exit 0); opted in but incomplete configuration → clear message, exit 1.
- Required environment variables (set them in your shell only, never in git):

  | Variable | Value |
  | --- | --- |
  | `PARKWATCH_RUN_CLOUD_SMOKE` | `1` (explicit opt-in) |
  | `CLOUD_SMOKE_CONFIRM` | `development-project` |
  | `CLOUD_SMOKE_SUPABASE_URL` | development project URL |
  | `CLOUD_SMOKE_ANON_KEY` | the anon (public) key — service-role/`sb_secret_` keys are refused |
  | `CLOUD_SMOKE_CITIZEN_EMAIL` / `_PASSWORD` | a **test** citizen account |
  | `CLOUD_SMOKE_OFFICER_EMAIL` / `_PASSWORD` | a **test** officer account (role + active membership) |

- Uses only test accounts and the public key; no admin access, no production data.

**Smoke test data — identification and cleanup.** Each run creates exactly ONE report
(plus its case, 7 photos, ledger, notification and audit rows). The report's notes start
with `[ParkWatch cloud smoke test <time>]`, its address is
`Cloud smoke test (development)`, its plate `SMK-001` and its submission id
`smoke-…`. At the end the script prints `manualCleanup`: the report number, case id
and every storage object of THIS run only. The script never deletes anything.

Outcomes, the reward ledger and audit events are **append-only by design** (triggers
refuse delete), so these rows cannot be removed with a normal `delete` — that is the
intended protection, do not disable it on a shared project. Safe options:

1. Keep runs few and leave the clearly marked rows in the development project, or
2. Reset a **development-only** database (`npx supabase db reset --linked`, then
   re-apply the seed and accounts), or
3. Remove only the listed storage objects (Dashboard → Storage), which does not touch
   history rows.

Find smoke records with:

```sql
select public_report_number, source_draft_id, created_at
from public.reports where notes like '[ParkWatch cloud smoke test%';
```

### Real-cloud QA suite (T8.5)

`PARKWATCH_RUN_CLOUD_QA=1 npm run test:cloud-qa` runs `src/backend/__cloudqa__/realCloud.cloudqa.ts`
against the development project with the app's real backend modules (26 checks: citizen
→ officer → citizen flows, all outcomes, accept race, RLS and private storage,
pagination, lost responses, signed URL expiry, invalid tokens). It is never part of
`npm test`. It reads the URL/anon key from `.env` and the four TEST accounts'
passwords from environment variables or the git-ignored `.env.cloudqa.local`
(`CLOUDQA_CITIZEN_A_PASSWORD`, `CLOUDQA_CITIZEN_B_PASSWORD`,
`CLOUDQA_OFFICER_A_PASSWORD`, `CLOUDQA_OFFICER_B_PASSWORD`; emails default to
CitizenA@ / CitizenB@ / OfficerA@ / OfficerB@gmail.com). Each run creates about ten small
reports marked `[ParkWatch cloud QA <run id>]` and writes only record ids to the
git-ignored `cloud-qa-results.local.json`. Result at the end of T8.5: **26/26 passed**.

### Keeping credentials out of git

- `.env` is git-ignored; `.env.example` holds empty placeholders only.
- Only `EXPO_PUBLIC_SUPABASE_URL` and the anon key ever go to the app. The service-role
  key, database password and personal access tokens stay in the Supabase dashboard or
  your own shell; the app refuses a service-role key at startup.
- Test account passwords for a real project are never written to the repository
  (smoke test variables are passed in the shell).

## Current limitations

- **Verified on a real Supabase development project (T8.5: QA suite 26/26, smoke 26/26);
  NOT verified on a physical phone.** See [REAL_DEVICE_QA.md](REAL_DEVICE_QA.md).
- Supabase access tokens remain valid until expiry after sign-out (stateless JWTs).
- No reporter statistics in backend mode (shown as "Not rated").
- Withdrawals are disabled in backend mode ("Withdrawals are not available in the
  backend preview yet."); there is no server payout flow.
- New reports go to one configured jurisdiction (`app_settings`, development routing),
  no geographic routing.
- The citizen's full own reward ledger is loaded for wallet/earnings (lists are paged;
  the ledger is small per report but not paged).
- No reporter statistics in backend mode (shown as "Not rated").
- No password reset, social login, MFA or account deletion yet.
- **Parking remains local** (simulated sessions, vehicles, history and demo pricing on the
  phone); it is not part of the backend schema.
- No realtime, push/email delivery, payouts or provider integrations.

## What comes next

- Run the development-cloud checklist, the cloud smoke test and REAL_DEVICE_QA.md.
- Server-side withdrawals, geographic jurisdiction routing, reporter statistics,
  realtime/push notifications.
