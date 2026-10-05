# ParkWatch backend setup (Supabase)

> **Status (T8.1): foundation only.** The schema, security rules, typed mappers and
> repositories exist, but the app still runs entirely on its **local store**. You do
> not need a Supabase project to run or demo the app. Moving the app onto the server
> ("cutover") is a later milestone (see the end of this page).

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
- **Officers** are not trusted because a client says so. Access comes only from an
  active row in `organization_members` for the organization that owns the report's
  jurisdiction. Only the server (service role / admin tooling) can write that table.
- **No client writes** to cases, inspections, officer evidence, outcomes, the reward
  ledger or audit events. Those changes will go through server-side functions that
  apply the existing domain rules (next milestones).
- Citizen and officer evidence are separate tables. Evidence rows store a
  `storage_path` in a **private** bucket (`citizen-evidence`, `officer-evidence`),
  never a device `file://` URI and never image bytes.
- The reward ledger, enforcement outcomes and audit events are append-only.

## Current limitations

- The app does **not** read or write Supabase yet (local store only).
- No login/sign-up screens; no auth session switching.
- No Storage buckets or uploads yet.
- No server-side functions for accepting cases, inspections, outcomes or rewards yet.
- Simulated parking stays local and is not part of the backend schema.
- No realtime, push/email delivery, payouts or provider integrations.

## What comes next

- **T8.2** — private Storage buckets + evidence uploads, server-side functions for
  report submission (report + case + pending reward atomically) and the officer
  lifecycle/outcomes (using the domain rules), auth wiring.
- **Backend cutover** (after T8.2) — the app's store reads and writes through
  `src/backend/repositories` instead of the local store, behind the same screens.
