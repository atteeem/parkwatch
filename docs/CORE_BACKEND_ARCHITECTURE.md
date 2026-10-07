# Core backend architecture (T8.3, hardened in T8.4)

How the citizen and officer core workflow runs when a Supabase backend is
configured (BACKEND mode). Without configuration the app stays in the local
investor demo (LOCAL_DEMO) exactly as before.

> Status: verified offline only — against the real migrations in an in-process
> Postgres (PGlite), a local mock of the Supabase endpoints, and the web build.
> It has **not** been verified against a real Supabase cloud project or on a
> physical phone yet (see "Verification log" below and REAL_DEVICE_QA.md).

## Principle: the server owns the workflow

Every sensitive state change is a database function (`supabase/migrations/20261007000001_core_workflow.sql`)
that applies the domain rules atomically, as the signed-in user. The app only asks.

| Operation | Function | Decided by the server |
| --- | --- | --- |
| Submit report | `submit_report` | owner (auth.uid), report number, status, priority, receipt time, jurisdiction, case creation, pending reward (amount from `app_settings`), notification, audit |
| Accept case | `accept_case` | assignment (first officer wins; others get `CASE_TAKEN`), NEW → EN_ROUTE |
| Start route / inspection | `start_en_route`, `start_inspection` | allowed transitions; four unanswered checks |
| Checks, plate confirm | `set_inspection_check`, `confirm_plate_by_scan` | only the assigned officer, only while inspecting |
| Officer photo | `add_officer_evidence` | object must exist under `<case>/`; one row per slot; CAMERA |
| Outcome | `complete_case` | allowed-from table, CHARGE readiness (4 YES + 4 photos), charge amount (`app_settings`, 6000 cents), report status, reward release/void, notifications, audit; idempotent |
| Read | `get_core_snapshot` | SECURITY INVOKER: exactly what Row Level Security lets the caller see |
| Mark read | `mark_my_notifications_read` | only the caller's notifications |

Clients cannot write `reports`, `report_evidence`, `officer_cases`, `inspections`,
`reward_ledger`, `enforcement_outcomes`, `audit_events` or `notifications`
directly (privileges revoked / no policies). No function takes a citizen id,
status, report number, receipt time, reward or charge amount, or officer
assignment as a parameter. Rule failures are raised as `CODE: message`.

### Outcome consequences

| Outcome | Case | Citizen report | Reward | Citizen notification | Officer notification |
| --- | --- | --- | --- | --- | --- |
| CHARGE_ISSUED | COMPLETED | VERIFIED | released (5.00 available) | REPORT_VERIFIED | PARKING_CHARGE_ISSUED (60.00) |
| REPORT_REJECTED | COMPLETED | REJECTED | voided | REPORT_REJECTED | CASE_CLOSED_WITHOUT_CHARGE |
| VEHICLE_MOVED / VALID_PERMIT / DUPLICATE / OTHER | COMPLETED | unchanged (under review) | voided | none | CASE_CLOSED_WITHOUT_CHARGE |

## Private evidence

- Buckets `report-evidence` and `officer-evidence` are **private** (10 MB, image types).
- Paths: `report-evidence/<citizen uid>/<submission id>/<evidence id>.<ext>`,
  `officer-evidence/<case uuid>/<capture id>.<ext>`. Storage policies check the
  path owner / case assignment / enforcement membership.
- Photos are displayed through **signed URLs** (1 hour, re-signed on refresh when
  close to expiry). The app never calls `getPublicUrl`.
- Uploads use `upsert: false`. Report paths are deterministic per evidence id,
  so a retry re-uses the object ("already exists" counts as uploaded).
- Cleanup: if an upload or the server call fails, the app removes what that
  attempt uploaded. Attached evidence cannot be deleted (policy), so a lost
  response followed by a retry still finds the report. A retaken officer
  photo replaces its slot and the old object is removed.

## T8.7 additions

- **Report location provenance.** `latitude/longitude` is the report point officers
  navigate to. `location_source` says where it came from: `GPS` (the device fix;
  `location_accuracy_m` / `location_captured_at` describe it) or `MAP_SELECTED` (the
  citizen corrected it on the map; accuracy/time must be null, enforced by
  `reports_map_point_not_gps`). Data minimization: after a map correction the
  citizen's original GPS fix is NOT stored on the server; it lives only in the unsent
  local draft (for "Use my GPS") and is dropped when the report is created. A point
  with a null source is older data (GPS). The address is reverse-geocoded on the phone (expo-location); typing is the
  fallback. `observed_at` = earliest required camera photo (device clock, read-only for
  the citizen); `received_at` stays the trusted server time.
