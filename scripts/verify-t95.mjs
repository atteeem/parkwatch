// T9.5 scenarios for scripts/verify-migrations.mjs: citizen reporting
// moderation (30-day restrictions, 3-strike indefinite restriction, revocation,
// strike cycles), on the real migrations. Numbers in names refer to the
// required test list in the T9.5 request.

export async function runT95(ctx) {
  const { db, q, as, anon, ok, fails, U, org } = ctx;
  const C1 = "00000000-0000-4000-8000-00000000f0c1"; // main citizen (3 strikes)
  const C2 = "00000000-0000-4000-8000-00000000f0c2"; // normal citizen
  const C3 = "00000000-0000-4000-8000-00000000f0c3"; // restored after 3rd strike
  const C4 = "00000000-0000-4000-8000-00000000f0c4"; // concurrency / notes
  const SUP = "00000000-0000-4000-8000-00000000f0a1";
  const ADM = "00000000-0000-4000-8000-00000000f0a2";
  const OB = "00000000-0000-4000-8000-00000000f0b1"; // officer of another organization
  const users = [C1, C2, C3, C4, SUP, ADM, OB];
  await db.exec(`insert into auth.users (id, raw_user_meta_data) values ${users.map((u) => `('${u}', '{}')`).join(", ")}`);
  const orgB = (await q(`insert into public.organizations (name) values ('T95 other org') returning id`)).rows[0].id;
  await db.exec(`
    update public.app_settings set default_jurisdiction_id = 'helsinki-demo';
    insert into public.jurisdictions (id, organization_id, name) values ('t95-other', '${orgB}', 'Other');
    update public.profiles set role = 'SUPERVISOR', display_name = 'Sanna T95' where id = '${SUP}';
    update public.profiles set role = 'ADMIN', display_name = 'Aaro T95' where id = '${ADM}';
    update public.profiles set role = 'OFFICER' where id = '${OB}';
    update public.profiles set display_name = 'Olli Officer' where id = '${U.officer}';
    update public.organization_members set active = true where user_id = '${U.officer}';
    insert into public.organization_members (organization_id, user_id, member_role, active) values
      ('${org}', '${SUP}', 'SUPERVISOR', true), ('${org}', '${ADM}', 'ADMIN', true), ('${orgB}', '${OB}', 'OFFICER', true);
  `);

  const call = (fn, args) => {
    const keys = Object.keys(args);
    return q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k])).then((x) => x.rows[0].r);
  };
  const r = (user, fn, args = {}) => as(user, () => call(fn, args));
  let seq = 0;
  const rid = () => `t95-req-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
  const submit = async (citizen) => {
    const sub = `t95-${++seq}`;
    await as(citizen, async () => {
      for (const s of ["FRONT", "SIDE", "REAR"]) await q(`insert into storage.objects (bucket_id, name, owner) values ('report-evidence', $1, auth.uid())`, [`${citizen}/${sub}/${s}.jpg`]);
    });
    const ev = JSON.stringify(["FRONT", "SIDE", "REAR"].map((slot) => ({ slot, capture_source: "CAMERA", storage_path: `${citizen}/${sub}/${slot}.jpg`, captured_at: new Date().toISOString() })));
    const res = (await as(citizen, () => q(`select public.submit_report($1, 'no-parking', 'Street 1', now(), now(), $2::jsonb) as r`, [sub, ev]))).rows[0].r;
    return { reportId: res.report_id, caseId: res.case_id };
  };
  const restrict = (staff, caseId, reason = "SPAM_INVALID", note = null, requestId = rid()) => r(staff, "restrict_reporter", { p_case_id: caseId, p_reason: reason, p_note: note, p_request_id: requestId });
  const revoke = (staff, caseId, actionId, reason = "Reviewed: reports were valid", requestId = rid()) =>
    r(staff, "revoke_reporter_restriction", { p_case_id: caseId, p_action_id: actionId, p_reason: reason, p_request_id: requestId });
  // Simulated passage of time (tests only): move a restriction's expiry into the past.
  const expire = async (actionId) => {
    await db.exec(`alter table public.moderation_actions disable trigger moderation_actions_immutable`);
    await q(`update public.moderation_actions set expires_at = now() - interval '1 second', created_at = now() - interval '30 days' where id = $1`, [actionId]);
    await db.exec(`alter table public.moderation_actions enable trigger moderation_actions_immutable`);
  };
  const days = (iso) => (new Date(iso) - Date.now()) / 86400000;
  const auditCount = async (citizen, ev) => Number((await q(`select count(*) n from public.audit_events where entity_type = 'profile' and entity_id = $1 and event_type = $2`, [citizen, ev])).rows[0].n);

  const k1 = await submit(C1);
  const k2 = await submit(C2);
  const k3 = await submit(C3);
  const k4 = await submit(C4);
  const kB = { caseId: (await submit(C2)).caseId };

  // ---- authorization -------------------------------------------------------
  await fails("T9.5 #8: a citizen cannot restrict another user", () => restrict(C2, k1.caseId), /FORBIDDEN/);
  await fails("T9.5 #9: anonymous calls are refused", () => anon(() => call("restrict_reporter", { p_case_id: k1.caseId, p_reason: "SPAM_INVALID", p_note: null, p_request_id: rid() })), /permission denied/);
  await fails("T9.5 #9: a citizen cannot read staff moderation data", () => r(C1, "get_reporter_moderation", { p_case_id: k1.caseId }), /FORBIDDEN/);
  await fails("T9.5 #9: a citizen cannot revoke", () => r(C1, "revoke_reporter_restriction", { p_case_id: k1.caseId, p_action_id: k1.caseId, p_reason: "please", p_request_id: rid() }), /FORBIDDEN/);
  await fails("T9.5 #9: an officer of another organization sees the case as missing", () => restrict(OB, k1.caseId), /NOT_FOUND/);
  await fails("T9.5: moderation tables are not readable or writable by clients", () => as(U.officer, () => q(`select * from public.moderation_actions`)), /permission denied/);
  await fails("T9.5: a citizen cannot write their own moderation state", () =>
    as(C1, () => q(`insert into public.moderation_actions (citizen_id, action_type, actor_user_id, actor_role, organization_id, cycle, revokes_action_id, revoke_reason, request_id) values ($1, 'RESTRICTION_REVOKED', $1, 'OFFICER', $2, 1, $1, 'self', 'self-request-1')`, [C1, org])), /permission denied/);
  await fails("T9.5: internal helpers are not callable by clients", () => as(C1, () => q(`select public.pw_reporting_restricted($1)`, [C2])), /permission denied/);
  await fails("T9.5: reason is required (invalid category refused)", () => restrict(U.officer, k1.caseId, "NOT_A_REASON"), /INVALID_INPUT/);
  await fails("T9.5: 'Other' requires a note", () => restrict(U.officer, k1.caseId, "OTHER", "  "), /INVALID_INPUT/);
  await fails("T9.5: request id is validated", () => restrict(U.officer, k1.caseId, "SPAM_INVALID", null, "x"), /INVALID_INPUT/);

  await ok("T9.5 #7: a normal citizen can submit", async () => {
    const x = await submit(C2);
    if (!x.reportId) throw new Error("not submitted");
  });

  // ---- strikes 1..3 --------------------------------------------------------
  let s1;
  await ok("T9.5 #1 #10 #19: officer restricts: 30 days, strike 1 of 3, reason recorded", async () => {
    s1 = await restrict(U.officer, k1.caseId, "SPAM_INVALID", "Six empty reports in one hour");
    const d = days(s1.restricted_until);
    if (!s1.changed || s1.status !== "TEMPORARILY_RESTRICTED" || s1.strikes !== 1 || d < 29.9 || d > 30.1) throw new Error(JSON.stringify(s1));
    const h = s1.history[0];
    if (h.reason !== "SPAM_INVALID" || h.strike_in_cycle !== 1 || h.actor_role !== "OFFICER" || h.actor_name !== "Olli Officer" || h.internal_note !== "Six empty reports in one hour") throw new Error(JSON.stringify(h));
    if ((await auditCount(C1, "REPORTING_RESTRICTED")) !== 1) throw new Error("audit");
  });
  await fails("T9.5 #5: a restricted citizen cannot submit a report", () => submit(C1), /REPORTING_RESTRICTED|row-level security|violates/);
  await fails("T9.5 #17: no bypass: new evidence upload by a restricted citizen is refused", () =>
    as(C1, () => q(`insert into storage.objects (bucket_id, name, owner) values ('report-evidence', $1, auth.uid())`, [`${C1}/bypass/FRONT.jpg`])), /row-level security|violates|permission/);
  await fails("T9.5 #17: no bypass: submit_report with already-uploaded evidence is refused (trigger on every insert path)", async () => {
    // evidence uploaded before the restriction (seeded as owner) -> submit_report itself must refuse
    await q(`insert into storage.objects (bucket_id, name, owner) values ('report-evidence', $1, $2), ('report-evidence', $3, $2), ('report-evidence', $4, $2)`, [`${C1}/t95-pre/FRONT.jpg`, C1, `${C1}/t95-pre/SIDE.jpg`, `${C1}/t95-pre/REAR.jpg`]);
    const ev = JSON.stringify(["FRONT", "SIDE", "REAR"].map((slot) => ({ slot, capture_source: "CAMERA", storage_path: `${C1}/t95-pre/${slot}.jpg`, captured_at: new Date().toISOString() })));
    await as(C1, () => q(`select public.submit_report('t95-pre', 'no-parking', 'Street 1', now(), now(), $1::jsonb)`, [ev]));
  }, /REPORTING_RESTRICTED/);
  await ok("T9.5: a restricted citizen can still sign in-level reads: own reports and own status", async () => {
    const mine = (await as(C1, () => q(`select count(*) n from public.reports where citizen_id = $1`, [C1]))).rows[0].n;
    const st = await r(C1, "get_my_moderation");
    if (Number(mine) < 1 || st.status !== "TEMPORARILY_RESTRICTED" || st.strikes !== 1 || st.max_strikes !== 3 || st.reason !== "SPAM_INVALID") throw new Error(JSON.stringify(st));
  });
  await ok("T9.5 #20: the citizen's own status never contains notes, staff names or history", async () => {
    const st = await r(C1, "get_my_moderation");
    const text = JSON.stringify(st);
    if (/internal_note|Six empty|Olli|actor|history|revoke_reason/.test(text)) throw new Error(text);
  });
  await fails("T9.5 #15: issuing again while restricted is refused (no double strike)", () => restrict(U.officer, k1.caseId), /ALREADY_RESTRICTED/);
  await ok("T9.5 #15: a retried request (same request id) returns the same action and does not add a strike", async () => {
    const reqId = rid();
    await expire(s1.active_action_id);
    const a = await restrict(U.officer, k1.caseId, "FALSE_REPORT", null, reqId);
    const b = await restrict(U.officer, k1.caseId, "FALSE_REPORT", null, reqId);
    if (!a.changed || b.changed || a.action_id !== b.action_id || b.strikes !== 2) throw new Error(JSON.stringify({ a: a.strikes, b }));
  });
  await ok("T9.5 #4: a temporary restriction ends by itself after 30 days", async () => {
    const st = await r(SUP, "get_reporter_moderation", { p_case_id: k1.caseId });
    await expire(st.active_action_id);
    const after = await r(C1, "get_my_moderation");
    if (after.status !== "ACTIVE" || after.strikes !== 2) throw new Error(JSON.stringify(after));
    const x = await submit(C1);
    if (!x.reportId) throw new Error("not restored");
  });
  await ok("T9.5 #2: second restriction (strike 2) was 30 days", async () => {
    const st = await r(U.officer, "get_reporter_moderation", { p_case_id: k1.caseId });
    const second = st.history.find((h) => h.strike_in_cycle === 2);
    if (!second || second.indefinite || !second.expires_at) throw new Error(JSON.stringify(st.history));
  });
  let s3;
  await ok("T9.5 #3 #11: third restriction (by an admin) = indefinite, strike 3 of 3", async () => {
    s3 = await restrict(ADM, k1.caseId, "MANIPULATED_EVIDENCE");
    if (s3.status !== "INDEFINITELY_RESTRICTED" || s3.restricted_until !== null || s3.strikes !== 3 || s3.history[0].actor_role !== "ADMIN") throw new Error(JSON.stringify(s3));
    if ((await auditCount(C1, "REPORTING_RESTRICTED_INDEFINITELY")) !== 1) throw new Error("audit");
  });
  await ok("T9.5 #16: the third-strike restriction cannot be outlasted (still restricted after 31 days)", async () => {
    await db.exec(`alter table public.moderation_actions disable trigger moderation_actions_immutable`);
    await q(`update public.moderation_actions set created_at = now() - interval '31 days' where id = $1`, [s3.active_action_id]);
    await db.exec(`alter table public.moderation_actions enable trigger moderation_actions_immutable`);
    const st = await r(C1, "get_my_moderation");
    if (st.status !== "INDEFINITELY_RESTRICTED") throw new Error(JSON.stringify(st));
  });
  await fails("T9.5 #6: an indefinitely restricted citizen cannot submit", () => submit(C1), /REPORTING_RESTRICTED|row-level security|violates/);
  await fails("T9.5: a 4th restriction is impossible while indefinitely restricted", () => restrict(U.officer, k1.caseId), /ALREADY_RESTRICTED/);

  // ---- revocation ------------------------------------------------------------
  let c2a;
  await ok("T9.5 #12 #13: an officer revokes a temporary restriction; access returns at once; strike kept", async () => {
    c2a = await restrict(U.officer, k2.caseId, "INAPPROPRIATE_CONTENT", "Offensive notes");
    const rv = await revoke(U.officer, k2.caseId, c2a.active_action_id, "Mistaken identity, reviewed");
    if (!rv.changed || rv.status !== "ACTIVE" || rv.strikes !== 1 || rv.lifetime_strikes !== 1) throw new Error(JSON.stringify(rv));
    if (!(await submit(C2)).reportId) throw new Error("still blocked");
  });
  await ok("T9.5 #14: revocation keeps the full history (issue + revoke, who and why)", async () => {
    const st = await r(SUP, "get_reporter_moderation", { p_case_id: k2.caseId });
    const issued = st.history.find((h) => h.type === "RESTRICTION_ISSUED");
    const rv = st.history.find((h) => h.type === "RESTRICTION_REVOKED");
    if (!issued || !rv || !issued.revoked_at || rv.revokes_action_id !== issued.id || rv.revoke_reason !== "Mistaken identity, reviewed" || rv.actor_name !== "Olli Officer") throw new Error(JSON.stringify(st.history));
    const n = Number((await q(`select count(*) n from public.moderation_actions where citizen_id = $1`, [C2])).rows[0].n);
    if (n !== 2) throw new Error(`rows ${n}`);
  });
  await fails("T9.5: a restriction can be revoked only once", () => revoke(SUP, k2.caseId, c2a.active_action_id), /NOT_ACTIVE/);
  await fails("T9.5: revoking needs a reason", () => revoke(U.officer, k1.caseId, s3.active_action_id, " "), /INVALID_INPUT/);
  await fails("T9.5: history cannot be deleted, even by the database owner", () => q(`delete from public.moderation_actions where citizen_id = $1`, [C2]), /cannot be changed or deleted/);
  await fails("T9.5: history cannot be edited", () => q(`update public.moderation_actions set reason = 'OTHER' where citizen_id = $1`, [C2]), /cannot be changed or deleted/);

  await ok("T9.5 #18: officer lifts the indefinite restriction: access restored, history kept, a new cycle starts", async () => {
    const rv = await revoke(U.officer, k1.caseId, s3.active_action_id, "Appeal accepted after review");
    if (rv.status !== "ACTIVE" || rv.strikes !== 0 || rv.lifetime_strikes !== 3 || rv.cycle !== 2) throw new Error(JSON.stringify(rv));
    if ((await auditCount(C1, "REPORTING_RESTRICTION_LIFTED_INDEFINITE")) !== 1) throw new Error("audit");
    if (!(await submit(C1)).reportId) throw new Error("still blocked");
  });
  await ok("T9.5 cycle model: after restoration the next restriction is strike 1 of 3 (30 days), lifetime strike 4 - not an instant re-lock", async () => {
    const x = await restrict(SUP, k1.caseId, "SPAM_INVALID");
    const h = x.history[0];
    if (x.status !== "TEMPORARILY_RESTRICTED" || x.strikes !== 1 || x.lifetime_strikes !== 4 || h.cycle !== 2 || h.lifetime_strike !== 4 || h.indefinite) throw new Error(JSON.stringify(x));
  });
  await ok("T9.5 cycle model: three new strikes in the new cycle lead to indefinite restriction again", async () => {
    const st = await r(SUP, "get_reporter_moderation", { p_case_id: k1.caseId });
    await expire(st.active_action_id);
    const a = await restrict(SUP, k1.caseId, "SPAM_INVALID");
    await expire(a.active_action_id);
    const b = await restrict(SUP, k1.caseId, "SPAM_INVALID");
    if (b.status !== "INDEFINITELY_RESTRICTED" || b.strikes !== 3 || b.lifetime_strikes !== 6) throw new Error(JSON.stringify(b));
  });
  await ok("T9.5 #18 (admin): an admin can lift an indefinite restriction too", async () => {
    let st;
    for (let i = 0; i < 3; i++) {
      st = await restrict(U.officer, k3.caseId, "HARASSMENT");
      if (i < 2) await expire(st.active_action_id);
    }
    const rv = await revoke(ADM, k3.caseId, st.active_action_id, "Admin review");
    if (rv.status !== "ACTIVE" || rv.history[0].actor_role !== "ADMIN") throw new Error(JSON.stringify(rv));
  });

  // ---- safety ------------------------------------------------------------------
  await fails("T9.5: staff accounts cannot be restricted", async () => {
    // a case whose reporter is staff: re-point the report to the supervisor (test-only shortcut)
    await q(`update public.reports set citizen_id = $1 where id = $2`, [SUP, kB.caseId ? (await q(`select report_id from public.officer_cases where id = $1`, [kB.caseId])).rows[0].report_id : null]);
    await restrict(U.officer, kB.caseId);
  }, /FORBIDDEN/);
  await fails("T9.5: no self-moderation", () => restrict(SUP, kB.caseId), /FORBIDDEN/);
  await ok("T9.5 #15 (concurrency): two officers restricting at the same moment produce one strike", async () => {
    const results = await Promise.allSettled([restrict(U.officer, k4.caseId, "SPAM_INVALID"), restrict(SUP, k4.caseId, "SPAM_INVALID")]);
    const okCount = results.filter((x) => x.status === "fulfilled").length;
    const n = Number((await q(`select count(*) n from public.moderation_actions where citizen_id = $1`, [C4])).rows[0].n);
    if (okCount !== 1 || n !== 1) throw new Error(JSON.stringify({ okCount, n, results: results.map((x) => x.status === "rejected" ? String(x.reason.message) : "ok") }));
  });
  await ok("T9.5 #20: another organization's notes and staff names are hidden in the history", async () => {
    // OB's org has no case of C4; give it one to read through
    const own = await q(`select id from public.reports where citizen_id = $1 limit 1`, [C4]);
    await q(`update public.officer_cases set jurisdiction_id = 't95-other' where report_id = $1`, [own.rows[0].id]);
    const st = await r(OB, "get_reporter_moderation", { p_case_id: k4.caseId });
    const h = st.history[0];
    if (h.actor_name !== null || h.internal_note !== null || h.same_organization !== false || st.status !== "TEMPORARILY_RESTRICTED") throw new Error(JSON.stringify(h));
    await q(`update public.officer_cases set jurisdiction_id = 'helsinki-demo' where report_id = $1`, [own.rows[0].id]);
  });
  await ok("T9.5: audit metadata never contains notes", async () => {
    const rows = (await q(`select metadata from public.audit_events where event_type like 'REPORTING_RESTRICT%'`)).rows;
    if (!rows.length || rows.some((x) => /internal_note|Six empty|Offensive|revoke_reason|Appeal accepted/.test(JSON.stringify(x.metadata)))) throw new Error(JSON.stringify(rows.slice(0, 2)));
  });
}
