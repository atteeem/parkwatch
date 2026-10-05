# Core backend architecture (T8.3)

How the citizen and officer core workflow runs when a Supabase backend is
configured (BACKEND mode). Without configuration the app stays in the local
investor demo (LOCAL_DEMO) exactly as before.

> Status: verified offline only — against the real migrations in an in-process
> Postgres (PGlite) and a local mock of the Supabase endpoints. It has **not**
> been verified against a real Supabase cloud project yet.

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
| Data | local persisted store + seed | server snapshot (RLS) |
| Actions | synchronous | server functions (async) |
| Withdrawals | simulated request | **disabled**: "Withdrawals are not available in the backend preview yet." |
| Parking | local simulation | local simulation (per signed-in user id) |
| Reporter statistics | demo display profiles | not shown ("Not rated") — none exist yet |
| Demo tools / role switch | dev builds only | never |

## Testing offline

- `npm run verify:migrations` — applies all migrations to PGlite and runs ~200
  scenarios as real roles (`scripts/verify-migrations.mjs`, `scripts/verify-t83.mjs`).
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

## Known limitations (T8.3)

- Not verified on a real Supabase project or on a phone in BACKEND mode.
- Jurisdiction is a single configured default (`app_settings.default_jurisdiction_id`);
  no geographic routing yet (`NO_JURISDICTION` if unset).
- No withdrawals/payouts on the server; no realtime/push; snapshot is capped
  (300 reports/cases, 200 notifications).
- Orphaned objects are possible if cleanup itself fails (private, unreadable to others).
