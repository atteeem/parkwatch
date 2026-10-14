# Operations console (T9.0)

A web-first oversight console (read-only except the T9.2 case assignment actions) for an enforcement organization's supervisors
and administrators to oversee the Citizen → Officer workflow during a pilot. It is
part of the same Expo Router app under `/admin` (desktop layout with a sidebar;
a scrolling tab bar on tablet/phone widths).

> REAL SUPABASE: the T9.0 migration is **not applied / not verified** on the real
> development project. Verified offline only (PGlite with the real migrations, the
> local mock backend, Jest). REAL PHONE: not verified (the console targets desktop web).

## Routes

| Route | What it shows |
| --- | --- |
| `/admin` | Overview: reports under review / received today, active cases by status, decisions today (completed, parking charges, rejected, closed without a charge), pending and released citizen rewards, last 7 days (received / completed) |
| `/admin/reports` | Reports with server-side filters (citizen status, priority, case active/completed, received date, report number or plate search) and paging |
| `/admin/reports/[number]` | Report detail: times (observed on device, submitted, received by server), location + map + point source, vehicle, notes, all citizen evidence (gallery), linked case and outcome, reward state + ledger, full history |
| `/admin/cases` | Cases with server-side filters (status NEW…COMPLETED, outcome, priority, assigned officer, created date, search) and paging |
| `/admin/cases/[id]` | Case detail: timeline, citizen + officer evidence, inspection checklist and officer notes, outcome, decision time, parking charge (only for `CHARGE_ISSUED`), history |
| `/admin/officers` | Members of the organization: name, role, active/inactive membership, active cases, completed this month |
| `/admin/rewards` | Reward ledger for the organization's reports (monitoring/reconciliation; no payments) |
| `/admin/audit` | Audit log of the organization's reports and cases (filters: actor, record type, date, report number / case id) |

## Who can use it

Only an account whose **server-set** profile role is `SUPERVISOR` or `ADMIN` **and**
which has an **active** `organization_members` row with `member_role`
`SUPERVISOR` or `ADMIN`. Both are written only by admin tooling (service role).

* Citizens, officers, inactive staff and staff without a membership are redirected
  away from `/admin` by the route guard and refused (`FORBIDDEN`) by every server
  function. The client-side guard is convenience; the server check is the boundary.
* Nothing in user-editable metadata, local storage or route parameters can grant access.
* **No global admin.** ADMIN is organization-scoped exactly like SUPERVISOR: the
  existing role model defines no wider authority, so none was invented.
* Local demo (no backend): a dev-only switch ("Operations console" in Demo tools)
  shows the console over the complete local store. Demo convenience, not security.

## Organization isolation

Every `admin_*` function derives the caller's organizations from `auth.uid()`
(`pw_console_org_ids()`) and only reads rows in those organizations'
jurisdictions. A report or case of another organization is indistinguishable from
a missing one (`null` → "not found"). Officer lists contain only the caller's
organization members. Evidence objects are readable only for the caller's
organization (two new storage SELECT policies; evidence stays in private buckets
and is shown through 1-hour signed URLs).

## Data shown — and not shown

* Citizens appear only as a **stable pseudonymous operational reference**
  (`C-xxxxxxxx`). It is derived deterministically from the account id, so the
  same citizen always has the same reference: it is linkable and is **not**
  anonymous. No names, emails or balances are shown, and citizen account ids are
  never displayed as console text. Note: evidence storage is account-scoped
  internally (object paths start with the account id); those paths are used only
  to issue short-lived signed URLs and are not rendered in the console, but they
  are present in the console's network plumbing.
* Officers: display name, role, membership state, workload counts. No location
  history or tracking.
* Money: integer cents; €5 qualifying reward, €60 mock/private parking charge.
  No revenue or "money collected": ParkWatch does not record charge payments.
* Rewards are counted **once per report** from its ledger state (pending →
  released/voided), never by summing ledger rows.
* Withdrawals, notifications and profile events are citizen-account data and are
  not part of the console.
* Audit metadata is reduced **on the server** to an allow-list of operational
  keys (`code`, `entry`, `amount_cents`, `charge_cents`, `check`, `answer`,
  `via`, `type`, `from`, `to`, `outcome`) before it leaves the database: ids
  (e.g. `case_id`), account ids, storage paths, URLs, tokens and any future key
  are dropped. The UI formats amounts as euros (e.g. "Parking charge · €60.00").

## Supervisor actions (T9.2)

The console is read-only except three case assignment actions (migration
`20261014000003_t92_case_assignment.sql`), all server-checked, organization-scoped
and audited:

