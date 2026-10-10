# Operations console (T9.0)

A web-first, **read-only** console for an enforcement organization's supervisors
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

* Citizens appear only as a pseudonymous reference (`C-xxxxxxxx`): no names,
  emails, account ids or balances.
* Officers: display name, role, membership state, workload counts. No location
  history or tracking.
* Money: integer cents; €5 qualifying reward, €60 mock/private parking charge.
  No revenue or "money collected": ParkWatch does not record charge payments.
* Rewards are counted **once per report** from its ledger state (pending →
  released/voided), never by summing ledger rows.
* Withdrawals, notifications and profile events are citizen-account data and are
  not part of the console.
* Audit details never show storage paths, URLs, tokens or internal ids.

## Read-only

T9.0 adds no management actions. Reassigning cases or changing priority would need
proper authorization and concurrency rules on the server (and an audit trail of
supervisor actions); they were deliberately left out. Memberships are managed with
admin tooling, not in the console.

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
infrastructure, supervisor write actions.
