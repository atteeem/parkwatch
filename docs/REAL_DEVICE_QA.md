# Real device + real cloud QA (T8.4, real cloud completed in T8.5)

What has been verified, and the exact checklists that still need a **real development
Supabase project** and **physical phones**.

> **Status at the end of T8.5**
>
> - REAL SUPABASE: **VERIFIED** — real-cloud QA suite 26/26 and cloud smoke 26/26 on the
>   development project (section B; items marked NOT RUN are not claimed)
> - REAL PHONE: **NOT VERIFIED** — no physical device was used; every item in section C
>   is NOT RUN
>
> Do not infer section C from the browser results in section A or the cloud results in B.

---

## A. Verified automatically / in the browser (offline)

These ran against the REAL migrations in an in-process Postgres (PGlite), a local mock
of the Supabase endpoints (`npm run mock:backend`), and the web build. They are **not**
a real Supabase project and **not** a phone.

| Area | How | Result |
| --- | --- | --- |
| Migrations, RLS, grants, storage policies, workflow functions, paged reads | `npm run verify:migrations` (216 scenarios as citizen / officer / other org / inactive / anonymous) | pass |
| Store logic: paging, filters, refresh, drafts, uploads, reconciliation, signed URLs, cache pruning | Jest unit tests | pass |
| App backend modules with real supabase-js vs the mock: submit, retry, lost responses, restart mid-upload, pagination across pages, accept race, outcomes, revoked membership, session expiry | Jest integration | pass |
| Draft persistence: restore after restart, discard, account isolation, LOCAL_DEMO unchanged | Jest (ReportProvider) | pass |
| Cloud smoke script logic (gating, flow, cleanup listing) | run against the mock | pass |
| Officer UI (web, mock backend): home → queue → details → accept → en route → map → start inspection → tri-state checklist → plate confirm → photo slots (camera steps via helper) → reload mid-inspection → result → charge → completed → cases; desk reject; notifications; profile; role guard; sign out | browser, DOM-dispatched clicks (preview pane hidden) | pass |
| Citizen UI (web, mock backend): sign in, home counts, reports, notification → report, earnings (withdrawal disabled), unfinished-draft persist → reload → continue → discard, refresh-failure banner, offline launch (no demo data) | browser | pass |
| LOCAL_DEMO regression (citizen + officer) | browser | pass |

Not covered by section A: native camera, native maps, GPS, OS permissions, Android
Back, real backgrounding, real network loss on a phone, real Supabase Auth/Storage.

---

## B. Real Supabase development project — VERIFIED (T8.5)

Final run: **26/26 passed** (`PARKWATCH_RUN_CLOUD_QA=1 npm run test:cloud-qa`, run id
`261007072404`, 2026-10-07) against the real development project, plus the cloud smoke
test **26/26**. The suite drives the app's real backend modules (core store, server
operations, private storage) with real Supabase Auth, PostgREST, Postgres RLS and
Storage. Markers: **PASS** = checked on the real project; **NOT RUN** = not covered by
the real-cloud run (no claim is made).

### B1. Project + data
- **PASS** — migrations 1–6 applied (1–5 + seed via SQL editor, then migration 6; the
  project's migration history lists only `core_schema`, so objects were verified
  directly instead of by history).
- **PASS** — RLS on every public table, both evidence buckets private, seed present,
  `default_jurisdiction_id = helsinki-demo` (verified by the project owner).
- **PASS** — after migration 6: anonymous callers get `permission denied` on every helper
  and app function and every ParkWatch table (probed against the real API).
- **PASS** — accounts CitizenA, CitizenB (CITIZEN), OfficerA, OfficerB (OFFICER + active
  membership); server-side roles confirmed by the suite; sign-up trigger created the
  citizen profiles.
- **NOT RUN** — second-organization officer, inactive officer and a citizen whose user
  metadata claims OFFICER (accounts not created on the real project; covered offline only).
- **PASS** — cloud smoke test 26/26.

### B2. Security on the real project
- **PASS** — Citizen A cannot read Citizen B's report, evidence rows, evidence files
  (signing refused), rewards or notifications.
- **PASS** — citizens see no officer queue, cases, inspections, outcomes or officer
  photos; officer summary is zero for a citizen.
- **PASS** — citizens cannot accept / start route / start inspection / answer checks /
  confirm plate / add officer evidence / complete (FORBIDDEN).
