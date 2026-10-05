# Auth architecture (T8.2)

```
Screens (app/*)                 useAuth(), useSession() only — never Supabase
  app/auth/sign-in, sign-up     forms; passwords only in screen state
  app/account/status            signed in, but no role app (inactive officer, staff, profile error)
  AreaGuard (_layout files)     guardArea(view, area) -> allow | loading | redirect
src/context/SessionContext      SessionView: LOCAL_DEMO {dev role} | BACKEND {status, access}
src/auth/AuthContext            React binding; picks the mode; refreshes on app foreground
src/auth/authStore              state machine (testable): loading -> unauthenticated | authenticated
src/auth/roleResolution         resolveAccess(profile, memberships)  <- the ONLY role logic
src/auth/authService            the ONLY supabase.auth.* caller (sign in/up/out, session, refresh)
src/backend/repositories/profileRepository   profiles + organization_members (RLS: own rows)
Supabase                        auth.users -> trigger -> profiles (CITIZEN); ensure_my_profile()
```

**Mode.** `BACKEND` iff `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
are valid; otherwise `LOCAL_DEMO`. The modes never mix: no fake session in the demo,
no dev role switch with a backend.

**Trusted role.** `resolveAccess` uses only the server profile row and the caller's
memberships:

| Profile role | Active OFFICER/SUPERVISOR membership | Result |
|---|---|---|
| CITIZEN | (ignored) | citizen app |
| OFFICER | yes | officer app |
| OFFICER | no / inactive | "Officer access is not active" |
| SUPERVISOR / ADMIN | — | staff placeholder |
| missing / unknown | — | `ensure_my_profile()` (CITIZEN only), else account error |

The database applies the same rule to officer data (`is_enforcement_member_for`).
Not used for authorization: `user_metadata`, `app_metadata`, local storage, route
params, Demo tools, `DEV_ROLE`.

**Routing.** `homeFor(view)` decides the landing route; each route group's
`_layout` runs `AreaGuard`, so deep links into a forbidden area redirect (signed out
→ `/auth/sign-in`, citizen ↔ officer → own home, no role app → `/account/status`).

**Sign out.** Drops the trusted identity first, then `supabase.auth.signOut()` (falls
back to a local sign-out when offline). Local app data is kept.

**After sign-in (T8.3).** In BACKEND mode the core data (reports, cases,
inspections, rewards, notifications, evidence) comes from the server for the
signed-in user only: `AppContext` creates one core store per user id once the
session has an app role, and disposes it on sign-out or account switch so no data
crosses accounts. The citizen/officer ids used by the screens are the auth user
id; there are no dev ids in BACKEND mode. See
[CORE_BACKEND_ARCHITECTURE.md](CORE_BACKEND_ARCHITECTURE.md).

**Still not included:** password reset, realtime, push/email.
