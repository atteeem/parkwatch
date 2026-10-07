// T8.3 scenarios for scripts/verify-migrations.mjs: the server-backed core
// workflow (submit_report, lifecycle RPCs, complete_case consequences) and
// private evidence storage, executed against the REAL migrations under real
// database roles (citizens, officers of two organizations, inactive and
// profile-only "officers", anonymous).

export async function runT83(ctx) {
  const { db, q, as, anon, ok, fails, expectRows, denied, U, org } = ctx;

  const OFF2 = "00000000-0000-4000-8000-0000000000c2"; // second officer, same organization
  const OFFB = "00000000-0000-4000-8000-0000000000cb"; // officer of another organization
  const OFFX = "00000000-0000-4000-8000-0000000000ce"; // officer whose membership is inactive
  await db.exec(`insert into auth.users (id) values ('${OFF2}'), ('${OFFB}'), ('${OFFX}');
    update public.profiles set role = 'OFFICER' where id in ('${OFF2}', '${OFFB}', '${OFFX}');
    insert into public.organization_members (organization_id, user_id, member_role, active)
      values ('${org}', '${OFF2}', 'OFFICER', true), ('${org}', '${OFFX}', 'OFFICER', false);`);
  const orgB = (await q(`insert into public.organizations (name) values ('Other City') returning id`)).rows[0].id;
  await db.exec(`insert into public.jurisdictions (id, organization_id, name) values ('other-city', '${orgB}', 'Other City');
    insert into public.organization_members (organization_id, user_id, member_role) values ('${orgB}', '${OFFB}', 'OFFICER');`);

  const now = () => new Date().toISOString();
  const count = async (sql, params) => Number((await q(sql, params)).rows[0].n);
  const call = (fn, ...args) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args);
  const upload = (bucket, name) => q(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())`, [bucket, name]);
  const uploadAll = async (citizen, sub) => {
    for (const s of ["FRONT", "SIDE", "REAR"]) await upload("report-evidence", `${citizen}/${sub}/${s}.jpg`);
  };
  const evidence = (citizen, sub, mutate) => {
    const ev = ["FRONT", "SIDE", "REAR"].map((slot) => ({ slot, capture_source: "CAMERA", storage_path: `${citizen}/${sub}/${slot}.jpg`, captured_at: now() }));
    if (mutate) mutate(ev);
    return JSON.stringify(ev);
  };
  const submit = (sub, ev) =>
    q(`select public.submit_report($1, 'no-parking', 'Mannerheimintie 45, Helsinki', now(), now(), $2::jsonb, 'note', 60.17, 24.94, 6, now(), 'GHC-789', 'GHC789', 'FI') as r`, [sub, ev]);
  const freshReport = async (citizen, sub) => {
    await as(citizen, () => uploadAll(citizen, sub));
    return (await as(citizen, () => submit(sub, evidence(citizen, sub)))).rows[0].r;
  };
  const totals = () =>
    count(`select (select count(*) from public.reports) + (select count(*) from public.officer_cases) + (select count(*) from public.report_evidence)
      + (select count(*) from public.reward_ledger) + (select count(*) from public.notifications) + (select count(*) from public.enforcement_outcomes)
      + (select count(*) from public.audit_events) n`);
  const snapshot = async (user) => (await as(user, () => q(`select public.get_core_snapshot() s`))).rows[0].s;

  // ===================================================================
  // Structure / privileges
  await ok("T8.3: both evidence buckets exist and are private", async () => {
    const rows = (await q(`select id, public from storage.buckets where id in ('report-evidence', 'officer-evidence') order by id`)).rows;
    if (rows.length !== 2 || rows.some((r) => r.public)) throw new Error(JSON.stringify(rows));
  });
  await ok("T8.3: no storage policy is for anonymous/public users or unconditionally true", async () => {
    const rows = (await q(`select policyname, roles::text, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects'`)).rows;
    if (rows.length < 7) throw new Error(`policies=${rows.length}`);
    const bad = rows.filter((r) => !/authenticated/.test(r.roles) || /anon|public/.test(r.roles) || [r.qual, r.with_check].some((x) => x && /^\(?\s*true\s*\)?$/i.test(x.trim())));
    if (bad.length) throw new Error(JSON.stringify(bad));
  });
  await ok("T8.3: every SECURITY DEFINER function pins search_path", async () => {
    const rows = (await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).rows;
    if (rows.length) throw new Error(JSON.stringify(rows));
  });
  await ok("T8.3: clients cannot read server settings", async () => {
    const r = await as(U.citizenA, () => q(`select 1 from public.app_settings`).then(() => "readable", (e) => String(e.message)));
    if (!/permission denied/.test(r)) throw new Error(r);
  });
  await fails("T8.3: internal helpers are not callable by clients", () => as(U.citizenA, () => q(`select public.pw_lock_case_for_officer(gen_random_uuid())`)), /permission denied/);
  await denied("T8.3: anonymous users cannot submit reports", () => anon(() => submit("anon-1", evidence(U.citizenA, "anon-1"))));
  await denied("T8.3: anonymous users cannot read the snapshot", () => anon(() => q(`select public.get_core_snapshot()`)));

  // ===================================================================
  // Direct-write lockdown (citizen and officer)
  const directWrites = [
    ["reports", `insert into public.reports (citizen_id, source_draft_id, jurisdiction_id, violation_type, location_address, observed_at, submitted_at) values ('${U.citizenA}', 'x', 'helsinki-demo', 'no-parking', 'X', now(), now())`],
    ["report_evidence", `insert into public.report_evidence (report_id, slot, capture_source, storage_path, captured_at) values (gen_random_uuid(), 'FRONT', 'CAMERA', 'a/b.jpg', now())`],
    ["officer_cases", `insert into public.officer_cases (report_id, jurisdiction_id) values (gen_random_uuid(), 'helsinki-demo')`],
    ["reward_ledger", `insert into public.reward_ledger (citizen_id, entry_type, amount_cents, idempotency_key) values ('${U.citizenA}', 'OPENING_BALANCE', 100000, 'self')`],
    ["enforcement_outcomes", `insert into public.enforcement_outcomes (case_id, code, decided_by, decided_at) values (gen_random_uuid(), 'OTHER', '${U.officer}', now())`],
    ["audit_events", `insert into public.audit_events (actor_role, source, entity_type, entity_id, event_type) values ('CITIZEN', 'USER_ACTION', 'report', gen_random_uuid(), 'FAKE_EVENT')`],
    ["notifications", `insert into public.notifications (recipient_id, recipient_role, type, idempotency_key) values ('${U.citizenA}', 'CITIZEN', 'SYSTEM', 'fake')`],
    ["inspections", `insert into public.inspections (case_id, started_at) values (gen_random_uuid(), now())`],
  ];
  for (const [table, sql] of directWrites) {
    await fails(`T8.3: a citizen cannot write ${table} directly`, () => as(U.citizenA, () => q(sql)), /permission denied/);
    await fails(`T8.3: an officer cannot write ${table} directly`, () => as(U.officer, () => q(sql)), /permission denied/);
  }

  // ===================================================================
  // Citizen evidence storage
  await ok("T8.3: a citizen uploads evidence into their own folder", () => as(U.citizenA, () => uploadAll(U.citizenA, "sub-1")));
  await fails("T8.3: a citizen cannot upload into another citizen's folder", () => as(U.citizenA, () => upload("report-evidence", `${U.citizenB}/x/FRONT.jpg`)), /row-level security/);
  await fails("T8.3: a citizen cannot write officer-evidence", () => as(U.citizenA, () => upload("officer-evidence", `${U.citizenA}/x.jpg`)), /row-level security/);
  await expectRows("T8.3: citizen A reads their own uploaded evidence", () => as(U.citizenA, () => q(`select name from storage.objects where bucket_id = 'report-evidence'`)), 3);
  await expectRows("T8.3: citizen B cannot read citizen A's evidence", () => as(U.citizenB, () => q(`select name from storage.objects where bucket_id = 'report-evidence'`)), 0);
  await expectRows("T8.3: officers cannot read evidence that is not attached to a report in their area", () => as(U.officer, () => q(`select name from storage.objects where bucket_id = 'report-evidence'`)), 0);

  // ===================================================================
  // submit_report
  await fails("T8.3: submission without uploaded photos is refused", () => as(U.citizenA, () => submit("sub-missing", evidence(U.citizenA, "sub-missing"))), /EVIDENCE_NOT_UPLOADED/);
  await fails("T8.3: a library image cannot be a required photo", () =>
    as(U.citizenA, async () => {
      await uploadAll(U.citizenA, "sub-lib");
      return submit("sub-lib", evidence(U.citizenA, "sub-lib", (ev) => (ev[0].capture_source = "LIBRARY")));
    }), /INVALID_DRAFT/);
  await fails("T8.3: a missing required angle is refused", () => as(U.citizenA, () => submit("sub-lib", evidence(U.citizenA, "sub-lib", (ev) => ev.pop()))), /INVALID_DRAFT/);
  await fails("T8.3: evidence paths of another submission are refused", () => as(U.citizenA, () => submit("sub-other", evidence(U.citizenA, "sub-1"))), /EVIDENCE_NOT_UPLOADED/);
  await fails("T8.3: another citizen's uploaded files cannot be referenced", () =>
    as(U.citizenB, () => submit("sub-1", evidence(U.citizenA, "sub-1"))), /EVIDENCE_NOT_UPLOADED/);
  for (const [param, value] of [["p_citizen_id", U.citizenB], ["p_status", "VERIFIED"], ["p_reward_amount_cents", 999999], ["p_case_status", "COMPLETED"],
    ["p_public_report_number", 1], ["p_received_at", "2000-01-01T00:00:00Z"], ["p_jurisdiction_id", "other-city"]]) {
    await fails(`T8.3: the client cannot pass ${param} (no such parameter exists)`, () =>
      as(U.citizenA, () => q(`select public.submit_report(p_submission_id => 'sub-x', p_violation_type => 'no-parking', p_location_address => 'X',
        p_observed_at => now(), p_submitted_at => now(), p_evidence => $1::jsonb, ${param} => $2)`, [evidence(U.citizenA, "sub-1"), value])),
      /does not exist|function public\.submit_report/);
  }
  await db.exec(`update public.app_settings set default_jurisdiction_id = null`);
  await fails("T8.3: with no enforcement area configured, submission fails with NO_JURISDICTION", () => as(U.citizenA, () => submit("sub-1", evidence(U.citizenA, "sub-1"))), /NO_JURISDICTION/);
  if ((await count(`select count(*) n from public.reports where source_draft_id = 'sub-1'`)) !== 0) throw new Error("NO_JURISDICTION left a report behind");
  await db.exec(`update public.app_settings set default_jurisdiction_id = 'helsinki-demo'`);

  let sub1;
  await ok("T8.3: submit_report creates exactly one report, case, 3 evidence rows, pending 5.00 reward, notification and audit", async () => {
    const before = (await q(`select (select count(*) from public.reports) r, (select count(*) from public.officer_cases) c, (select count(*) from public.reward_ledger) l`)).rows[0];
    sub1 = (await as(U.citizenA, () => submit("sub-1", evidence(U.citizenA, "sub-1")))).rows[0].r;
    const after = (await q(`select (select count(*) from public.reports) r, (select count(*) from public.officer_cases) c, (select count(*) from public.reward_ledger) l`)).rows[0];
    const r = (await q(`select citizen_id, status, jurisdiction_id, priority, public_report_number, received_at from public.reports where id = $1`, [sub1.report_id])).rows[0];
    const ev = (await q(`select slot, capture_source from public.report_evidence where report_id = $1 order by slot`, [sub1.report_id])).rows;
    const cs = (await q(`select id, status, assigned_officer_id, jurisdiction_id from public.officer_cases where report_id = $1`, [sub1.report_id])).rows;
    const led = (await q(`select entry_type, amount_cents, citizen_id from public.reward_ledger where report_id = $1`, [sub1.report_id])).rows;
    const n = (await q(`select type from public.notifications where report_id = $1`, [sub1.report_id])).rows.map((x) => x.type);
    const audit = (await q(`select event_type from public.audit_events where entity_id in ($1, $2) order by event_type`, [sub1.report_id, sub1.case_id])).rows.map((x) => x.event_type);
    const good =
      sub1.created === true && Number(after.r) - Number(before.r) === 1 && Number(after.c) - Number(before.c) === 1 && Number(after.l) - Number(before.l) === 1 &&
      r.citizen_id === U.citizenA && r.status === "UNDER_REVIEW" && r.jurisdiction_id === "helsinki-demo" && r.priority === "NORMAL" && r.received_at &&
      String(r.public_report_number) === String(sub1.public_report_number) && Number(r.public_report_number) >= 100000 && sub1.report_id !== String(r.public_report_number) &&
      ev.length === 3 && ev.every((e) => e.capture_source === "CAMERA") &&
      cs.length === 1 && cs[0].id === sub1.case_id && cs[0].status === "NEW" && cs[0].assigned_officer_id === null && cs[0].jurisdiction_id === "helsinki-demo" &&
      led.length === 1 && led[0].entry_type === "REWARD_PENDING" && led[0].amount_cents === 500 && led[0].citizen_id === U.citizenA &&
      JSON.stringify(n) === '["REPORT_UNDER_REVIEW"]' && JSON.stringify(audit) === '["CASE_CREATED","REPORT_SUBMITTED","REWARD_CHANGED"]';
    if (!good) throw new Error(JSON.stringify({ sub1, before, after, r, ev, cs, led, n, audit }));
  });
  await ok("T8.3: retrying the same submission (after the server already executed it) returns the same report and adds nothing", async () => {
    const before = await totals();
    const again = (await as(U.citizenA, () => submit("sub-1", evidence(U.citizenA, "sub-1")))).rows[0].r;
    const third = (await as(U.citizenA, () => submit("sub-1", evidence(U.citizenA, "sub-1")))).rows[0].r;
    const after = await totals();
    if (again.created !== false || third.created !== false || again.report_id !== sub1.report_id || again.case_id !== sub1.case_id ||
        String(again.public_report_number) !== String(sub1.public_report_number) || before !== after) throw new Error(JSON.stringify({ again, before, after }));
  });
  await fails("T8.3: officer accounts cannot submit citizen reports", () => as(U.officer, () => submit("o-1", evidence(U.officer, "o-1"))), /FORBIDDEN/);
  await ok("T8.3: a second report gets a different public number", async () => {
    const s2 = await freshReport(U.citizenA, "sub-numbers");
    if (String(s2.public_report_number) === String(sub1.public_report_number)) throw new Error("duplicate number");
    // close it so it does not interfere with the queue scenarios
    await q(`update public.officer_cases set status = 'COMPLETED', completed_at = now() where id = $1`, [s2.case_id]);
  });

  // ===================================================================
  // Reads (RLS) and evidence visibility
  await ok("T8.3: the citizen's snapshot shows their reports but no officer queue", async () => {
    const s = await snapshot(U.citizenA);
    if (!s.reports.some((r) => r.id === sub1.report_id) || s.cases.length !== 0 || s.outcomes.length || s.inspections.length || s.officer_evidence.length)
      throw new Error(JSON.stringify({ r: s.reports.length, c: s.cases.length }));
  });
  await ok("T8.3: citizen B's snapshot shows none of citizen A's data", async () => {
    const s = await snapshot(U.citizenB);
    if (s.reports.length || s.cases.length || s.ledger.length || s.notifications.length || s.report_evidence.length) throw new Error(JSON.stringify(s));
  });
  await ok("T8.3: an authorized officer's snapshot contains the new case and report", async () => {
    const s = await snapshot(U.officer);
    if (!s.cases.some((c) => c.id === sub1.case_id) || !s.reports.some((r) => r.id === sub1.report_id) || s.report_evidence.filter((e) => e.report_id === sub1.report_id).length !== 3)
      throw new Error("missing");
  });
  for (const [label, user] of [["an officer of another organization", OFFB], ["an inactive officer", OFFX], ["a profile-only 'officer'", U.fakeOfficer], ["a citizen", U.citizenB]]) {
    await ok(`T8.3: ${label} does not see the case`, async () => {
      const s = await snapshot(user);
      if (s.cases.some((c) => c.id === sub1.case_id) || s.reports.some((r) => r.id === sub1.report_id)) throw new Error("visible");
    });
  }
  await expectRows("T8.3: an authorized officer can read the evidence of a case in their area", () =>
    as(U.officer, () => q(`select name from storage.objects where bucket_id = 'report-evidence' and name like $1`, [`${U.citizenA}/sub-1/%`])), 3);
  await expectRows("T8.3: an officer of another organization cannot read it", () => as(OFFB, () => q(`select name from storage.objects where bucket_id = 'report-evidence'`)), 0);
  await expectRows("T8.3: an inactive officer cannot read it", () => as(OFFX, () => q(`select name from storage.objects where bucket_id = 'report-evidence'`)), 0);
  await expectRows("T8.3: a profile-only 'officer' cannot read it", () => as(U.fakeOfficer, () => q(`select name from storage.objects where bucket_id = 'report-evidence'`)), 0);
  await ok("T8.3: a citizen cannot delete evidence already attached to a report", async () => {
    await as(U.citizenA, () => q(`delete from storage.objects where bucket_id = 'report-evidence' and name = $1`, [`${U.citizenA}/sub-1/FRONT.jpg`]));
    if ((await count(`select count(*) n from storage.objects where name = $1`, [`${U.citizenA}/sub-1/FRONT.jpg`])) !== 1) throw new Error("deleted");
  });
  await ok("T8.3: a citizen can clean up an unattached upload of a failed submission", async () => {
    await as(U.citizenA, () => q(`delete from storage.objects where bucket_id = 'report-evidence' and name like $1`, [`${U.citizenA}/sub-lib/%`]));
    if ((await count(`select count(*) n from storage.objects where name like $1`, [`${U.citizenA}/sub-lib/%`])) !== 0) throw new Error("not deleted");
  });

  // ===================================================================
  // Lifecycle + accept race
  await fails("T8.3: start_en_route before acceptance fails", () => as(U.officer, () => call("start_en_route", sub1.case_id)), /INVALID_TRANSITION/);
  await fails("T8.3: start_inspection before acceptance fails", () => as(U.officer, () => call("start_inspection", sub1.case_id)), /INVALID_TRANSITION/);
  await fails("T8.3: a citizen cannot accept a case", () => as(U.citizenA, () => call("accept_case", sub1.case_id)), /FORBIDDEN/);
  await fails("T8.3: a citizen cannot start en route", () => as(U.citizenA, () => call("start_en_route", sub1.case_id)), /FORBIDDEN/);
  await fails("T8.3: an officer of another organization cannot accept it", () => as(OFFB, () => call("accept_case", sub1.case_id)), /FORBIDDEN/);
  await fails("T8.3: an inactive officer cannot accept it", () => as(OFFX, () => call("accept_case", sub1.case_id)), /FORBIDDEN/);
  await fails("T8.3: a profile-only 'officer' cannot accept it", () => as(U.fakeOfficer, () => call("accept_case", sub1.case_id)), /FORBIDDEN/);
  await ok("T8.3: accept race: officer A wins (NEW -> EN_ROUTE), officer B gets CASE_TAKEN, one assignment, one accept event", async () => {
    const a = (await as(U.officer, () => call("accept_case", sub1.case_id))).rows[0].r;
    const b = await as(OFF2, () => call("accept_case", sub1.case_id).then(() => "accepted", (e) => String(e.message)));
    const c = (await q(`select status, assigned_officer_id, assigned_at, en_route_at from public.officer_cases where id = $1`, [sub1.case_id])).rows[0];
    const ev = await count(`select count(*) n from public.audit_events where entity_id = $1 and event_type = 'CASE_ACCEPTED'`, [sub1.case_id]);
    if (!a.changed || !/CASE_TAKEN/.test(b) || c.status !== "EN_ROUTE" || c.assigned_officer_id !== U.officer || !c.assigned_at || !c.en_route_at || ev !== 1)
      throw new Error(JSON.stringify({ a, b, c, ev }));
  });
  await ok("T8.3: the winner retrying accept is a harmless no-op (same timestamp, no new event)", async () => {
    const t = (await q(`select assigned_at from public.officer_cases where id = $1`, [sub1.case_id])).rows[0].assigned_at;
    const r = (await as(U.officer, () => call("accept_case", sub1.case_id))).rows[0].r;
    const t2 = (await q(`select assigned_at from public.officer_cases where id = $1`, [sub1.case_id])).rows[0].assigned_at;
    const ev = await count(`select count(*) n from public.audit_events where entity_id = $1 and event_type = 'CASE_ACCEPTED'`, [sub1.case_id]);
    if (r.changed || String(t) !== String(t2) || ev !== 1) throw new Error(JSON.stringify({ r, t, t2, ev }));
  });
  await fails("T8.3: the wrong officer cannot start en route", () => as(OFF2, () => call("start_en_route", sub1.case_id)), /CASE_TAKEN/);
  await fails("T8.3: the wrong officer cannot start the inspection", () => as(OFF2, () => call("start_inspection", sub1.case_id)), /CASE_TAKEN/);
  await fails("T8.3: a charge before the inspection is an invalid transition", () => as(U.officer, () => call("complete_case", sub1.case_id, "CHARGE_ISSUED")), /INVALID_TRANSITION/);
  await fails("T8.3: checks cannot be answered before the inspection", () => as(U.officer, () => call("set_inspection_check", sub1.case_id, "vehiclePresent", true)), /INVALID_TRANSITION/);

  await ok("T8.3: ASSIGNED -> EN_ROUTE via start_en_route for a pre-assigned case", async () => {
    const s = await freshReport(U.citizenB, "assigned-1");
    await q(`update public.officer_cases set status = 'ASSIGNED', assigned_officer_id = $2, assigned_at = now() where id = $1`, [s.case_id, OFF2]);
    const r = (await as(OFF2, () => call("start_en_route", s.case_id))).rows[0].r;
    const again = (await as(OFF2, () => call("start_en_route", s.case_id))).rows[0].r;
    const st = (await q(`select status from public.officer_cases where id = $1`, [s.case_id])).rows[0].status;
    if (!r.changed || again.changed || st !== "EN_ROUTE") throw new Error(JSON.stringify({ r, again, st }));
    await q(`update public.officer_cases set status = 'COMPLETED', completed_at = now() where id = $1`, [s.case_id]);
  });

  await ok("T8.3: start_inspection: INSPECTION with four UNANSWERED checks; repeating keeps answers", async () => {
    const r = (await as(U.officer, () => call("start_inspection", sub1.case_id))).rows[0].r;
    await as(U.officer, () => call("set_inspection_check", sub1.case_id, "violationConfirmed", true));
    const again = (await as(U.officer, () => call("start_inspection", sub1.case_id))).rows[0].r;
    const checks = (await q(`select check_key, answer from public.inspection_checks k join public.inspections i on i.id = k.inspection_id where i.case_id = $1 order by check_key`, [sub1.case_id])).rows;
    const st = (await q(`select status, inspection_started_at from public.officer_cases where id = $1`, [sub1.case_id])).rows[0];
    const kept = checks.find((k) => k.check_key === "violationConfirmed").answer === true;
    if (!r.changed || again.changed || checks.length !== 4 || !kept || checks.filter((k) => k.answer === null).length !== 3 || st.status !== "INSPECTION" || !st.inspection_started_at)
      throw new Error(JSON.stringify({ r, again, checks, st }));
  });
  await ok("T8.3: tri-state: NO is stored as false with a time; clearing returns to unanswered", async () => {
    await as(U.officer, () => call("set_inspection_check", sub1.case_id, "vehiclePresent", false));
    const no = (await q(`select answer, answered_at from public.inspection_checks k join public.inspections i on i.id = k.inspection_id where i.case_id = $1 and check_key = 'vehiclePresent'`, [sub1.case_id])).rows[0];
    await as(U.officer, () => call("set_inspection_check", sub1.case_id, "vehiclePresent", null));
    const cleared = (await q(`select answer, answered_at from public.inspection_checks k join public.inspections i on i.id = k.inspection_id where i.case_id = $1 and check_key = 'vehiclePresent'`, [sub1.case_id])).rows[0];
    if (no.answer !== false || !no.answered_at || cleared.answer !== null || cleared.answered_at !== null) throw new Error(JSON.stringify({ no, cleared }));
  });
  await fails("T8.3: the wrong officer cannot answer checks", () => as(OFF2, () => call("set_inspection_check", sub1.case_id, "vehiclePresent", true)), /CASE_TAKEN/);
  await fails("T8.3: a citizen cannot answer checks", () => as(U.citizenA, () => call("set_inspection_check", sub1.case_id, "vehiclePresent", true)), /FORBIDDEN/);
  await fails("T8.3: a citizen cannot use Confirm Plate", () => as(U.citizenA, () => call("confirm_plate_by_scan", sub1.case_id)), /FORBIDDEN/);

  // ===================================================================
  // Officer evidence
  const offPath = (caseId, t) => `${caseId}/${t}.jpg`;
  await fails("T8.3: the wrong officer cannot upload enforcement evidence", () => as(OFF2, () => upload("officer-evidence", offPath(sub1.case_id, "x"))), /row-level security/);
  await fails("T8.3: an inactive officer cannot upload enforcement evidence", () => as(OFFX, () => upload("officer-evidence", offPath(sub1.case_id, "x"))), /row-level security/);
  await fails("T8.3: a citizen cannot upload enforcement evidence", () => as(U.citizenA, () => upload("officer-evidence", offPath(sub1.case_id, "x"))), /row-level security/);
  await fails("T8.3: evidence that was not uploaded is refused", () => as(U.officer, () => call("add_officer_evidence", sub1.case_id, "PARKING_SIGN", offPath(sub1.case_id, "missing"), now())), /EVIDENCE_NOT_UPLOADED/);
  await fails("T8.3: citizen evidence cannot be registered as officer evidence", () =>
    as(U.officer, () => call("add_officer_evidence", sub1.case_id, "PARKING_SIGN", `${U.citizenA}/sub-1/FRONT.jpg`, now())), /EVIDENCE_NOT_UPLOADED/);
  await ok("T8.3: the wrong officer cannot register evidence even for an uploaded file", async () => {
    await as(U.officer, () => upload("officer-evidence", offPath(sub1.case_id, "VEHICLE_FRONT")));
    const r = await as(OFF2, () => call("add_officer_evidence", sub1.case_id, "VEHICLE_FRONT", offPath(sub1.case_id, "VEHICLE_FRONT"), now()).then(() => "ok", (e) => String(e.message)));
    if (!/CASE_TAKEN/.test(r)) throw new Error(r);
  });
  await fails("T8.3: a citizen cannot register officer evidence", () =>
    as(U.citizenA, () => call("add_officer_evidence", sub1.case_id, "VEHICLE_FRONT", offPath(sub1.case_id, "VEHICLE_FRONT"), now())), /FORBIDDEN/);

  // ===================================================================
  // CHARGE_ISSUED requirements (server-side) and consequences
  const charge = () => as(U.officer, () => call("complete_case", sub1.case_id, "CHARGE_ISSUED", "clear violation"));
  await fails("T8.3: charge with unanswered checks is refused", charge, /INSPECTION_NOT_READY/);
  await ok("T8.3: officer answers all checks yes except one NO, registers one photo", () =>
    as(U.officer, async () => {
      for (const key of ["vehiclePresent", "violationConfirmed"]) await call("set_inspection_check", sub1.case_id, key, true);
      await call("set_inspection_check", sub1.case_id, "restrictionVerified", false);
      await call("confirm_plate_by_scan", sub1.case_id);
      await call("add_officer_evidence", sub1.case_id, "VEHICLE_FRONT", offPath(sub1.case_id, "VEHICLE_FRONT"), now());
    }));
  await fails("T8.3: charge with one check answered NO is refused", charge, /INSPECTION_NOT_READY/);
  await ok("T8.3: Confirm Plate records the plate check as YES via the simulated control", async () => {
    const r = (await q(`select k.answer, i.plate_confirmed_via_scan_at from public.inspection_checks k join public.inspections i on i.id = k.inspection_id where i.case_id = $1 and k.check_key = 'plateMatches'`, [sub1.case_id])).rows[0];
    if (r.answer !== true || !r.plate_confirmed_via_scan_at) throw new Error(JSON.stringify(r));
  });
  await ok("T8.3: officer changes the NO answer to YES", () => as(U.officer, () => call("set_inspection_check", sub1.case_id, "restrictionVerified", true)));
  await fails("T8.3: charge with only one officer photo is refused", charge, /INSPECTION_NOT_READY/);
  await ok("T8.3: officer uploads and registers plate and sign photos", () => as(U.officer, async () => {
    for (const t of ["LICENSE_PLATE", "PARKING_SIGN"]) {
      await upload("officer-evidence", offPath(sub1.case_id, t));
      await call("add_officer_evidence", sub1.case_id, t, offPath(sub1.case_id, t), now());
    }
  }));
  await fails("T8.3: charge with three of four officer photos is refused", charge, /INSPECTION_NOT_READY/);
  await ok("T8.3: a retake replaces the photo in its slot (one row per slot)", async () => {
    await as(U.officer, async () => {
      await upload("officer-evidence", offPath(sub1.case_id, "PARKING_SIGN-2"));
      await call("add_officer_evidence", sub1.case_id, "PARKING_SIGN", offPath(sub1.case_id, "PARKING_SIGN-2"), now());
    });
    const rows = (await q(`select storage_path from public.officer_evidence where case_id = $1 and evidence_type = 'PARKING_SIGN'`, [sub1.case_id])).rows;
    if (rows.length !== 1 || !rows[0].storage_path.endsWith("PARKING_SIGN-2.jpg")) throw new Error(JSON.stringify(rows));
  });
  await ok("T8.3: officer uploads and registers the fourth photo", () => as(U.officer, async () => {
    await upload("officer-evidence", offPath(sub1.case_id, "VEHICLE_REAR"));
    await call("add_officer_evidence", sub1.case_id, "VEHICLE_REAR", offPath(sub1.case_id, "VEHICLE_REAR"), now());
  }));
  await expectRows("T8.3: the citizen cannot read officer evidence files", () => as(U.citizenA, () => q(`select name from storage.objects where bucket_id = 'officer-evidence'`)), 0);
  await expectRows("T8.3: an officer of another organization cannot read them", () => as(OFFB, () => q(`select name from storage.objects where bucket_id = 'officer-evidence'`)), 0);
  await ok("T8.3: officers of the same organization can read the case's officer evidence", async () => {
    const rows = (await as(U.officer, () => q(`select name from storage.objects where bucket_id = 'officer-evidence'`))).rows;
    if (rows.length < 4) throw new Error(`rows=${rows.length}`);
  });
  await fails("T8.3: the client cannot pass a charge amount (no such parameter)", () =>
    as(U.officer, () => q(`select public.complete_case(p_case_id => $1, p_code => 'CHARGE_ISSUED', p_parking_charge_amount_cents => 1)`, [sub1.case_id])), /does not exist|function public\.complete_case/);

  await ok("T8.3: CHARGE_ISSUED: completed, server charge 6000, VERIFIED, 5.00 released once, exactly the right notifications and audit", async () => {
    const r = (await charge()).rows[0].r;
    const o = (await q(`select code, parking_charge_amount_cents, decided_by, inspection_id, notes from public.enforcement_outcomes where case_id = $1`, [sub1.case_id])).rows;
    const c = (await q(`select status, completed_at from public.officer_cases where id = $1`, [sub1.case_id])).rows[0];
    const insp = (await q(`select completed_at from public.inspections where case_id = $1`, [sub1.case_id])).rows[0];
    const rep = (await q(`select status, resolved_at from public.reports where id = $1`, [sub1.report_id])).rows[0];
    const led = (await q(`select entry_type, amount_cents from public.reward_ledger where report_id = $1 order by created_at, entry_type desc`, [sub1.report_id])).rows;
    const cn = (await q(`select type, amount_cents from public.notifications where report_id = $1 and recipient_id = $2 order by created_at`, [sub1.report_id, U.citizenA])).rows;
    const on = (await q(`select type, amount_cents from public.notifications where case_id = $1 and recipient_id = $2 order by created_at`, [sub1.case_id, U.officer])).rows;
    const audit = (await q(`select event_type from public.audit_events where entity_id in ($1, $2) and event_type in ('OUTCOME_RECORDED', 'CASE_COMPLETED', 'REPORT_STATUS_RESOLVED') order by event_type`, [sub1.case_id, sub1.report_id])).rows.map((x) => x.event_type);
    const good = r.changed && r.credited_cents === 500 && o.length === 1 && o[0].code === "CHARGE_ISSUED" && o[0].parking_charge_amount_cents === 6000 && o[0].decided_by === U.officer &&
      o[0].inspection_id && o[0].notes === "clear violation" && c.status === "COMPLETED" && c.completed_at && insp.completed_at && rep.status === "VERIFIED" && rep.resolved_at &&
      JSON.stringify(led.map((l) => l.entry_type).sort()) === '["REWARD_PENDING","REWARD_RELEASED"]' && led.every((l) => l.amount_cents === 500) &&
      JSON.stringify(cn) === '[{"type":"REPORT_UNDER_REVIEW","amount_cents":null},{"type":"REPORT_VERIFIED","amount_cents":500}]' &&
      JSON.stringify(on) === '[{"type":"CASE_ACCEPTED","amount_cents":null},{"type":"PARKING_CHARGE_ISSUED","amount_cents":6000}]' &&
      JSON.stringify(audit) === '["CASE_COMPLETED","OUTCOME_RECORDED","REPORT_STATUS_RESOLVED"]';
    if (!good) throw new Error(JSON.stringify({ r, o, c, insp, rep, led, cn, on, audit }));
  });
  await ok("T8.3: repeating complete_case adds nothing (no second credit, outcome, notification or audit)", async () => {
    const before = await totals();
    const r = (await charge()).rows[0].r;
    const r2 = (await charge()).rows[0].r;
    if (r.changed || r2.changed || r.credited_cents !== 0 || before !== (await totals())) throw new Error(JSON.stringify({ r, before }));
  });
  await fails("T8.3: a different result for a completed case is refused", () => as(U.officer, () => call("complete_case", sub1.case_id, "REPORT_REJECTED")), /ALREADY_COMPLETED/);
  await fails("T8.3: a completed inspection cannot change", () => as(U.officer, () => call("set_inspection_check", sub1.case_id, "vehiclePresent", false)), /INVALID_TRANSITION/);
  await ok("T8.3: the citizen's balance shows 5.00 available, nothing pending (derived from the ledger)", async () => {
    const b = (await as(U.citizenA, () => q(`select pending_cents, available_cents from public.reward_balances`))).rows[0];
    // sub-numbers report is still pending (500) - it was never decided.
    if (Number(b.available_cents) !== 500 || Number(b.pending_cents) !== 500) throw new Error(JSON.stringify(b));
  });
  await expectRows("T8.3: the citizen still cannot read the case, inspection or outcome rows", () =>
    as(U.citizenA, () => q(`select 1 from public.officer_cases union all select 1 from public.enforcement_outcomes union all select 1 from public.inspections`)), 0);

  // ===================================================================
  // REPORT_REJECTED and the unresolved outcomes, each on its own case
  async function outcomeCase(sub, code, prepare) {
    const s = await freshReport(U.citizenA, sub);
    if (prepare) await prepare(s);
    const first = (await as(U.officer, () => call("complete_case", s.case_id, code))).rows[0].r;
    const before = await totals();
    const repeat = (await as(U.officer, () => call("complete_case", s.case_id, code))).rows[0].r;
    const after = await totals();
    const c = (await q(`select status from public.officer_cases where id = $1`, [s.case_id])).rows[0];
    const o = (await q(`select code, parking_charge_amount_cents from public.enforcement_outcomes where case_id = $1`, [s.case_id])).rows;
    const rep = (await q(`select status, resolved_at from public.reports where id = $1`, [s.report_id])).rows[0];
    const led = (await q(`select entry_type from public.reward_ledger where report_id = $1`, [s.report_id])).rows.map((x) => x.entry_type).sort();
    const cn = (await q(`select type from public.notifications where report_id = $1 and recipient_id = $2 order by created_at`, [s.report_id, U.citizenA])).rows.map((x) => x.type);
    const on = (await q(`select type from public.notifications where case_id = $1 and recipient_id = $2 and type <> 'CASE_ACCEPTED'`, [s.case_id, U.officer])).rows.map((x) => x.type);
    return { first, repeat, idempotent: before === after, c, o, rep, led, cn, on };
  }
  const accept = (s) => as(U.officer, () => call("accept_case", s.case_id));
  const inspect = async (s) => {
    await accept(s);
    await as(U.officer, () => call("start_inspection", s.case_id));
  };

  await ok("T8.3: REPORT_REJECTED: completed, report REJECTED, reward cancelled, citizen told, officer notified, idempotent", async () => {
    const x = await outcomeCase("rej-1", "REPORT_REJECTED");
    const good = x.first.changed && !x.repeat.changed && x.idempotent && x.c.status === "COMPLETED" && x.o.length === 1 && x.o[0].code === "REPORT_REJECTED" &&
      x.o[0].parking_charge_amount_cents === null && x.rep.status === "REJECTED" && x.rep.resolved_at &&
      JSON.stringify(x.led) === '["REWARD_PENDING","REWARD_VOIDED"]' && JSON.stringify(x.cn) === '["REPORT_UNDER_REVIEW","REPORT_REJECTED"]' &&
      JSON.stringify(x.on) === '["CASE_CLOSED_WITHOUT_CHARGE"]';
    if (!good) throw new Error(JSON.stringify(x));
  });
  const unresolved = [
    ["VEHICLE_MOVED", accept],
    ["VALID_PERMIT", inspect],
    ["DUPLICATE", null],
    ["OTHER", accept],
  ];
  for (const [code, prepare] of unresolved) {
    await ok(`T8.3: ${code}: completed, citizen status unchanged (not REJECTED/VERIFIED), reward cancelled, no citizen outcome notification`, async () => {
      const x = await outcomeCase(`un-${code}`, code, prepare);
      const good = x.first.changed && !x.repeat.changed && x.idempotent && x.c.status === "COMPLETED" && x.o.length === 1 && x.o[0].code === code &&
        x.o[0].parking_charge_amount_cents === null && x.rep.status === "UNDER_REVIEW" && x.rep.resolved_at === null &&
        JSON.stringify(x.led) === '["REWARD_PENDING","REWARD_VOIDED"]' && JSON.stringify(x.cn) === '["REPORT_UNDER_REVIEW"]' &&
        JSON.stringify(x.on) === '["CASE_CLOSED_WITHOUT_CHARGE"]';
      if (!good) throw new Error(JSON.stringify(x));
    });
  }
  await ok("T8.3: completion-from-state table matches the domain (VEHICLE_MOVED/OTHER need en route, VALID_PERMIT on site, CHARGE inspection)", async () => {
    const s = await freshReport(U.citizenA, "states-1");
    const tryCode = (code) => as(U.officer, () => call("complete_case", s.case_id, code).then(() => "ok", (e) => (/INVALID_TRANSITION/.test(e.message) ? "invalid" : e.message)));
    const fromNew = [await tryCode("VEHICLE_MOVED"), await tryCode("OTHER"), await tryCode("VALID_PERMIT"), await tryCode("CHARGE_ISSUED")];
    await accept(s);
    const fromEnRoute = [await tryCode("VALID_PERMIT"), await tryCode("CHARGE_ISSUED")];
    if (fromNew.some((v) => v !== "invalid") || fromEnRoute.some((v) => v !== "invalid")) throw new Error(JSON.stringify({ fromNew, fromEnRoute }));
    await as(U.officer, () => call("complete_case", s.case_id, "OTHER"));
  });

  // ===================================================================
  // Isolation, read marking, membership revocation
  await ok("T8.3: citizen A cannot see citizen B's reports, rewards or notifications (and vice versa)", async () => {
    const a = await snapshot(U.citizenA);
    const b = await snapshot(U.citizenB);
    const leakA = a.reports.some((r) => r.citizen_id !== U.citizenA) || a.ledger.some((l) => l.citizen_id !== U.citizenA) || a.notifications.some((n) => n.recipient_id !== U.citizenA);
    const leakB = b.reports.some((r) => r.citizen_id !== U.citizenB) || b.ledger.some((l) => l.citizen_id !== U.citizenB) || b.notifications.some((n) => n.recipient_id !== U.citizenB);
    if (leakA || leakB || b.reports.length === 0) throw new Error(JSON.stringify({ leakA, leakB }));
  });
  await ok("T8.3: marking notifications read touches only the caller's own", async () => {
    const bUnread = await count(`select count(*) n from public.notifications where recipient_id = $1 and read_at is null`, [U.citizenB]);
    const r = (await as(U.citizenA, () => q(`select public.mark_my_notifications_read() r`))).rows[0].r;
    const aUnread = await count(`select count(*) n from public.notifications where recipient_id = $1 and read_at is null`, [U.citizenA]);
    const bAfter = await count(`select count(*) n from public.notifications where recipient_id = $1 and read_at is null`, [U.citizenB]);
    if (aUnread !== 0 || bAfter !== bUnread || bUnread === 0 || Number(r.updated) === 0) throw new Error(JSON.stringify({ r, aUnread, bUnread, bAfter }));
  });
  await ok("T8.3: deactivating a membership removes access at once; re-activating restores it", async () => {
    const s = await freshReport(U.citizenB, "revoke-1");
    await db.exec(`update public.organization_members set active = false where user_id = '${OFF2}'`);
    const denied1 = await as(OFF2, () => call("accept_case", s.case_id).then(() => "ok", (e) => String(e.message)));
    const seen = (await snapshot(OFF2)).cases.length;
    await db.exec(`update public.organization_members set active = true where user_id = '${OFF2}'`);
    const r = (await as(OFF2, () => call("accept_case", s.case_id))).rows[0].r;
    if (!/FORBIDDEN/.test(denied1) || seen !== 0 || !r.changed) throw new Error(JSON.stringify({ denied1, seen, r }));
  });
  await ok("T8.3: public report numbers are unique and never equal the UUID", async () => {
    const rows = (await q(`select id::text, public_report_number::text n from public.reports`)).rows;
    if (new Set(rows.map((r) => r.n)).size !== rows.length || rows.some((r) => r.id === r.n)) throw new Error("duplicate");
  });
}