- **Officer evidence types** are `VEHICLE_FRONT`, `LICENSE_PLATE`, `PARKING_SIGN`,
  `VEHICLE_REAR` (renamed in place from `VEHICLE_OVERVIEW` / `VIOLATION_CONTEXT`;
  local demo data is migrated v4 → v5 the same way).
- **Monthly statistics**: `get_officer_monthly_stats(from, to, time_zone)` counts the
  outcomes the signed-in officer decided (SECURITY INVOKER + `decided_by = auth.uid()`),
  with per-day buckets in the officer's zone. The app never derives these from loaded
  pages. Only recorded data: no response times, distances, money or scores.
- **Profile pictures**: private bucket `profile-avatars`, objects under
  `<user id>/<file>.jpg`, readable/writable/deletable only by their owner. The profile
  stores only the path (`avatar_storage_path`, not client-writable); `set_my_avatar`
  validates own folder + uploaded object and returns the replaced path, which the app
  deletes. Images are cropped square and resized to 512 px JPEG on the phone before
  upload; shown via a 1-hour signed URL. Local demo: kept on the phone only.

## App layers

```
app/ screens ── useApp() ──► src/context/AppContext.tsx   (the ONE core data boundary)
                              ├─ LocalAppProvider   (LOCAL_DEMO: src/store, sync actions)
                              └─ BackendAppProvider (BACKEND: src/backend/core, async actions)
src/backend/core/coreBackendStore.ts   per-user snapshot + status + actions
src/backend/operations/                RPC wrappers + "CODE: message" → domain error codes
src/backend/storage/evidenceStorage.ts upload / remove / signed URLs (only storage user)
src/backend/mappers/snapshot.ts        snapshot rows → domain ParkWatchState
```

- Screens never import `src/backend` or `@supabase/*` (source-tested).
- Backend rows become the same domain state the local store uses, so every
  selector/view model is shared. A report's domain id is its public number;
  server reward keys are re-keyed to the domain form when loaded.
- **Action contract:** every core action returns `ActionResult<T>` =
  `Result<T> | Promise<Result<T>>`. Screens run actions through
  `useGuardedAction` (double-tap protection, `busy` while pending) or `settle()`.
  A failed action never changes local data (nothing optimistic) and keeps the
  user's input (draft, selection, notes) for a retry.
- **Errors:** typed codes (`NETWORK_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`,
  `UPLOAD_FAILED`, `CASE_TAKEN`, `INSPECTION_NOT_READY`, …); wording comes only
  from `src/presentation/errors.ts`. Raw server text is never shown.

## Reads: paginated and filtered on the server (T8.4)

The capped `get_core_snapshot()` is no longer used by the app. Reads come from
`supabase/migrations/20261008000001_paged_reads.sql` (all SECURITY INVOKER: RLS
decides what is returned):

| Screen | Function | Paging |
| --- | --- | --- |
| My Reports (tabs), Home latest, citizen map | `page_my_reports(status)` | keyset (submitted_at, id), 25 per page, max 50 |
| Notifications (both roles) | `page_my_notifications` | keyset (created_at, id) |
| Queue (All / New / High Priority / Assigned), officer home cards, officer map | `page_officer_queue(filter, lat, lng)` | offset; nearest first when a position is known, else priority, newest |
| My Cases (All / Completed / Issued / Rejected) | `page_my_cases(tab)` | keyset (completed_at or report time, id) |
| Counts on every screen | `get_citizen_summary`, `get_officer_summary` | — |
| Detail screens / deep links | `get_case_detail`, `get_my_report` | — |
| Wallet / earnings | `get_my_ledger` (own rows only) | not paged (small) |

- **Filters run before paging**, so "No High Priority reports" or an empty
  Rejected tab is only shown when the server has none. Counts never come from a
  loaded page.
- The store keeps a merged row cache plus, per list, the ordered ids of its pages.
  "Show more" loads the next page; rows that move between pages are shown once.
- Refresh (pull, focus, foreground, after an action) reloads **page 1** of every
  list in use and drops stale cursors; a page that arrives after a newer page 1
  is discarded. After a fully successful refresh the cache is rebuilt from only
  what the server just returned, so rows the user may no longer see (revoked
  membership, other area) disappear. A case detail that comes back empty is
  removed instead of shown stale.
- A list shown again (switching back to a tab/filter) keeps its pages for a few
  seconds; after that it starts over at page 1, so old pages are never presented as
  current. Each filter/tab is its own list: a slow page of one filter can never land in
  another, and empty states wait for the first page to settle.