| Action | Allowed when | Effect |
| --- | --- | --- |
| Assign | case is NEW | NEW -> ASSIGNED to an active OFFICER of the case's organization; the officer gets an in-app notification + push |
| Reassign | case is ASSIGNED and not started | another active officer; the new officer is notified + pushed, the previous officer gets an in-app update only |
| Return to queue | case is ASSIGNED and not started | ASSIGNED -> NEW; the previous officer gets an in-app update |

* **Not supported** once the officer has started (EN_ROUTE / ON_SITE / INSPECTION):
  the officer is travelling or holds evidence, and moving the case would invent a
  lifecycle transition. The console says so; contact the officer directly.
  COMPLETED is final.
* **Concurrency**: every write locks the case and requires the `assignment_version`
  the screen showed; a stale screen gets "This case changed since you opened it"
  and reloads. Repeating a successful request is a no-op (no second notification,
  push or audit row). If an officer accepts a NEW case at the same moment, whichever
  commits first wins and the other is refused.
* **Audit**: `CASE_ASSIGNED` / `CASE_REASSIGNED` / `CASE_UNASSIGNED` with the actor
  (SUPERVISOR/ADMIN), from/to status and from/to officer ids. The console shows
  officer **names** only (the server replaces the ids; the T9.0 allow-list still applies).
* No citizen notification is created by any assignment action.
* `assigned_at` is the time of the CURRENT assignment (reset on reassign, cleared on return).
* Memberships, priorities and outcomes are still not managed in the console.

## Needs attention (T9.2)

An open case that has been in its current status longer than a threshold is
marked **Needs attention** with the elapsed time (case list, case detail, overview
tile, "Attention" filter). Lifecycle timestamps only - no location or tracking, no
automatic reassignment. Thresholds (minutes) are server settings in `app_settings`
(defaults: NEW 30, ASSIGNED 20, EN_ROUTE 45, ON_SITE 20, INSPECTION 30), mirrored
for the local demo in `src/admin/attention.ts` (a test keeps them equal).

## Pagination and filtering

All list filtering, search and paging run on the server (`admin_page_*`, offset
paging with an exact total, 25 rows per page — 50 for the audit log — capped at
100 server-side). Changing a filter starts again at page 1; "Load more" fetches
the next server page. Nothing is filtered from rows already loaded.

## Local QA with the mock backend

```bash
npm run mock:backend
```

```bash
node scripts/mock-camera-steps.mjs pilot-data
```

Then run the web app against the mock (`node scripts/dev-web-backend.mjs`) and
sign in as `supervisor@example.test` / `admin@example.test` (organization A) or
`other-supervisor@example.test` (organization B), password `mock-password-1`.
`inactive-supervisor@example.test` shows the "access is not active" state.

## Not implemented (separate milestones)

Payment processing, payouts, bank accounts, parking-operator or municipality
integrations, automatic/AI enforcement, employee tracking, fraud scoring, push
infrastructure beyond T9.2 push (docs/PUSH_NOTIFICATIONS.md), workforce scheduling, automatic reassignment.

## Access refresh and evidence URLs

* If a staff membership is deactivated (or a role changes) while the console is
  open, the next console call is refused (`FORBIDDEN`); the app then re-resolves
  access from the server (profile + memberships) and the route guard moves the
  user to account status. A still-valid session is not signed out.
* Console evidence is shown through 1-hour signed URLs. If a photo fails to load
  (most likely an expired URL), the detail page re-loads itself once (60-second
  cooldown) to get freshly signed URLs from the same organization-scoped server
  call; repeated failures show "Photo unavailable" instead of retrying in a loop.

## Deployment

See `docs/BACKEND_SETUP.md` → "Dev-cloud deployment": migrations in filename order
before T8.7+/T9 clients; the officer evidence enum migration is a breaking cutover
done in one maintenance window with all officer devices updated; the console is
given to staff only after the T9 migration.

## Documented decisions (deferred)

* **Officer evidence enum cutover** (`20261010000002`): kept as a hard cutover for
  the pilot (no production users). No compatibility layer.
* **Supervisor officer-write rights** (pre-existing, T8.2): a SUPERVISOR profile with
  an active SUPERVISOR membership is also an enforcement member, so the server lets
  it use officer workflow functions (e.g. accept/complete a case) directly. The
  console itself is read-only and does not offer these actions. Whether supervisors
  keep officer write rights is a later role-policy decision.
* **Performance**: overview and reward summaries compute the per-report reward state
  for every report of the organization, and lists use offset paging with exact
  totals. Fine at pilot scale; aggregates/keyset paging can come later.
