# ParkWatch — MVP (Expo Router / React Native / TypeScript)

Citizen-assisted parking enforcement: a citizen reports a suspected violation with
photos and GPS; an authorized officer independently inspects it and records the
outcome; the citizen sees the result and, for a verified report, a €5 reward.
Citizens never issue charges.

Two apps in one codebase (citizen and officer), sharing one local store so the full
loop works end to end on a single phone.

## Requirements

- Node.js 20.19+ and npm
- **Expo SDK 57** (React Native 0.86). The current **Expo Go** app from the store runs it.

## Setup and run

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS). Use
`npx expo start --tunnel` if the phone is on a different network.

The app boots into the **citizen** app. To switch roles during development:
Profile → **Demo tools** → *Switch to Officer app* (development builds only), or set
`EXPO_PUBLIC_START_ROLE=officer`. Demo tools also has *Reset demo data*.
See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for the investor demo walkthrough.

```bash
npm test            # Jest (offline, includes a real-Postgres check of the SQL migrations)
npm run typecheck
```

## What's real vs. simulated

- **Camera** — real (`expo-camera`): citizen Front/Side/Rear and the officer's four
  inspection photos. No fake fallback photos.
- **Location and maps** — real foreground GPS (`expo-location`) and native maps
  (`react-native-maps`). No background location.
- **Data** — stored locally on the phone (AsyncStorage, versioned with migrations).
  There is no server in the running app yet.
- **Plate** — one configured mock plate; no OCR/ANPR. "Confirm Plate" is the officer's
  manual confirmation.
- **Rewards and withdrawals** — an append-only local ledger; no real payouts.
- **Parking sessions** — simulated on the phone at a demo rate; no parking operator.

## Backend (foundation only)

A Supabase schema, Row Level Security, typed mappers and repositories exist under
`supabase/` and `src/backend/`, but **the app does not use them yet** and runs with no
backend configured. See [docs/BACKEND_SETUP.md](docs/BACKEND_SETUP.md).

## Project structure

```
app/                  expo-router screens (user/* citizen, officer/*)
src/
  domain/             business rules (pure, tested): reports, cases, inspections,
                      outcomes, reward ledger, notifications, simulated parking
  store/              local store, commands, seed, persistence + migrations
  presentation/       view models for the screens
  context/            React bindings (AppContext, SessionContext, ReportContext)
  components/         shared UI
  location/, map/     foreground location store, map logic
  navigation/         role guards, navigation helpers
  backend/            Supabase config, row types, mappers, repositories (not wired yet)
supabase/
  migrations/         SQL schema + RLS (versioned)
  seed.dev.sql        optional, development only
scripts/              verify-migrations.mjs (offline Postgres check of the migrations)
docs/                 DEMO_SCRIPT.md, BACKEND_SETUP.md
```
