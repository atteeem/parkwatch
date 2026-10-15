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

* Migration `20261015000001_account_deletion.sql` (T9.3) is **not applied**. Until it is,
  the app works as before (profile loading falls back) but **Delete Account fails**
  with a generic error. Apply it the same way as the T9.2 migrations (one transaction
  with its `schema_migrations` row), after approval.
* Password reset needs the redirect URLs above in the development project's Auth settings.
