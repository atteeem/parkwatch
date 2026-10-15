# Data retention and account closure (T9.3)

> Engineering description of what the system does. The binding wording belongs
> in the Privacy Policy, which is still a draft; retention periods marked
> "to be decided" need a legal/organization decision before production.

## Closing a citizen account (in the app)

Settings → Delete Account → type DELETE → confirm. Server function
`request_account_deletion` (`supabase/migrations/20261015000001_account_deletion.sql`).

| Data | What happens | Why |
| --- | --- | --- |
| Display name | Cleared at once | Personal data |
| Profile picture | Path cleared at once; the app deletes the image object | Personal data |
| Notifications (in-app inbox) | Deleted at once (queued pushes go with them) | Personal data, no further purpose |
| Push devices (tokens) | Deleted at once | Personal data, no further purpose |
| Use of the account | Blocked at once: signing in shows "This account has been closed"; no new reports (database trigger) | The account is closed |
| Reports, citizen photos, cases, officer photos, outcomes | Kept, linked only to the account's random id; the console shows citizens only as a pseudonymous reference | Records of parking-enforcement decisions held for the enforcement organization; retention period **to be decided** by the organization |
| Reward ledger | Kept (append-only accounting record); unpaid rewards are forfeited (no payouts exist) | Accounting record |
| Audit events | Kept (append-only); one `ACCOUNT_DELETION_REQUESTED` event is added | Accountability |
| Unsent report draft, parking sessions (on the phone) | Stay on that phone until the app's data is cleared | Never sent to the server |
| Email address and password (Supabase Auth) | Removed by an operator step afterwards (below) | The profile row must remain because enforcement records reference it |

Officer, supervisor and admin accounts are managed by their organization and
cannot be closed from the app (the server refuses).

## Operator step: erase the sign-in identity

For each closed account (`profiles.deletion_requested_at is not null`), with the
service role / Supabase dashboard (never from the app):

1. Supabase dashboard → Authentication → Users → the user → **Ban user** (or Admin API
   `updateUserById(id, { ban_duration: "876000h" })`), then change the email to
   `deleted+<user id>@invalid.local` and set a random password.
2. Delete the user's remaining profile-picture objects under `profile-avatars/<user id>/`
   if any (the app removes the current one).

Deleting the auth user outright is not possible while enforcement records reference
the profile (by design: `reports.citizen_id` is `on delete restrict`).

Target: within one month of the request (to be confirmed in the Privacy Policy).

## Rollback

`supabase/rollback/20261015_account_deletion_rollback.sql` (not run; dropping the
column would re-open closed accounts - check the count first).
