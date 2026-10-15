# Release candidate blockers

Status as of T9.3 (branch `t9.3-release-candidate-hardening`, 2026-10-15).
P0 = blocks install / demo / use. P1 = must fix before a real pilot. P2 = can follow the pilot.
"Atte" = needs Atte's account or a decision outside the code.

## P0 - blocks install / demo

| # | Issue | Flow | Status | Recommended fix | Atte? |
| --- | --- | --- | --- | --- | --- |
| 1 | No installable Android build yet | Install | EAS project, variants, profiles, Supabase env vars and `GOOGLE_SERVICES_JSON` (development) are configured; the interactive `eas credentials` session for the FCM V1 key was left open at the profile prompt | Finish `eas credentials -p android` (development): upload the FCM V1 service-account key and let EAS create the keystore; then `eas build -p android --profile development` | Yes |
| 2 | iOS build | Install (iPhone) | Not started | Needs a paid Apple Developer Program membership; then `eas device:create` for the iPhone and `eas build -p ios --profile development` (EAS creates certificates and the APNs key) | Yes |
| 3 | Real push not verified on a phone | Notifications | Server side deployed and scheduled (push-dispatch + one-minute cron); app side tested with fakes | After #1: register a device, one supervisor assignment push, one citizen CHARGE_ISSUED push, deep links, receipts | Yes (phone) |
| 4 | Preview / release-candidate Android build cannot get push | Install (RC) | `google-services.json` covers only `com.atteem.parkwatch.dev` | Add Android app `com.atteem.parkwatch` in Firebase, upload the new file as `GOOGLE_SERVICES_JSON` for `preview` (and `production`) | Yes |
| 5 | Integrated build not verified on a phone | Camera, plate scan, parking dial and sound, maps | Each feature was phone-tested on its own branch; the integrated T9.2/T9.3 build was not | Run the phone checklist on the first development build | Yes (phone) |

## P1 - before a real pilot

| # | Issue | Flow | Status | Recommended fix | Atte? |
| --- | --- | --- | --- | --- | --- |
| 6 | No "Forgot password" / password change | Auth | Sign-in has no reset link; Settings shows Password as not available | Supabase password-reset email + in-app reset screen; configure the auth email sender | Partly (email/SMTP settings) |
| 7 | No in-app account deletion | Settings | Shown honestly as not available | Server function that deletes/anonymises the account per the data rules; required by Apple for apps with sign-up | Decision on data retention |
| 8 | No production backend | Release | EAS `production` environment is empty on purpose (a production build would run the local demo) | Create the production Supabase project, apply migrations in order, deploy functions, set EAS production variables | Yes |
| 9 | Terms of Service and Privacy Policy are drafts | Legal | Labelled "Draft" in the app | Final legal texts | Yes |
| 10 | Plate Recognizer data processing | Plate scan | Provider processes plate crops in the USA | Confirm DPA/retention or choose an EU/on-premise option before production | Yes |
| 11 | ~~Password-based real-cloud regression suite not re-run after T9.2~~ | QA | **DONE 2026-10-15** (run by Atte on the development project after T9.2): `realCloud.cloudqa.ts` PASS, `t87t90.cloudqa.ts` PASS - 2/2 suites, 51 passed, 1 skipped, 0 failures. Together with the T9.2 database QA (135/135) and anonymous REST checks (6/6). | Re-run only after backend changes | - |

## P2 - can follow the pilot

| # | Issue | Flow | Status | Recommended fix | Atte? |
| --- | --- | --- | --- | --- | --- |
| 12 | "Reporter reliability: Not rated" shows a green shield icon | Officer queue/home | Text is truthful; the icon reads as "verified" | Neutral icon/colour when not rated | No |
| 13 | Unreachable old screen `app/user/parking/start.tsx` | Parking | Superseded by the map-first parking screen; nothing links to it; tests still exercise its logic | Move the remaining tested rules to the new flow, then delete | No |
| 14 | Withdrawals disabled in backend mode | Wallet | Clearly worded | Payout flow (separate milestone) | Decision |
| 15 | Android: no heads-up banner for a push while the app is open | Notifications | The notification lands in the tray and the in-app list/badge refresh | Optional: in-app toast for foreground pushes | No |
| 16 | `pg_net` is granted to PUBLIC by Supabase | Infrastructure | Not reachable by app clients (only `public`/`graphql_public` are exposed) | Never expose `net`/`vault`/`cron` through the API | No |
| 17 | Console scale | Supervisor console | Offset paging and per-request aggregates, fine at pilot size | Aggregates/keyset paging when volumes grow | No |

## Fixed in T9.3

* Global error fallback (no blank screen or stack trace on an unexpected error).
* Officer En Route: removed a dead, disabled "Release Case" button and its dev TODO.
* Rapid double taps: Confirm Withdrawal (local demo) and the console assignment confirm are locked after the first tap.
* Help / About pages no longer claim push notifications are unavailable.
* Settings and profiles: removed seven purely-future dimmed rows (kept the honest Password and Delete Account rows; Language shows "English").
* Citizen home: "Verified" instead of "Accepted"; officer home greeting follows the time of day.
* Reports "+" button has a screen-reader label.

Audited and already in place (no change needed): no "fine" wording for the private
parking charge; reward copy never promises €5; camera, location, plate-scan and push
permission-denied paths with Open Settings; request timeouts so sign-in/loading
cannot hang; account-status screen with Try again / Sign out; loading, empty and
error states on lists and detail screens; double-tap guards on report submit,
officer lifecycle actions and parking start/extend/end.
