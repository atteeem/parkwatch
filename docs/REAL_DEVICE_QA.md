# Real device + real cloud QA (T8.4)

What has been verified, and the exact checklists that still need a **real development
Supabase project** and **physical phones**.

> **Status at the end of T8.4**
>
> - REAL SUPABASE: **NOT VERIFIED** (no project was configured)
> - REAL PHONE: **NOT VERIFIED** (no device was available to the developer tooling)
>
> Every checkbox in sections B and C is intentionally left unchecked. Do not infer
> them from the offline/browser results in section A.

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

## B. Requires a real Supabase development project

Prepare with [BACKEND_SETUP.md](BACKEND_SETUP.md) → "Development cloud setup checklist".

### B1. Project + data
- [ ] All 5 migrations applied in order without error.
- [ ] Verification SQL: RLS on every public table; both buckets `public = false`;
      trigger `on_auth_user_created` exists; `default_jurisdiction_id` set; no SECURITY
      DEFINER function without `search_path`.
- [ ] Accounts: Citizen A, Citizen B, Officer (org A, active), Officer (org B),
      inactive Officer, citizen with `role: OFFICER` in user metadata.
- [ ] Optional: `npm run test:cloud-smoke` (see BACKEND_SETUP.md) → `failed: 0`;
      note the `manualCleanup` output.

### B2. Security on the real project
- [ ] Citizen A cannot read Citizen B's reports, photos, wallet or notifications.
- [ ] Citizen cannot read the officer queue or officer photos.
- [ ] Citizen cannot call accept / start route / start inspection / checks / complete
      (FORBIDDEN).
- [ ] Citizen cannot insert into reports, officer_cases, enforcement_outcomes,
      reward_ledger, audit_events (permission denied).
- [ ] Officer of org B does not see org A cases.
- [ ] Deactivated officer loses access (lists empty, actions refused) after refresh.
- [ ] Metadata-"officer" gets the citizen app only.
- [ ] Photo URLs only work as signed URLs; `/storage/v1/object/public/...` fails.

### B3. Cloud consequences (check in Dashboard → Table editor)
- [ ] After a citizen submit: one report owned by the auth user, public number set,
      one NEW case, REWARD_PENDING 500, audit rows, 3 objects in `report-evidence`.
- [ ] After CHARGE_ISSUED: case COMPLETED, outcome charge 6000, report VERIFIED,
      REWARD_RELEASED once, one REPORT_VERIFIED + one PARKING_CHARGE_ISSUED notification.
- [ ] After REPORT_REJECTED: report REJECTED, REWARD_VOIDED, REPORT_REJECTED notification.
- [ ] After VEHICLE_MOVED: case COMPLETED, report still UNDER_REVIEW, REWARD_VOIDED,
      **no** citizen outcome notification.
- [ ] Optional: VALID_PERMIT, DUPLICATE, OTHER behave like VEHICLE_MOVED for the citizen.

---

## C. Requires physical phones (with the real project from B)

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
