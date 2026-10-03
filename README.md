# ParkWatch — MVP Prototype (Expo Router / React Native / TypeScript)

A functional MVP of the parking-reporting + parking-enforcement platform described in
the spec: a citizen "report a violation" app and a separate officer "receive, inspect,
enforce" app, sharing one in-memory data store so the full demo loop (citizen submits
→ officer accepts → inspects → issues a charge → citizen sees it reflected) works
end to end.

## Requirements

- Node.js 18+ and npm
- The **Expo Go** app on your phone (iOS or Android), or an iOS/Android simulator
- This targets **Expo SDK 54** specifically (per the spec) — do not let it upgrade further

## Setup

```bash
cd parking-app
npm install
npx expo install --fix
```

`expo install --fix` reconciles every Expo/React Native package to the exact versions
SDK 54 expects — the versions in `package.json` are close, but this command is the
authoritative source and will correct anything mismatched for your environment.

## Run

```bash
npx expo start
```

Scan the QR code with the **Expo Go** app (Android: use the Expo Go scanner; iOS: use
the Camera app) or press `i` / `a` in the terminal for a simulator.

By default the app boots into the **citizen** app. To boot straight into the
**officer** app instead, either:

- Edit `src/constants/devRole.ts` and change `"user"` to `"officer"`, or
- Run with an env var: `EXPO_PUBLIC_START_ROLE=officer npx expo start`

There is no login screen in this MVP — role selection is this dev-only switch, exactly
as the spec asks for (section 22).

## What's real vs. simulated

- **Camera is real** — `expo-camera` is wired up for both the citizen's 3-photo report
  flow and the officer's 4-photo inspection evidence. Grant camera permission when
  prompted. If a photo capture ever fails (e.g. in a simulator with no camera), it
  falls back to a placeholder image so the demo flow is never blocked.
- **Maps are static** — per section 15 of the spec, there's no real map SDK. Map
  screens are styled placeholders with absolutely-positioned marker views on top,
  which is stable in Expo Go without any Google Maps/Mapbox API key.
- **Backend is mocked** — `src/context/AppContext.tsx` holds all reports/cases/
  notifications/wallet state in memory (seeded from `src/data/mock*.ts`). Submitting a
  citizen report creates a matching officer case; completing an officer inspection
  updates the citizen's report status and reward — that's the cross-app link the
  product is built around, even though it restarts fresh each time you reload the app.
- **Payments are simulated** — Withdraw just moves the mock balance around.

## Project structure

Matches the spec's recommended layout:

```
app/                     expo-router screens (one file per route)
  user/...               15 citizen screens
  officer/...            12 officer screens (11 + shared camera route)
src/
  components/            Card, StatusChip, GreenButton, Header, ReportStepper,
                         StatCard, CaseCard, ReportCard, CameraCapture,
                         UserBottomNav, OfficerBottomNav, VehicleThumbnail
  constants/             colors.ts, typography.ts, spacing.ts, devRole.ts
  context/               AppContext.tsx (global mock state + actions),
                         ReportContext.tsx (in-progress citizen report draft)
  data/                  types.ts, mockReports.ts, mockCases.ts, mockNotifications.ts
```

## Assumptions worth knowing about

- **UserReport ↔ OfficerCase linking**: the spec defines these as two separate
  mock types. I kept them separate as specified, but added a `reportId` field on
  `OfficerCase` so the two sides of the demo can reference each other — otherwise
  "citizen submits → officer sees it → officer resolves it → citizen sees the result"
  (the core loop) would have no way to connect.
- **Exact dependency versions**: I couldn't verify package versions against the npm
  registry from this environment, so `package.json` has close-but-approximate SDK 54
  versions. Running `npx expo install --fix` right after `npm install` (see Setup
  above) is what actually locks these to what your installed Expo CLI expects — treat
  that step as required, not optional.
- A few icons (in `@expo/vector-icons`'s Ionicons set) were picked for visual intent
  and might need swapping for exact ones if any don't render — this is a one-line
  change per icon in the relevant screen file.

## What I'd extend first

1. Run `npx expo install --fix` and walk through the acceptance test in section 23 of
   the spec on a real device — that'll surface any last icon/typo issues fastest.
2. Replace the static map screens with `react-native-maps` once you're ready to move
   off Expo Go (it needs a dev build, not Expo Go, for native map SDKs).
3. Swap `AppContext`'s in-memory state for real API calls — the action functions
   (`submitUserReport`, `acceptCase`, `completeInspection`, etc.) are already the
   seam where that swap happens; screens don't need to change.
4. Add the login/role-detection flow that section 22 says the real product needs,
   replacing `DEV_ROLE`.