- **PASS** — citizens cannot insert into reports, officer_cases, enforcement_outcomes,
  reward_ledger, audit_events, notifications; a direct status update has no effect.
- **PASS** — officers cannot read citizens' rewards, notifications or other profiles.
- **PASS** — Officer B cannot start inspection / complete on a case assigned to Officer A
  (CASE_TAKEN); an unassigned officer cannot upload officer evidence for a case.
- **PASS** — private storage: own and same-organization enforcement access only; no
  cross-citizen access; citizens cannot upload into another user's folder or into
  officer evidence; `/storage/v1/object/public/...` fails for both buckets.
- **NOT RUN** — officer of another organization; deactivated officer; metadata-"officer"
  (no such accounts on the real project; all three pass in the offline verifier).

### B3. Cloud consequences
- **PASS** — citizen submit through the app store: exactly one report owned by the auth
  user, server public number, `helsinki-demo`, 3 private evidence objects under
  `<uid>/<draft id>/`, one NEW case, REWARD_PENDING 500; the report survives a restart
  (fresh session reads it from the cloud).
- **NOT RUN** — audit rows (clients cannot read `audit_events` by design; check in the
  Dashboard if needed).
- **PASS** — CHARGE_ISSUED by Officer A after accept, inspection (tri-state check
  changes), plate confirm, 4 private officer photos + a retake (old object removed):
  case COMPLETED with lifecycle timestamps, outcome CHARGE_ISSUED **6000** (server),
  report VERIFIED, REWARD_RELEASED exactly once, exactly one REPORT_VERIFIED and one
  PARKING_CHARGE_ISSUED notification; citizen evidence renders via signed URL.
- **PASS** — repeating the charge changes nothing; a different outcome → ALREADY_COMPLETED.
- **PASS** — REPORT_REJECTED: report REJECTED, REWARD_VOIDED, REPORT_REJECTED notification.
- **PASS** — VEHICLE_MOVED, VALID_PERMIT, DUPLICATE, OTHER: case COMPLETED, report still
  UNDER_REVIEW, REWARD_VOIDED, **no** citizen outcome notification.

### B4. Other real-cloud behaviour
- **PASS** — accept race: Officer A and B at once → exactly one winner (OfficerB in the
  final run), the other CASE_TAKEN, one assignment, one CASE_ACCEPTED notification.
- **PASS** — pagination with page size 2: citizen 17 reports over 9 pages = server count,
  no duplicates, Rejected tab = server count, 22 notifications paged; officer queue
  (5 open / 3 new), My Cases tabs and notifications match server counts; refresh resets
  to page 1.
- **PASS** — lost responses after commit: `submit_report` retry with the same id returns
  the same report (count +1 only, one pending reward); `accept_case` and
  `complete_case` reconciled from server state (one outcome, one notification).
- **PASS** — signed URL expiry: a 1-second test-only URL is refused after expiry (HTTP
  400); the app store re-signs (new URL loads, HTTP 200) and does not loop. App default
  TTL unchanged (1 hour).
- **PASS** — invalid access token: refused; the app maps it to UNAUTHENTICATED and asks
  the auth layer to re-check; nothing is created (after fix `66ba48d`).
- **PASS** — an invalid refresh token is rejected.
- **OBSERVED (known limitation)** — after sign-out (local and global) the *old access
  token* is still accepted (HTTP 200) until it expires: Supabase access tokens are
  stateless JWTs. The app drops the token on sign-out; shorten the project's JWT expiry
  if tighter revocation is needed.

### Defects found and fixed during real-cloud QA
| Commit | Defect | Fix |
| --- | --- | --- |
| `b6fc2b7` | anon could execute SECURITY DEFINER helpers (Supabase default privileges) | migration 6 + verifier models Supabase defaults |
| `400eeac` | the QA transport only spoke HTTP (suite could not reach the HTTPS project) | http/https by protocol, test-only |
| `66ba48d` | Storage "signature verification failed" (400/403/AccessDenied) was classified as an upload failure, so no session re-check | treated as UNAUTHENTICATED; RLS denials and bare 403 unchanged |

---

## C. Requires physical phones — NOT VERIFIED (all items NOT RUN)

Setup: local `.env` (anon key only) → `npx expo start` → Expo Go (SDK 57). Record
device model + OS for every run.

