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

## T8.4: auth during protected workflows

**Session expiry mid-workflow.** When the server refuses a request as unauthenticated
(expired/revoked token on an RPC, or a storage upload answering 401), the core store asks
the auth store to re-check the session (`refreshAccess`, at most every 10 s). If the
session is gone the identity is dropped with "Your session has ended. Please sign in
again.", the route guards return to Sign In, and no protected screen stays usable. The
refused operation changed nothing on the server.

**Unsent citizen drafts survive auth loss.** The draft (immutable draft id = server
submission id, inputs, local photo URIs, finished uploads) is stored on the phone under
the user id. Losing the session does not delete it; signing in again as the **same**
user offers "Continue unfinished report", and a retry uses the same submission id, so
it can never create a second report. A different account never sees or overwrites it.

**Backend state is cleared on sign-out / account switch.** The core store is created
per signed-in user and disposed when the user signs out or changes; its row cache,
lists, summaries and signed URLs are dropped, and late responses for the old user are
ignored. The in-memory report draft is reset too.

**No stale officer authorization.** Officer access is re-resolved from the server
(profile + active membership) at start and on every foreground. Independently, every
read is RLS-limited: after a membership is deactivated the next refresh returns empty
pages, and the cache is rebuilt from that refresh only, so previously loaded cases
disappear; a case detail that the server no longer returns is removed instead of shown
stale; and all actions are refused by the server (FORBIDDEN).

**Token validity (observed on the real project, T8.5).** A corrupted or expired access
token is refused by the server and the app re-checks the session (Storage reports a bad
signature as "signature verification failed", which the app now treats as an auth
failure). After sign-out — local or global — the *old access token* itself is still
accepted until it expires, because Supabase access tokens are stateless JWTs; the app
discards it on sign-out, and refresh tokens are revoked. Tighter revocation means a
shorter JWT expiry in the project's Auth settings.

**Re-auth.** After signing in again the store reloads page 1 of every list and any open
detail from the server; an officer's inspection continues from the server state, a
citizen continues the unsent draft. Offline at launch with a stored session: "Account
couldn't be loaded" with Check again / Sign Out (never a fallback role, never demo data).

**Why drafts are local but truth is the server.** An unsent draft is the citizen's own
unfinished input that does not exist on the server yet; keeping it on the phone (never
uploaded in the background) is what makes it recoverable without network or session.
Everything operational — reports, cases, assignments, inspections, outcomes, rewards,
notifications — exists only once the server has accepted it and is always read back
from the server; nothing local can grant a role or change a case.

**Still not included:** password reset, realtime, push/email.
