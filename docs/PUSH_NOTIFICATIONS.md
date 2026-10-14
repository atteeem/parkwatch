# Push notifications (T9.2)

> Status (2026-10-14): the three T9.2 migrations are **applied to the
> development project** (`gmwssplqtjbrpvlvbjcs`) and verified there (schema,
> privileges, and `scripts/sql/t92-cloud-qa.sql`: 135/135, fully rolled back).
> The `push-dispatch` function is **not deployed**, no scheduler or webhook
> exists, no real push has been sent, EAS is not configured, and nothing has
> been tested on a phone. Recovery script: `supabase/rollback/20261014_t92_rollback.sql`
> (not run).

## Architecture

```
domain event (submit/complete/assign - existing server functions, unchanged rules)
  -> notifications row (the ONE notification domain; idempotency_key unique)
  -> trigger notifications_enqueue_push: push_outbox row if the type is pushable
       (pw_push_eligible: REPORT_VERIFIED, REPORT_REJECTED, CASE_ASSIGNED)
  -> push-dispatch Edge Function (trusted sender, service role, shared secret)
       claim (lease) -> generic message per enabled device -> Expo Push Service
       -> record tickets / failure -> backoff retry or final state
       -> receipts after 15 min (DeviceNotRegistered disables the device)
  -> device -> tap opens the record (same deep links as the in-app list)
```

| Piece | Where |
| --- | --- |
| Tables, trigger, registration + sender RPCs | `supabase/migrations/20261014000002_t92_push_notifications.sql` |
| Push wording + deep-link payload (shared with the app) | `supabase/functions/_shared/pushContent.ts` |
| Expo transport (send / receipts, error mapping) | `supabase/functions/_shared/expoPushTransport.ts` |
| Dispatch run (batching, idempotency, retries) | `supabase/functions/_shared/pushDispatch.ts` |
| HTTP handler (shared secret) / Deno entry | `supabase/functions/_shared/pushDispatchHandler.ts`, `supabase/functions/push-dispatch/index.ts` |
| App: runtime (expo-notifications), flow, provider, UI | `src/push/*` |
| App: register / unregister RPC client | `src/backend/push/pushDevicesClient.ts` (via `AppContext.pushDevices`) |

## Rules

**Citizen** (from `complete_case`, unchanged):

| Officer outcome | Citizen status | Reward | Push |
| --- | --- | --- | --- |
| CHARGE_ISSUED | VERIFIED | €5 released if pending | "Report verified" - "Your report was verified. €5.00 reward is now available." (reward sentence only when credited) |
| REPORT_REJECTED | REJECTED | voided | "Report rejected" - "Your report was reviewed and could not be approved. Open ParkWatch for details." |
| VEHICLE_MOVED / VALID_PERMIT / DUPLICATE / OTHER | unchanged (under review) | voided | **none** (no citizen notification exists, so nothing can be pushed) |

`REPORT_UNDER_REVIEW` (on submit) stays in-app only.

**Officer**: `CASE_ASSIGNED` (supervisor assign / reassign) -> "New case assigned" -
"Open ParkWatch to review the case." (high priority, 1 h TTL). The previous officer
of a reassignment / return to queue gets `CASE_ASSIGNMENT_REMOVED` **in-app only**.
An officer's own actions (accept, completion) are never pushed.

**Lock-screen privacy**: titles/bodies are built from the type only. Never in a
push: evidence URLs/paths, citizen identity, location, plate, notes, audit data,
signed URLs. The data payload carries only `{v, notificationId, type, role,
reportId | caseId}`; the screen loads the record through the normal access checks.

## Device registration

* Permission education card (`PushEducationCard`): after a citizen's report is
  sent, in Notifications (both roles), and on the officer home. The OS prompt is
  shown only after **Turn on notifications** is tapped; **Not now** is remembered
  per account on the device. Settings (citizen) / Profile (officer) show the state.
* `register_push_device(installation_id, token, platform)` - bound to `auth.uid()`
  (citizen/officer profiles only); idempotent per (user, installation); a token or
  installation moves to the account now signed in on that device (the previous
  account stops receiving there). Multiple devices per user.
* Installation id: random 128-bit value stored in app storage on first use (not
  an advertising or hardware id; reinstall = new id).