### C1. Citizen phone
- [ ] Sign in as Citizen A → Citizen Home with own name; no demo data.
- [ ] Foreground location permission prompt → Allow while using.
- [ ] GPS: coordinates + accuracy shown in Add Details / Review; in the Dashboard the
      report's `latitude/longitude/location_accuracy_m/location_captured_at` match
      the phone (± accuracy, capture time ≈ now).
- [ ] Native map renders with own position and report markers.
- [ ] Map recenter button and follow mode (pan away → recenter returns).
- [ ] Citizen camera opens in the report flow.
- [ ] FRONT, SIDE and REAR photos captured; retake one → slot shows the new photo.
- [ ] Attachment import from the photo library; remove it again.
- [ ] Submit shows "Uploading photos…" then "Submitting…".
- [ ] Press Home during upload, return → upload continues or can be retried; no
      corruption; exactly one report in the end.
- [ ] Submit succeeds → Report Submitted `#number` → My Reports "Under Review".
- [ ] Unfinished draft: take 2 photos + select violation → force-close → reopen →
      "Unfinished report" → Continue → photos and violation still there; same report
      created once when submitted (Dashboard: one row for that `source_draft_id`).
- [ ] Retry after network loss: airplane mode during upload → clear error + "saved on
      this phone" → network on → Try Again → only missing photos upload → one report.
- [ ] Signed images render in report overview; still render after > 1 hour (expiry).
- [ ] Notification "Report verified" opens the report.
- [ ] Wallet: pending €5 after submit; €5 available after the officer's charge;
      Withdraw disabled with "Withdrawals are not available in the backend preview yet."

### C2. Officer phone
- [ ] Sign in as Officer (org A) → Officer Home; counts match the Dashboard.
- [ ] Native map renders.
- [ ] Foreground officer location prompt → own position on the map; queue "Nearest".
- [ ] Case marker for the citizen's report; tap → case summary → details.
- [ ] Accept (button shows loading; double tap does not double-accept) → En Route.
- [ ] En Route screen: distance updates while moving (straight line).
- [ ] Start On-site Inspection.
- [ ] Tri-state checklist: tap → confirmed, tap → not confirmed, tap → unanswered;
      "Saving…" per row; values survive reopening.
- [ ] Confirm Plate marks the plate check confirmed.
- [ ] Four officer camera slots (overview, plate, sign, context) each capture a photo;
      retake one → replaced (Dashboard: old object removed).
- [ ] Background the app mid-inspection and return; force-close and reopen on the
      inspection screen → checks and photos restored from the server.
- [ ] Complete with Issue parking charge → Inspection Completed shows €60.00.
- [ ] Reject (desk) on another report → confirmation → case closed as rejected.
- [ ] Vehicle moved / not found (en route) on another report → closed.
- [ ] Notifications list; tap opens the case.
- [ ] Cases tab: All / Completed / Issued / Rejected correct; Show more if > 25.
- [ ] Sign out → Sign In; signing in as another officer shows none of the previous data.

### C3. Native edge cases
- [ ] Android hardware Back through the report wizard (Review → … → Photos → Home):
      no crash, draft kept.
- [ ] Android hardware Back on officer screens: returns sensibly, no stuck state.
- [ ] Location permission denied → app works with typed address / "Location off".
- [ ] Location permission blocked ("Don't ask again") → app explains and offers Settings.
- [ ] Camera permission denied → clear message, no fake photo; enabling in Settings works.
- [ ] GPS unavailable (location services off / indoors) → clear state, no crash.
- [ ] Network drops during photo upload → error, draft kept, retry uploads only the rest.
- [ ] Network drops right after the server commits (submit / accept / complete) → after
      reconnect + retry the app shows the committed result (same report number;
      case already accepted/completed), never a duplicate.
- [ ] Session expires mid-workflow (Dashboard → sign the user out, or revoke) → next
      server action → "Your session has ended. Please sign in again." → sign in as the
      same user → unfinished citizen draft offered again / officer inspection continues.
- [ ] App background / foreground → data refreshes on return (no polling while away).
- [ ] Cold restart (swipe away, reopen) → signed in, data from the cloud.

### C4. Results

| Area | Pass/Fail | Device / OS / notes |
| --- | --- | --- |
| Citizen camera + attachments | | |
| Citizen GPS + map | | |
| Submit, retry, unfinished draft | | |
| Officer map + location | | |
| Officer inspection + camera slots | | |
| Outcomes (charge / reject / moved) | | |
| Network interruption | | |
| Session expiry | | |
| Native edge cases | | |
| Real-cloud security (B2) | | |