- Detail screens load their case/report on open (`useCaseDetailLoad`,
  `useReportDetailLoad`) and show "Loading…" rather than "not found" meanwhile.

## Unsent drafts, retries and uploads (T8.4)

- **Draft persistence (BACKEND):** `ReportContext` stores the unsent draft per
  signed-in user (`parkwatch.unsentReport.v1.<user id>`): the immutable draft id,
  photos (local URIs + metadata), violation, location text + GPS, notes,
  attachments, and which uploads finished. Home shows **Unfinished report** with
  *Continue unfinished report* and *Discard* (confirmation). Starting a new report
  continues it rather than replacing it. Cleared after the server accepts the
  report, or on Discard. Nothing uploads in the background. Another account never
  sees (or overwrites) it. LOCAL_DEMO is unchanged (memory only).
- **One submission id:** the draft id is the server submission id on every attempt,
  after timeouts, network loss, backgrounding and app restarts. `submit_report`
  returns the existing report when it already committed (`created: false`), so a
  lost response never creates a second report.
- **Upload recovery:** paths are deterministic per capture
  (`<uid>/<draft id>/<draft id>-<slot>-<capture time>.<ext>`; a retake gets a new
  path). Finished uploads are recorded and skipped on retry; "already exists" also
  counts as uploaded. **Nothing is deleted on a transient failure.** Orphans are
  removed only after success (uploads of this submission not in the final report,
  e.g. a retaken or removed photo) or on Discard. Storage policies refuse deleting
  evidence attached to a report, so a created report's photos can never be removed.
- **Timeouts:** every request has a client timeout (20 s; uploads 90 s). A timeout is
  an *unknown* result, not a failure.

## Ambiguous results (T8.4)

A network failure on a mutation means "the server may or may not have done it".
For `accept_case`, `start_en_route`, `start_inspection`, check changes, plate
confirmation, officer photos and `complete_case`, the store re-reads the case:

- the change is there → success (Complete → shown as the completed case, not as a
  second fake failure);
