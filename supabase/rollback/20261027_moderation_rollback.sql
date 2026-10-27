-- ============================================================================
-- ROLLBACK for 20261027000001_moderation.sql (DEVELOPMENT). Not a migration;
-- not run automatically. Removes reporting moderation INCLUDING its history -
-- export public.moderation_actions first if the history must be kept.
-- Restores the previous report-evidence upload policy.
-- ============================================================================

begin;
drop policy if exists pw_report_evidence_insert_own on storage.objects;
create policy pw_report_evidence_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text);

drop trigger if exists reports_refuse_restricted on public.reports;
drop function if exists public.pw_refuse_report_when_restricted();
drop function if exists public.get_my_moderation();
drop function if exists public.pw_i_am_reporting_restricted();
drop function if exists public.revoke_reporter_restriction(uuid, uuid, text, text);
drop function if exists public.restrict_reporter(uuid, text, text, text);
drop function if exists public.get_reporter_moderation(uuid);
drop function if exists public.pw_moderation_scope(uuid);
drop function if exists public.pw_moderation_staff_state(uuid, uuid);
drop function if exists public.pw_moderation_public_state(uuid);
drop function if exists public.pw_reporting_restricted(uuid);
drop function if exists public.pw_active_restriction(uuid);
drop function if exists public.pw_moderation_cycle(uuid);
drop trigger if exists moderation_actions_immutable on public.moderation_actions;
drop table if exists public.moderation_actions;
drop function if exists public.pw_moderation_immutable();
drop type if exists public.moderation_reason;
drop type if exists public.moderation_action_type;
delete from supabase_migrations.schema_migrations where version = '20261027000001';
commit;
