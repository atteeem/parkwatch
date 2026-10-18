-- ============================================================================
-- T9.4 real-cloud database QA: citizen username (DEVELOPMENT project only).
-- Run only AFTER 20261018000001_username.sql is applied.
--
--   npx supabase db query --linked --project-ref gmwssplqtjbrpvlvbjcs -f scripts/sql/t94-cloud-qa.sql
--
-- NOTHING PERSISTS: one DO block that always ends by raising T94QA_RESULT, so
-- PostgreSQL rolls back everything. Only temporary citizens created inside the
-- transaction get usernames; existing dev accounts are only read.
-- ============================================================================

create or replace function pg_temp.t94_as(p_uid uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare r jsonb;
begin
  begin
    perform set_config('request.jwt.claims', case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute case when p_uid is null then 'set local role anon' else 'set local role authenticated' end;
    execute p_sql into r;
    execute 'reset role';
    return coalesce(r, 'null'::jsonb);
  exception when others then
    return jsonb_build_object('error', left(sqlerrm, 160));
  end;
end $f$;

do $qa$
declare
  res jsonb := '[]';
  offA1 uuid := '3ad86131-a63e-460b-aa54-5d9a9db0c05c';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  closer uuid := gen_random_uuid();
  r jsonb;
  k record;
  others_before jsonb;
begin
  others_before := (select jsonb_agg(jsonb_build_object('id', id, 'u', username, 'c', username_changed_at, 'n', display_name) order by id) from public.profiles);

  -- schema / grants
  res := res || jsonb_build_object('name', 'Schema: set_username exists once, SECURITY DEFINER, search_path pinned, only p_username',
    'ok', (select count(*) = 1 and bool_and(p.prosecdef) and bool_and(p.proconfig @> array['search_path=""']) and bool_and(pg_get_function_identity_arguments(p.oid) = 'p_username text')
           from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'set_username'), 'detail', null);
  res := res || jsonb_build_object('name', 'Grants: authenticated may execute set_username; anon and PUBLIC may not',
    'ok', has_function_privilege('authenticated', 'public.set_username(text)', 'execute')
          and not has_function_privilege('anon', 'public.set_username(text)', 'execute')
          and not exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = 'public.set_username(text)'::regprocedure and x.grantee = 0), 'detail', null);
  res := res || jsonb_build_object('name', 'Grants: no client UPDATE on username / username_changed_at',
    'ok', not has_column_privilege('authenticated', 'public.profiles', 'username', 'update')
          and not has_column_privilege('authenticated', 'public.profiles', 'username_changed_at', 'update'), 'detail', null);
  res := res || jsonb_build_object('name', 'Schema: unique index + format check on profiles.username',
    'ok', exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_key' and indexdef ilike '%unique%')
          and exists (select 1 from pg_constraint where conname = 'profiles_username_format'), 'detail', null);
  res := res || jsonb_build_object('name', 'Grants: reserved_usernames not readable by anon/authenticated, RLS on',
    'ok', not has_table_privilege('authenticated', 'public.reserved_usernames', 'select') and not has_table_privilege('anon', 'public.reserved_usernames', 'select')
          and (select relrowsecurity from pg_class where oid = 'public.reserved_usernames'::regclass), 'detail', null);
  res := res || jsonb_build_object('name', 'Schema: request_account_deletion still one function, search_path pinned, clears username',
    'ok', (select count(*) = 1 and bool_and(p.proconfig @> array['search_path=""']) and bool_and(p.prosrc ~ 'username = null')
           from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'request_account_deletion'), 'detail', null);

  -- temporary citizens
  insert into auth.users (id, email, raw_user_meta_data) values (a, 't94qa-a@invalid.test', '{}'), (b, 't94qa-b@invalid.test', '{}'), (closer, 't94qa-c@invalid.test', '{}');
  update public.profiles set display_name = 'T94 QA A' where id = a;

  r := pg_temp.t94_as(a, $s$select public.set_username('  T94qa_Alpha ')$s$);
  res := res || jsonb_build_object('name', 'First username succeeds (normalized), display_name unchanged',
    'ok', (r->>'changed')::boolean and r->>'username' = 't94qa_alpha' and (select display_name = 'T94 QA A' and username = 't94qa_alpha' from public.profiles where id = a), 'detail', r - 'next_change_at');
  r := pg_temp.t94_as(a, $s$select public.set_username('T94QA_ALPHA')$s$);
  res := res || jsonb_build_object('name', 'Same username: no change, no cooldown restart', 'ok', not (r->>'changed')::boolean and not r ? 'reason', 'detail', r - 'next_change_at');
  r := pg_temp.t94_as(b, $s$select public.set_username('t94QA_alpha')$s$);
  res := res || jsonb_build_object('name', 'Duplicate denied case-insensitively (TAKEN)', 'ok', r->>'reason' = 'TAKEN' and (select username is null from public.profiles where id = b), 'detail', r);
  for k in select * from (values ('ab'), ('aaaaaaaaaaaaaaaaaaaaaaaaa'), ('t94 qa'), ('t94@qa'), ('t94-qa')) v(n) loop
    r := pg_temp.t94_as(b, format('select public.set_username(%L)', k.n));
    res := res || jsonb_build_object('name', 'Invalid denied: ' || k.n, 'ok', r ? 'error' and r->>'error' ~ '^INVALID_INPUT', 'detail', r);
  end loop;
  for k in select * from (values ('admin'), ('parkwatch_help'), ('poliisi')) v(n) loop
    r := pg_temp.t94_as(b, format('select public.set_username(%L)', k.n));
    res := res || jsonb_build_object('name', 'Reserved denied: ' || k.n, 'ok', r ? 'error' and r->>'error' ~ 'not available', 'detail', r);
  end loop;
  r := pg_temp.t94_as(a, $s$select public.set_username('t94qa_beta')$s$);
  res := res || jsonb_build_object('name', 'Second change inside 30 days denied with next_change_at', 'ok', r->>'reason' = 'COOLDOWN' and (r->>'next_change_at')::timestamptz > now(), 'detail', r - 'next_change_at');
  update public.profiles set username_changed_at = now() - interval '30 days' where id = a;
  r := pg_temp.t94_as(a, $s$select public.set_username('t94qa_beta')$s$);
  res := res || jsonb_build_object('name', 'Change at 30 days succeeds', 'ok', (r->>'changed')::boolean, 'detail', r - 'next_change_at');
  r := pg_temp.t94_as(b, $s$select public.set_username('t94qa_alpha')$s$);
  res := res || jsonb_build_object('name', 'Old name freed for another citizen', 'ok', (r->>'changed')::boolean, 'detail', r - 'next_change_at');
  r := pg_temp.t94_as(b, format($s$with x as (update public.profiles set username = 'direct_t94' where id = %L returning 1) select to_jsonb(count(*)) from x$s$, b));
  res := res || jsonb_build_object('name', 'Direct UPDATE of username denied', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
  r := pg_temp.t94_as(null, $s$select public.set_username('t94qa_anon')$s$);
  res := res || jsonb_build_object('name', 'Anonymous denied', 'ok', r ? 'error' and r->>'error' ~ 'permission denied', 'detail', r);
  r := pg_temp.t94_as(offA1, $s$select public.set_username('t94qa_officer')$s$);
  res := res || jsonb_build_object('name', 'Officer denied (citizen only)', 'ok', r ? 'error' and r->>'error' ~ '^FORBIDDEN', 'detail', r);
  res := res || jsonb_build_object('name', 'Audit: USERNAME_CHANGED events have empty metadata',
    'ok', (select count(*) = 2 and bool_and(metadata = '{}'::jsonb) from public.audit_events where entity_id = a and event_type = 'USERNAME_CHANGED'), 'detail', null);

  update public.profiles set username = 't94qa_closing', username_changed_at = now() where id = closer;
  r := pg_temp.t94_as(closer, $s$select public.request_account_deletion('DELETE')$s$);
  res := res || jsonb_build_object('name', 'Account closure clears the username',
    'ok', (r->>'changed')::boolean and (select username is null and username_changed_at is null from public.profiles where id = closer), 'detail', r - 'avatar_path');
  r := pg_temp.t94_as(closer, $s$select public.set_username('t94qa_back')$s$);
  res := res || jsonb_build_object('name', 'Closed account cannot set a username', 'ok', r ? 'error' and r->>'error' ~ '^FORBIDDEN', 'detail', r);

  res := res || jsonb_build_object('name', 'Isolation: no existing account changed',
    'ok', others_before = (select jsonb_agg(jsonb_build_object('id', id, 'u', username, 'c', username_changed_at, 'n', display_name) order by id) from public.profiles where id not in (a, b, closer)), 'detail', null);

  raise exception 'T94QA_RESULT %', jsonb_build_object('total', jsonb_array_length(res),
    'failed', (select count(*) from jsonb_array_elements(res) x where (x->>'ok')::boolean is not true),
    'failures', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(res) x where (x->>'ok')::boolean is not true),
    'names', (select jsonb_agg(x->>'name') from jsonb_array_elements(res) x))::text;
end
$qa$;
