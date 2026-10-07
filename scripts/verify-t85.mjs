// T8.5 scenarios for scripts/verify-migrations.mjs: EXECUTE privileges on
// functions, with Supabase's real default privileges in the stub (new
// functions in public are granted to anon/authenticated unless revoked).
// Found on the real development project: anon could execute SECURITY DEFINER
// helper functions (Supabase security advisor warning).

export async function runT85(ctx) {
  const { q, ok } = ctx;
  const fnList = async (sql) => (await q(sql)).rows.map((r) => r.f);

  await ok("T8.5: anon can execute NO function in public (definer or not)", async () => {
    const hits = await fnList(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`);
    if (hits.length) throw new Error(hits.join(", "));
  });

  await ok("T8.5: PUBLIC (every role) has EXECUTE on no SECURITY DEFINER function", async () => {
    const hits = await fnList(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      order by 1`);
    if (hits.length) throw new Error(hits.join(", "));
  });

  await ok("T8.5: signed-in users cannot call trigger functions or internal helpers", async () => {
    const internal = [
      "public.handle_new_auth_user()",
      "public.set_updated_at()",
      "public.reject_modification()",
      "public.reject_truncate()",
      "public.pw_fail(text,text)",
      "public.pw_require_user()",
      "public.pw_audit(uuid,public.actor_role,text,uuid,text,jsonb)",
      "public.pw_lock_case_for_officer(uuid)",
      "public.pw_my_open_inspection(uuid)",
    ];
    const hits = [];
    for (const sig of internal) {
      const r = (await q(`select has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') x`, [sig])).rows[0].x;
      if (r) hits.push(sig);
    }
    if (hits.length) throw new Error(hits.join(", "));
  });

  await ok("T8.5: signed-in users keep EXECUTE on the helpers RLS policies call (else every read would fail)", async () => {
    const needed = [
      "public.is_enforcement_member_for(text)",
      "public.can_access_case(uuid)",
      "public.can_upload_officer_evidence(text)",
      "public.can_read_report_evidence_object(text)",
      "public.can_read_officer_evidence_object(text)",
      "public.try_uuid(text)",
    ];
    const missing = [];
    for (const sig of needed) {
      const r = (await q(`select has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') x`, [sig])).rows[0].x;
      if (!r) missing.push(sig);
    }
    if (missing.length) throw new Error(missing.join(", "));
  });

  await ok("T8.5: functions created by later migrations are not auto-granted to anon", async () => {
    await q(`create function public.pw_t85_probe() returns int language sql as $$ select 1 $$`);
    try {
      const r = (await q(`select has_function_privilege('anon', 'public.pw_t85_probe()'::regprocedure, 'EXECUTE') x`)).rows[0].x;
      if (r) throw new Error("a new function is executable by anon by default");
    } finally {
      await q(`drop function public.pw_t85_probe()`);
    }
  });
}

export async function runT85SearchPath(ctx) {
  const { q, ok } = ctx;
  await ok("T8.5: every function in public pins search_path (definer and invoker)", async () => {
    const rows = (await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1`)).rows;
    if (rows.length) throw new Error(rows.map((r) => r.f).join(", "));
  });
  await ok("T8.5: pinned invoker functions still work (updated_at trigger, append-only guard, try_uuid)", async () => {
    const u = (await q(`select public.try_uuid('not-a-uuid') a, public.try_uuid('00000000-0000-4000-8000-000000000001') b`)).rows[0];
    if (u.a !== null || u.b !== "00000000-0000-4000-8000-000000000001") throw new Error(JSON.stringify(u));
    // The updated_at trigger (now pinned) still runs without error and sets the column.
    const id = (await q(`select id from public.profiles limit 1`)).rows[0].id;
    await q(`update public.profiles set updated_at = 'epoch' where id = $1`, [id]);
    const after = (await q(`select updated_at from public.profiles where id = $1`, [id])).rows[0].updated_at;
    if (new Date(after).getFullYear() < 2000) throw new Error("updated_at trigger did not run");
    const guard = await q(`delete from public.audit_events where false`).then(() => "ok", (e) => String(e.message));
    const blocked = await q(`delete from public.audit_events where id = (select id from public.audit_events limit 1)`).then(() => "allowed", (e) => (/append-only/.test(e.message) ? "blocked" : e.message));
    if (guard !== "ok" || blocked !== "blocked") throw new Error(`${guard} ${blocked}`);
  });
}