* Token refresh (`addPushTokenListener`) re-registers; every launch/foreground
  (at most once a minute) re-syncs silently if permission is granted.
* Sign-out: `unregister_push_device` runs while the session is still valid
  (`AuthStore.onBeforeSignOut`, bounded to 3 s; never blocks sign-out). If it
  cannot reach the server, the next sign-in on the device moves the registration.
* Account deletion: `push_devices.user_id` cascades with the profile.
* Clients cannot read or write `push_devices`, `push_outbox`, `push_tickets`
  (no privileges), and cannot call the sender RPCs (service role only).

## Delivery, idempotency, failures

* One outbox row per notification (`notification_id` unique); notifications are
  already idempotent per domain event, so retries of `complete_case` /
  `admin_assign_case` never queue a second push.
* A claimed row is leased (2 min); a device that already has a ticket for the row
  is never sent the same notification again.
* Per-device: `DeviceNotRegistered` (ticket or receipt) and malformed tokens
  disable the device; `MessageRateExceeded` is retried; other errors are final for
  that device.
* Whole request: network / timeout / 429 / 5xx -> retry with backoff (30 s, 1, 2,
  4 min), at most 5 attempts; 400 / 401 / mixed projects -> FAILED. Pushes older
  than 24 h are never sent (`EXPIRED`). Only short codes are stored; raw provider
  responses are never kept or shown.
* The enqueue trigger swallows its own errors: a push problem can never fail
  report submission, assignment or case completion.

## Expo / app requirements (before real push QA)

* Remote push does **not** work in Expo Go on Android (SDK 53+). Real QA needs a
  development build (EAS Build) for Android and/or iOS.
* `app.json` has no EAS `projectId` yet; `getExpoPushTokenAsync` needs it
  (`npx eas init` adds `extra.eas.projectId`). Without it the app shows
  "Not available in this app build" and keeps in-app notifications.
* Android: FCM V1 credentials uploaded to EAS (Firebase project +
  `google-services.json`). iOS: paid Apple Developer account, APNs key via EAS.
* Android channel `parkwatch-updates` is created before the permission prompt.

## Local testing

* `npm test` - fake transport and fake store only (`supabase/functions/_shared/__tests__/pushDispatch.test.ts`,
  `src/push/__tests__/*`). Nothing is sent.
* `npm run verify:migrations` - `scripts/verify-t92.mjs`: registration, RLS,
  sender API, outcome rules, retries, receipts, expiry, assignment.
* Mock backend: `POST /__mock/push-outbox` lists what WOULD be pushed (types,
  recipient emails, status - no tokens). `POST /__mock/age-case` ages a case.
* Real push (explicit opt-in, after approved deployment):
  `PARKWATCH_RUN_PUSH_QA=1 node scripts/push-dispatch-smoke.mjs`.

## Deployment

How the migrations were applied: the development project's migration history
does not match the local file names (earlier migrations were applied outside
the CLI), so `supabase db push` would try to re-run every old migration. Each
T9.2 file was instead executed on its own with
`npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f <file>`,
wrapped in `begin; ... commit;` together with its row in
`supabase_migrations.schema_migrations` (version = file prefix).

Real-cloud database QA (repeatable, leaves nothing behind):

```bash
npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f scripts/sql/t92-cloud-qa.sql
```

Dry run of the same script on PGlite: `node scripts/run-t92-cloud-qa-local.mjs`.

Remaining steps (each needs approval):

1. ~~Apply migrations in order: `20261014000001`, `20261014000002`, `20261014000003`.~~ Done on the development project.
2. Secrets: `PUSH_DISPATCH_SECRET` (random >= 32 chars), optional `EXPO_ACCESS_TOKEN`.
3. Deploy: `npx supabase functions deploy push-dispatch --project-ref gmwssplqtjbrpvlvbjcs --no-verify-jwt`
   (the shared secret header is the authentication; the function is not called by the app).
4. Trigger: a Database Webhook on `push_outbox` INSERT -> `push-dispatch` with header
   `x-parkwatch-dispatch-secret`, plus a once-a-minute schedule (Supabase Cron /
   `pg_cron` + `pg_net`, secret from Vault) for retries and receipts.
5. EAS project + development builds + FCM/APNs credentials, then phone QA.
