# Environments: development vs production

| | Local demo | Development | Preview / release candidate | Production |
| --- | --- | --- | --- | --- |
| Backend | none (data on the phone) | Supabase `gmwssplqtjbrpvlvbjcs` | Supabase `gmwssplqtjbrpvlvbjcs` (until a production project exists) | **not created yet** |
| How the app gets it | no `EXPO_PUBLIC_SUPABASE_*` (e.g. `EXPO_NO_DOTENV=1`) | local `.env` (Metro) or EAS env `development` | EAS env `preview` | EAS env `production` (empty) |
| App id | n/a (Expo Go) | `com.atteem.parkwatch.dev` | `com.atteem.parkwatch` | `com.atteem.parkwatch` |
| EAS build profile | - | `development` (dev client, APK) | `preview` (APK, internal) | `production` |
| Push | unavailable | FCM: `GOOGLE_SERVICES_JSON` (development) | needs Firebase app `com.atteem.parkwatch` | needs production Firebase/APNs |

Safety rails:

* `app.config.ts` refuses a `preview`/`production` EAS build without
  `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`, or with a secret key,
  so a release build can never silently fall back to the local demo.
* The app refuses service-role / secret keys at runtime (`src/backend/config.ts`).
* Demo tools and the role switch exist only in development builds (`__DEV__`).
* Development and production have different app ids, URL schemes
  (`parkwatch-dev://` vs `parkwatch://`) and EAS environments.

## Creating the production environment (needs Atte's accounts)

1. **Supabase**: create a new project (EU region). It has an empty migration history,
   so `npx supabase db push` against it applies `supabase/migrations` in order
   (do not use `db push` on the development project - see PUSH_NOTIFICATIONS.md).
2. **Server config**: `app_settings` (reward and charge amounts, default jurisdiction),
   organizations, jurisdictions and staff memberships with service-role tooling.
3. **Auth settings** (dashboard → Authentication):
   * Site URL and Redirect URLs: `parkwatch://auth/reset-password`
     (development project also `parkwatch-dev://auth/reset-password`);
   * email sender (custom SMTP) and the "Reset password" email template;
   * consider a shorter JWT expiry (sign-out cannot revoke issued tokens early).
4. **Functions**: `recognize-plate` (+ `PLATE_RECOGNIZER_API_TOKEN`) and `push-dispatch`
   (+ `PUSH_DISPATCH_SECRET`); then `supabase/ops/push_dispatch_schedule.sql` with the
   two Vault secrets.
5. **EAS**: `production` environment variables `EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable key), `GOOGLE_SERVICES_JSON` (file).
6. **Push credentials**: Firebase Android app `com.atteem.parkwatch` + FCM V1 key in EAS;
   Apple Developer membership, APNs key via `eas credentials`.
7. **Legal**: final Terms and Privacy Policy (the in-app pages list what is missing).

## Pending on the development project

* Migration `20261015000001_account_deletion.sql` (T9.3) is **applied** (2026-10-15, by Atte,
  one transaction with its `schema_migrations` row). Confirmed afterwards: history row,
  `profiles.deletion_requested_at`, `request_account_deletion` and the
  `reports_refuse_closed_account` trigger exist. Real rolled-back QA: **30/30 passed, 0 failed**
  (the error response is the intended `T93QA_RESULT` rollback). Do not re-apply; re-run the QA
  only after a related backend change. How it was applied and tested (PGlite dry run:
  `node scripts/run-t93-cloud-qa-local.mjs`):

  ```bash
  npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f scripts/sql/t93-apply-dev.sql
  npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f scripts/sql/t93-cloud-qa.sql
  ```

  The QA closes only a temporary citizen created inside its transaction and ends with
  `T93QA_RESULT {...}` (an error by design - that is what rolls everything back).
  Rollback: `supabase/rollback/20261015_account_deletion_rollback.sql`.
* Password-reset redirect URLs **configured** in the development project (2026-10-15, by Atte):
  `parkwatch-dev://auth/reset-password` and `parkwatch://auth/reset-password`. Do not change them.
  Real reset deep-link QA is pending the development build on a phone (RELEASE_CHECKLIST.md).
