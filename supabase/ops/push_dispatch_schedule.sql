-- ============================================================================
-- ParkWatch push-dispatch schedule (DEVELOPMENT project gmwssplqtjbrpvlvbjcs).
-- NOT a migration (supabase db push is not used on this project). Run with:
--   npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f supabase/ops/push_dispatch_schedule.sql
--
-- ONE job, once a minute: push-dispatch claims new outbox rows and due
-- retries, sends them, records results, and checks receipts older than 15
-- minutes - all in the same run, so no second (receipt) job and no database
-- webhook. Overlapping runs are safe: rows are claimed with FOR UPDATE SKIP
-- LOCKED + a lease, devices that already have a ticket are skipped, and a
-- late result for a row that is no longer SENDING is ignored.
--
-- Secrets: the job reads the URL and the shared secret from Supabase Vault at
-- run time. They are created separately (never in this file or in git):
--   vault secret 'push_dispatch_url'    -> https://<ref>.supabase.co/functions/v1/push-dispatch
--   vault secret 'push_dispatch_secret' -> same value as the function secret PUSH_DISPATCH_SECRET
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- NOTE (checked 2026-10-14): Supabase's managed pg_net grants the `net` schema,
-- its tables (incl. http_request_queue, which briefly holds the dispatch secret
-- header) and http_post to PUBLIC, granted by supabase_admin; the project's
-- postgres role cannot revoke them. They are NOT reachable by app clients:
-- the REST API exposes only `public` and `graphql_public` (net/vault/cron
-- requests return 406 PGRST106) and pg_graphql is disabled. Never add `net`,
-- `vault` or `cron` to the API's exposed schemas.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'parkwatch-push-dispatch') then
    perform cron.unschedule('parkwatch-push-dispatch');
  end if;
end $$;

select cron.schedule(
  'parkwatch-push-dispatch',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-parkwatch-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- To stop it:  select cron.unschedule('parkwatch-push-dispatch');
