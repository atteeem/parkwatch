// T9.4 scenarios for scripts/verify-migrations.mjs: citizen username with a
// 30-day cooldown (set_username), on the real migrations.

export async function runT94(ctx) {
  const { db, q, as, anon, ok, fails, U } = ctx;
  const A = "00000000-0000-4000-8000-00000000e0a1";
  const B = "00000000-0000-4000-8000-00000000e0b1";
  const CLOSER = "00000000-0000-4000-8000-00000000e0c1";
  await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${A}', '{"display_name":"Aino Citizen"}'), ('${B}', '{}'), ('${CLOSER}', '{}')`);

  const set = (who, name) => as(who, () => q(`select public.set_username($1) as r`, [name])).then((x) => x.rows[0].r);
  const prof = async (id) => (await q(`select username, username_changed_at, display_name from public.profiles where id = $1`, [id])).rows[0];
  const audits = async (id) => Number((await q(`select count(*) n from public.audit_events where entity_type = 'profile' and entity_id = $1 and event_type = 'USERNAME_CHANGED'`, [id])).rows[0].n);
  const backdate = (id, interval) => q(`update public.profiles set username_changed_at = now() - $2::interval where id = $1`, [id, interval]);

  await ok("T9.4: first username succeeds (normalized to lowercase) and starts the 30-day cooldown", async () => {
    const r = await set(A, "  Aino_Park1 ");
    const p = await prof(A);
    const days = (new Date(r.next_change_at) - new Date(p.username_changed_at)) / 86400000;
    if (!r.changed || r.username !== "aino_park1" || p.username !== "aino_park1" || Math.round(days) !== 30) throw new Error(JSON.stringify({ r, p }));
    if (p.display_name !== "Aino Citizen") throw new Error("display_name changed");
  });
  await ok("T9.4: the same username again changes nothing and does not restart the cooldown", async () => {
    const before = (await prof(A)).username_changed_at;
    const r = await set(A, "AINO_PARK1");
    if (r.changed !== false || r.reason || String((await prof(A)).username_changed_at) !== String(before)) throw new Error(JSON.stringify(r));
  });
  await ok("T9.4: duplicate username denied case-insensitively (TAKEN, nothing changed)", async () => {
    const r = await set(B, "AINO_park1");
    if (r.changed !== false || r.reason !== "TAKEN" || (await prof(B)).username !== null) throw new Error(JSON.stringify(r));
  });
  for (const [what, name] of [["too short", "ab"], ["too long (25)", "a".repeat(25)], ["a space", "aino park"], ["an @", "aino@park"],
                              ["a non-ASCII letter", "äiti_123"], ["a hyphen", "aino-park"], ["empty", "   "], ["null", null]]) {
    await fails(`T9.4: invalid username denied: ${what}`, () => set(B, name), /INVALID_INPUT/);
  }
  for (const name of ["admin", "Support", "parkwatch_fi", "poliisi", "administrator1"]) {
    await fails(`T9.4: reserved username denied: ${name}`, () => set(B, name), /INVALID_INPUT: This username is not available/);
  }
  await ok("T9.4: a second change inside 30 days is denied with next_change_at (server time)", async () => {
    await backdate(A, "29 days 23 hours");
    const r = await set(A, "aino_new");
    if (r.changed !== false || r.reason !== "COOLDOWN" || !r.next_change_at || (await prof(A)).username !== "aino_park1") throw new Error(JSON.stringify(r));
    if (new Date(r.next_change_at) <= new Date()) throw new Error("next_change_at not in the future");
  });
  await ok("T9.4: a change at exactly 30 days succeeds and restarts the cooldown", async () => {
    await backdate(A, "30 days");
    const r = await set(A, "aino_new");
    if (!r.changed || (await prof(A)).username !== "aino_new") throw new Error(JSON.stringify(r));
    const again = await set(A, "aino_newer");
    if (again.reason !== "COOLDOWN") throw new Error("cooldown not restarted");
  });
  await ok("T9.4: a change after 30 days succeeds; the old name is freed for others", async () => {
    await backdate(A, "45 days");
    const r = await set(A, "aino_third");
    const freed = await set(B, "aino_new");
    if (!r.changed || !freed.changed || (await prof(B)).username !== "aino_new") throw new Error(JSON.stringify({ r, freed }));
  });
  await ok("T9.4: concurrent claim of the same name: the loser gets TAKEN from the unique index (no pre-check race)", async () => {
    // Simulates the other session committing first: the name appears after our checks, at UPDATE time.
    await q(`update public.profiles set username = 'race_name', username_changed_at = now() - interval '40 days' where id = $1`, [CLOSER]);
    await backdate(B, "40 days");
    const r = await set(B, "Race_Name");
    const owners = Number((await q(`select count(*) n from public.profiles where username = 'race_name'`)).rows[0].n);
    if (r.reason !== "TAKEN" || owners !== 1 || (await prof(B)).username !== "aino_new") throw new Error(JSON.stringify({ r, owners }));
    const src = (await q(`select prosrc from pg_proc where proname = 'set_username'`)).rows[0].prosrc;
    if (!/exception when unique_violation/.test(src)) throw new Error("no unique_violation handler");
    const idx = (await q(`select indexdef from pg_indexes where indexname = 'profiles_username_key'`)).rows[0]?.indexdef ?? "";
    if (!/UNIQUE/i.test(idx)) throw new Error("no unique index");
  });
  await ok("T9.4: one user cannot change another user's username (no user parameter; caller is auth.uid())", async () => {
    const args = (await q(`select pg_get_function_identity_arguments('public.set_username(text)'::regprocedure) a`)).rows[0].a;
    if (args !== "p_username text") throw new Error(args);
  });
  await fails("T9.4: the username columns cannot be written directly by a client", () =>
    as(B, () => q(`update public.profiles set username = 'direct_write' where id = $1`, [B])), /permission denied/);
  await fails("T9.4: the cooldown timestamp cannot be reset directly by a client", () =>
    as(B, () => q(`update public.profiles set username_changed_at = null where id = $1`, [B])), /permission denied/);
  await fails("T9.4: anonymous users cannot set a username", () => anon(() => q(`select public.set_username('anon_name')`)), /permission denied/);
  await fails("T9.4: staff accounts cannot set a username (citizen only in v1)", () => set(U.officer, "officer_one"), /FORBIDDEN/);
  await fails("T9.4: the reserved-name list is not readable by clients", () => as(B, () => q(`select * from public.reserved_usernames`)), /permission denied/);
  await ok("T9.4: audit has one event per real change, with empty metadata (no names kept)", async () => {
    const rows = (await q(`select metadata from public.audit_events where entity_type = 'profile' and entity_id = $1 and event_type = 'USERNAME_CHANGED'`, [A])).rows;
    if (rows.length !== 3 || rows.some((r) => JSON.stringify(r.metadata) !== "{}")) throw new Error(JSON.stringify(rows));
    if ((await audits(B)) !== 1) throw new Error("B audit count");
  });
  await ok("T9.4: a citizen reads their own username; another citizen's profile stays invisible", async () => {
    const own = (await as(A, () => q(`select username from public.profiles where id = $1`, [A]))).rows;
    const other = (await as(B, () => q(`select username from public.profiles where id = $1`, [A]))).rows;
    if (own[0]?.username !== "aino_third" || other.length !== 0) throw new Error(JSON.stringify({ own, other }));
  });
  await ok("T9.4: closing the account clears and frees the username", async () => {
    await q(`update public.profiles set username = 'closing_name', username_changed_at = now() where id = $1`, [CLOSER]);
    await as(CLOSER, () => q(`select public.request_account_deletion('DELETE')`));
    const p = await prof(CLOSER);
    if (p.username !== null || p.username_changed_at !== null) throw new Error(JSON.stringify(p));
    await backdate(A, "31 days");
    if (!(await set(A, "closing_name")).changed) throw new Error("name not freed");
  });
  await fails("T9.4: a closed account cannot set a username", () => set(CLOSER, "back_again"), /FORBIDDEN/);
  await ok("T9.4: account closure (T9.3) still works as before after the redefinition", async () => {
    const src = (await q(`select prosrc, proconfig from pg_proc where proname = 'request_account_deletion'`)).rows;
    if (src.length !== 1 || !String(src[0].proconfig).includes('search_path=""')) throw new Error(JSON.stringify(src));
    const anonCan = (await q(`select has_function_privilege('anon', 'public.request_account_deletion(text)', 'execute') a`)).rows[0].a;
    if (anonCan !== false) throw new Error("anon can execute");
  });
}
