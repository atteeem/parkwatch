-- ============================================================================
-- DEVELOPMENT ONLY. Do NOT run against a production project.
-- Not a migration: run it manually in the SQL editor of a development project
-- (or `psql -f supabase/seed.dev.sql`). It is named seed.dev.sql on purpose so
-- the Supabase CLI does not apply it automatically.
--
-- Creates one demo enforcement organization and the "helsinki-demo"
-- jurisdiction used by the app's domain config. No users, reports or rewards
-- are created here, and the local demo data is NOT uploaded.
-- ============================================================================

insert into public.organizations (id, name)
values ('0a7c0000-0000-4000-8000-000000000001', 'ParkWatch Demo Enforcement (development)')
on conflict (id) do nothing;

insert into public.jurisdictions (id, organization_id, name)
values ('helsinki-demo', '0a7c0000-0000-4000-8000-000000000001', 'Helsinki (demo)')
on conflict (id) do nothing;

-- T8.3: new reports go to this enforcement area (until geographic routing exists).
update public.app_settings set default_jurisdiction_id = 'helsinki-demo';

-- To let a development user act as an officer, sign the user up first
-- (Authentication -> Users -> Add user), then run as the project owner:
--
--   insert into public.organization_members (organization_id, user_id, member_role)
--   select '0a7c0000-0000-4000-8000-000000000001', id, 'OFFICER'
--   from auth.users where email = 'officer@example.test';
--   update public.profiles set role = 'OFFICER'
--   where id = (select id from auth.users where email = 'officer@example.test');
--
-- Officer access needs BOTH the server-set profile role and an active
-- membership; clients can change neither, and user_metadata is ignored.
