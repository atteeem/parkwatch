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

**Option A — Supabase CLI** (recommended):

```bash
npx supabase login
npx supabase init          # only if supabase/config.toml does not exist yet
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Option B — Dashboard:** open **SQL Editor**, paste the first file, run it; then the
second file.

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

It applies them to an in-process Postgres and runs ~70 checks (constraints,
idempotency, append-only history and RLS as citizen / officer / impostor / anonymous).

## How access works

- **Deny by default.** RLS is on for every table; no policy is `USING (true)`.
- **Citizens** read their own profile, reports, report photos, reward ledger and
  notifications, and may create reports owned by themselves (server-owned fields such
  as status, report number and the trusted `received_at` time cannot be set).
- **Officers** are not trusted because a client says so. Access needs BOTH a
  server-set `profiles.role = 'OFFICER'` (or SUPERVISOR) and an active row in
  `organization_members` for the organization that owns the report's jurisdiction.
  Only the server (service role / admin tooling) can write either.
- **No client writes** to cases, inspections, officer evidence, outcomes, the reward
  ledger or audit events. Those changes will go through server-side functions that
  apply the existing domain rules (next milestones).
- Citizen and officer evidence are separate tables. Evidence rows store a
  `storage_path` in a **private** bucket (`citizen-evidence`, `officer-evidence`),
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

**Testing backend mode without a cloud project:** `node scripts/mock-supabase-auth.mjs`
starts a local stand-in for the auth/profile endpoints (development only, see the file
header for test accounts), then start the app with
`EXPO_PUBLIC_SUPABASE_URL=http://localhost:54399 EXPO_PUBLIC_SUPABASE_ANON_KEY=mock-anon`.

## Current limitations

- Reports, cases, inspections, rewards, notifications and evidence still use the
  **local store**, even for a signed-in account (shared demo data on the device).
- No password reset, social login, MFA or account deletion yet.
- No Storage buckets or uploads yet.
- No server-side functions for accepting cases, inspections, outcomes or rewards yet.
- Simulated parking stays local and is not part of the backend schema.
- No realtime, push/email delivery, payouts or provider integrations.

## What comes next

- **T8.3** — server operations and data: private Storage buckets + evidence uploads,
  server-side functions for report submission (report + case + pending reward
  atomically) and the officer lifecycle/outcomes (using the domain rules), and moving
  the app's data onto `src/backend/repositories` behind the same screens.
