-- ============================================================================
-- ROLLBACK for 20261015000001_account_deletion.sql (DEVELOPMENT). Not a
-- migration; not run automatically. Accounts already closed stay closed in
-- effect only if the column is kept - dropping it re-opens them, so check
-- first:  select count(*) from public.profiles where deletion_requested_at is not null;
-- ============================================================================

begin;
drop trigger if exists reports_refuse_closed_account on public.reports;
drop function if exists public.pw_refuse_report_from_closed_account();
drop function if exists public.request_account_deletion(text);
alter table public.profiles drop column if exists deletion_requested_at;
delete from supabase_migrations.schema_migrations where version = '20261015000001';
commit;
