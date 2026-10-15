# Release checklist (release candidate / investor build)

Tick in order. "Atte" = needs Atte's account or device.

## Code (any machine, Metro stopped)

- [ ] `npm test` - all suites green
- [ ] `npm run typecheck` - clean
- [ ] `npm run verify:migrations` - 0 failed
- [ ] Mock end-to-end: `npm run mock:backend`, then `npm run e2e:mock` - 8/8
- [ ] `git status` clean; no `.env`, `google-services.json`, keys, `IMG_*` or `supabase/.temp` tracked

## Backend (development project)

- [x] Migrations up to date (T9.2 applied; T9.3 account deletion applied 2026-10-15)
- [x] Account-closure QA: `scripts/sql/t93-cloud-qa.sql` (rolls back) - 30/30 on 2026-10-15
- [ ] Database QA: `npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f scripts/sql/t92-cloud-qa.sql` (rolls back)
- [ ] Atte: password-based regression `test:cloud-qa` after backend changes (last: 2026-10-15, 51 passed / 1 skipped)
- [ ] `push-dispatch` deployed; one cron job; `PARKWATCH_RUN_PUSH_QA=1 node scripts/push-dispatch-smoke.mjs` -> 200 / 401
- [x] Auth redirect URLs for password reset (development project, 2026-10-15; do not change)

## Builds (Atte)

- [ ] Android development build (`eas build -p android --profile development`) installs and opens
- [ ] Android preview build (`--profile preview`) - needs Firebase app `com.atteem.parkwatch`
- [ ] iOS - needs Apple Developer membership

## Phone QA (Atte, on the build)

- [ ] Sign in (citizen), push education -> allow -> registered
- [ ] Report: vehicle type, Front/Side/Rear guides, level indicator, plate scan (1 real scan), submit
- [ ] Officer (second account/phone): assignment push arrives, tap opens the case, route -> inspection -> 4 photos -> charge
- [ ] Citizen: "Report verified" push, tap opens the report, €5 once
- [ ] Parking: map, area, vehicle, 1-minute dial with click, start / extend / end
- [ ] Forgot password email -> link opens the app -> new password works
- [ ] Sign out, sign in again; Delete Account on a throwaway test account

## Demo readiness

- [ ] Demo accounts and data ready (DEMO_SCRIPT.md - pick the demo type)
- [ ] Release blockers reviewed (RELEASE_CANDIDATE_BLOCKERS.md)