- a **different** outcome is there → `ALREADY_COMPLETED`;
- not there → the network error stands; retrying is safe (idempotent functions);
- the case cannot be re-read either → `RESULT_UNKNOWN` ("The connection dropped
  before the server answered… the app will check what was already saved").

Rule refusals (`CASE_TAKEN`, `INVALID_TRANSITION`, …) also re-read the case so the
screen shows the true state. Submission is reconciled by its idempotent retry.

## Signed URL expiry (T8.4)

Signed URLs last 1 hour and are re-signed on refresh when they expire within
5 minutes. If an image still fails to load, `EvidencePhoto` asks for a fresh URL for
that object (at most once a minute per object, so no loops) and shows "Photo
unavailable" only meanwhile or if re-signing fails. Signed URLs live in memory only;
the stored identity is always the storage path.

## Session expiry (T8.4)

An `UNAUTHENTICATED` answer (RPC, or storage 401) asks the auth layer to re-check the
session; if it is gone the user is signed out with "Your session has ended. Please
sign in again." The unsent citizen draft stays on the phone and is offered again after
signing in as the same user. Unauthorized mutations are refused by the server anyway.

## Loading and refresh

- `CoreDataGate` (citizen and officer layouts, BACKEND only): loading screen on
  first load; error screen with **Try Again** / Sign out if the first load fails —
  never demo data instead; a "Couldn't refresh · Retry" banner if a later
  refresh fails (the last data stays visible).
- Refresh triggers: first load, every screen change (skipped if < 5 s old),
  app foreground, pull-to-refresh on list screens, and after every successful
  action. **No polling.** Concurrent refreshes share one request.
- Sign-out / account switch disposes the store, so nothing leaks between accounts.

## Mode differences

| | LOCAL_DEMO | BACKEND |
| --- | --- | --- |
| Data | local persisted store + seed | server pages + counts (RLS) |
| Lists | complete (one "page") | paginated, filtered on the server |
| Unsent draft | memory only | persisted per user until sent/discarded |
| Actions | synchronous | server functions (async) |
| Withdrawals | simulated request | **disabled**: "Withdrawals are not available in the backend preview yet." |
| Parking | local simulation | local simulation (per signed-in user id) |
| Reporter statistics | demo display profiles | not shown ("Not rated") — none exist yet |
| Demo tools / role switch | dev builds only | never |

## Testing offline

- `npm run verify:migrations` — applies all migrations to PGlite and runs 216
  scenarios as real roles (`scripts/verify-migrations.mjs`, `verify-t83.mjs`, `verify-t84.mjs`).
- `npm run test:cloud-smoke` — optional real-cloud smoke test (development project only).
- `npm run mock:backend` — `scripts/mock-supabase-backend.mjs`: auth, RPC
  passthrough executed as the signed-in user, and private storage with signed
  URLs, all on the real migrations. Test accounts are in the file header.
- `src/backend/__tests__/coreBackend.integration.test.ts` drives the real
  supabase-js client and the app's backend modules against that mock.
- `scripts/dev-web-backend.mjs` starts the web app in BACKEND mode against the
  mock; `scripts/mock-camera-steps.mjs` performs the camera steps for browsers
  without a camera.

The mock is not Supabase (unsigned tokens, in-memory). Passing against it is
not a substitute for verifying a real project.

## Verification matrix

| Category | Status | What it covers |
| --- | --- | --- |
| DB verifier (PGlite, real migrations, Supabase default privileges) | **VERIFIED** | 224 scenarios: RLS, grants, function EXECUTE privileges, storage policies, workflow functions, outcomes, paged reads, summaries, other org / inactive / anonymous |
| Mock backend (real SQL + real supabase-js, Jest integration) | **VERIFIED** | submit, idempotent retry, lost responses after commit (submit/accept/complete), restart mid-upload, pagination + server filters, revoked membership (lists + detail), session expiry |
| Unit tests (store, drafts, guards, mapping, source security) — Jest 684/684 | **VERIFIED** | paging, filter switching, refresh reset, cache pruning, reconciliation, upload recovery, signed URL refresh, draft persistence |
| Browser (web build vs mock) | **VERIFIED** | officer and citizen walkthroughs, draft recovery across reload, offline banner / offline launch, LOCAL_DEMO regression (see REAL_DEVICE_QA.md section A) |
| Real Supabase project | **VERIFIED** (T8.5) | real-cloud QA suite **26/26** + cloud smoke 26/26 on the development project: citizen submit, officer charge with photos, consequences, all outcomes, accept race, RLS + private storage, pagination, lost responses, signed URL expiry, invalid token. Not run there: other-org / inactive / metadata-spoof accounts, audit rows (REAL_DEVICE_QA.md section B) |
| Physical phone | **NOT VERIFIED** | no device was used; camera, GPS, native maps, permissions, backgrounding, Android Back all NOT RUN (REAL_DEVICE_QA.md section C) |

The browser walkthrough used DOM-dispatched clicks (the preview pane did not render)
and a helper for camera steps; it verifies screen logic and server integration, not
native rendering, camera, GPS or maps.

## Known limitations (T8.5)

- Not verified on a physical phone.
- Supabase access tokens stay valid until they expire, even after sign-out (observed on
  the real project); the app discards them on sign-out. Shorten the JWT expiry in the
  project's Auth settings if tighter revocation is needed.
- No reporter statistics in backend mode ("Not rated").
- Parking remains local (simulated on the phone; not part of the backend).
- Jurisdiction is a single configured default (`app_settings.default_jurisdiction_id`,
  development routing); no geographic routing yet (`NO_JURISDICTION` if unset).
- No withdrawals/payouts on the server; no realtime/push (refresh on focus/foreground).
- The officer and citizen maps show the loaded list pages, not every row.
- Queue paging uses offsets (distance order has no stable keyset): rows can shift
  while paging; duplicates are removed, a shifted row may need a refresh.
- The citizen's own ledger is loaded in full for wallet/earnings.
- Local photo files of an unsent draft live in the app's cache; if the OS clears it,
  those photos must be retaken (the upload fails clearly; nothing is lost silently).
- Orphaned objects are possible if cleanup itself fails (private, unreadable to others).

## T8.8 additions (presentation only, no migration)

- **Onboarding preference** is a device setting (AsyncStorage key
  `parkwatch.onboarding.v1`), never stored in Supabase; same in both modes.
- **Citizen report detail** (`src/presentation/citizenReportDetail.ts`) reads only
  existing report fields (`received_at`, `resolved_at`, status, evidence, location
  provenance) and the reward ledger. The timeline shows citizen statuses only; the
  four non-citizen outcomes add no step. Report events from `audit_events` are not
  loaded in BACKEND mode, so the decision time comes from `resolved_at`.
- **Notification deep links** (`src/navigation/notificationTargets.ts`) use only ids
  carried by the notification. In BACKEND mode notifications are server-scoped to
  the user, so a well-formed public report number / case uuid is opened and the
  detail screen loads it (safe "not available" state if it cannot).
- **Unread badges** use `citizenSummary.unread` / `officerSummary.unread`
  (server-side counts in BACKEND), capped at "99+".

