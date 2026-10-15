// T9.3 scenarios for scripts/verify-migrations.mjs: citizen account deletion
// (request_account_deletion) and its retention rules, on the real migrations.

export async function runT93(ctx) {
  const { db, q, as, anon, ok, fails, U } = ctx;
  const C = "00000000-0000-4000-8000-00000000d0d1"; // citizen who closes the account
  const OTHER = "00000000-0000-4000-8000-00000000d0d2";
  await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('${C}', '{"display_name":"Closing Citizen"}'), ('${OTHER}', '{}')`);
  await db.exec(`update public.app_settings set default_jurisdiction_id = 'helsinki-demo'`);

  const n = async (sql, params) => Number((await q(sql, params)).rows[0].n);
  const named = (fn, args = {}) => {
    const keys = Object.keys(args);
    return q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
  };
  const submit = async (citizen, sub) => {
    await as(citizen, async () => {
      for (const s of ["FRONT", "SIDE", "REAR"]) await q(`insert into storage.objects (bucket_id, name, owner) values ('report-evidence', $1, auth.uid())`, [`${citizen}/${sub}/${s}.jpg`]);
    });
    const ev = JSON.stringify(["FRONT", "SIDE", "REAR"].map((slot) => ({ slot, capture_source: "CAMERA", storage_path: `${citizen}/${sub}/${slot}.jpg`, captured_at: new Date().toISOString() })));
    return (await as(citizen, () => q(`select public.submit_report($1, 'no-parking', 'Street 1', now(), now(), $2::jsonb) as r`, [sub, ev]))).rows[0].r;
  };

  // The citizen has a report (with notification + pending reward), a device and a profile picture path.
  const rep = await submit(C, "t93-before");
  await as(C, () => named("register_push_device", { p_installation_id: "inst-t93-closing", p_expo_push_token: "ExponentPushToken[t93closing00]", p_platform: "ios" }));
  await q(`insert into storage.objects (bucket_id, name, owner) values ('profile-avatars', $1, $2)`, [`${C}/me.jpg`, C]);
  await as(C, () => named("set_my_avatar", { p_path: `${C}/me.jpg` }));
  await as(OTHER, () => named("register_push_device", { p_installation_id: "inst-t93-other", p_expo_push_token: "ExponentPushToken[t93other000]", p_platform: "ios" }));

  await fails("T9.3: anonymous users cannot close accounts", () => anon(() => named("request_account_deletion", { p_confirm: "DELETE" })), /permission denied/);
  await fails("T9.3: closing needs the typed confirmation", () => as(C, () => named("request_account_deletion", { p_confirm: "yes" })), /INVALID_INPUT/);
  await fails("T9.3: an officer account cannot be closed from the app (organization-managed)", () => as(U.officer, () => named("request_account_deletion", { p_confirm: "DELETE" })), /FORBIDDEN/);

  await ok("T9.3: a citizen closes their own account: personal data cleared at once, enforcement records kept", async () => {
    const r = (await as(C, () => named("request_account_deletion", { p_confirm: "DELETE" }))).rows[0].r;
    if (!r.requested || !r.changed || r.avatar_path !== `${C}/me.jpg`) throw new Error(JSON.stringify(r));
    const p = (await q(`select display_name, avatar_storage_path, deletion_requested_at from public.profiles where id = $1`, [C])).rows[0];
    if (p.display_name !== "" || p.avatar_storage_path !== null || !p.deletion_requested_at) throw new Error(JSON.stringify(p));
    if ((await n(`select count(*) n from public.notifications where recipient_id = $1`, [C])) !== 0) throw new Error("notifications kept");
    if ((await n(`select count(*) n from public.push_devices where user_id = $1`, [C])) !== 0) throw new Error("devices kept");
    if ((await n(`select count(*) n from public.reports where id = $1`, [rep.report_id])) !== 1) throw new Error("report deleted");
    if ((await n(`select count(*) n from public.officer_cases where report_id = $1`, [rep.report_id])) !== 1) throw new Error("case deleted");
    if ((await n(`select count(*) n from public.reward_ledger where report_id = $1`, [rep.report_id])) !== 1) throw new Error("ledger changed");
    if ((await n(`select count(*) n from public.report_evidence where report_id = $1`, [rep.report_id])) !== 3) throw new Error("evidence rows deleted");
  });
  await ok("T9.3: closing is idempotent and audited exactly once", async () => {
    const r = (await as(C, () => named("request_account_deletion", { p_confirm: "DELETE" }))).rows[0].r;
    const a = await n(`select count(*) n from public.audit_events where entity_type = 'profile' and entity_id = $1 and event_type = 'ACCOUNT_DELETION_REQUESTED'`, [C]);
    if (r.changed !== false || a !== 1) throw new Error(JSON.stringify({ r, a }));
  });
  await fails("T9.3: a closed account cannot submit new reports", () => submit(C, "t93-after"), /FORBIDDEN/);
  await ok("T9.3: closing one account does not touch another user's data", async () => {
    if ((await n(`select count(*) n from public.push_devices where user_id = $1 and enabled`, [OTHER])) !== 1) throw new Error("other device touched");
    const other = await submit(OTHER, "t93-other");
    if (!other.report_id) throw new Error("other citizen blocked");
  });
  await fails("T9.3: the deletion marker cannot be written directly by a client", () =>
    as(C, () => q(`update public.profiles set deletion_requested_at = null where id = $1`, [C])), /permission denied/);
  await ok("T9.3: the console still shows the old report under the pseudonymous reference only", async () => {
    const ref = (await q(`select public.pw_citizen_ref($1) r`, [C])).rows[0].r;
    if (!/^C-[0-9A-F]{8}$/.test(ref)) throw new Error(ref);
  });
}
