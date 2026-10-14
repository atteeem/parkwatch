// T9.2 scenarios for scripts/verify-migrations.mjs: push device registration,
// the push outbox and its trusted sender API, citizen/officer notification
// rules, supervisor case assignment and "needs attention", against the REAL
// migrations under real database roles. Runs after the T9.0 modules and
// reuses their accounts (organization A = helsinki-demo, B = other-city).

export async function runT92(ctx) {
  const { db, q, as, anon, ok, fails, denied, U, org } = ctx;
  const OFF2 = "00000000-0000-4000-8000-0000000000c2"; // officer, org A (T8.3)
  const OFFX = "00000000-0000-4000-8000-0000000000ce"; // inactive officer, org A (T8.3)
  const OFFB = "00000000-0000-4000-8000-0000000000cb"; // officer, org B (T8.3)
  const supA = "00000000-0000-4000-8000-00000000a0a1";
  const supB = "00000000-0000-4000-8000-00000000b0b1";
  const supInactive = "00000000-0000-4000-8000-00000000a0a2";
  const adminA = "00000000-0000-4000-8000-00000000a0a3";
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  await db.exec(`
    update public.app_settings set default_jurisdiction_id = 'helsinki-demo';
    update public.organization_members set active = true where user_id in ('${U.officer}', '${OFF2}');
    update public.profiles set display_name = 'Olga Officer' where id = '${OFF2}';
  `);

  const named = (fn, args = {}) => {
    const keys = Object.keys(args);
    return q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
  };
  const r = async (user, fn, args = {}) => (await as(user, () => named(fn, args))).rows[0].r;
  const err = (p) => p.then(() => "allowed", (e) => String(e.message));
  const n = async (sql, params) => Number((await q(sql, params)).rows[0].n);
  async function asService(fn) {
    await db.exec(`set role service_role; select set_config('request.jwt.claim.sub', '', false);`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role;`);
    }
  }
  const svc = async (fn, args = {}) => (await asService(() => named(fn, args))).rows[0].r;

  // A fresh report + case through the real submit_report (citizen A).
  let seq = 0;
  const freshCase = async (citizen = U.citizenA) => {
    const sub = `t92-${++seq}`;
    await as(citizen, async () => {
      for (const s of ["FRONT", "SIDE", "REAR"]) {
        await q(`insert into storage.objects (bucket_id, name, owner) values ('report-evidence', $1, auth.uid())`, [`${citizen}/${sub}/${s}.jpg`]);
      }
    });
    const ev = JSON.stringify(["FRONT", "SIDE", "REAR"].map((slot) => ({ slot, capture_source: "CAMERA", storage_path: `${citizen}/${sub}/${slot}.jpg`, captured_at: new Date().toISOString() })));
    const res = (await as(citizen, () => q(`select public.submit_report($1, 'no-parking', 'Street 1', now(), now(), $2::jsonb) as r`, [sub, ev]))).rows[0].r;
    return { reportId: res.report_id, caseId: res.case_id, number: Number(res.public_report_number) };
  };
  const toInspection = async (officer, caseId) => {
    await r(officer, "accept_case", { p_case_id: caseId });
    await r(officer, "start_inspection", { p_case_id: caseId });
  };
  const chargeReady = async (officer, caseId) => {
    await toInspection(officer, caseId);
    for (const k of ["vehiclePresent", "plateMatches", "violationConfirmed", "restrictionVerified"]) {
      await as(officer, () => q(`select public.set_inspection_check($1, $2::public.inspection_check_key, true)`, [caseId, k]));
    }
    for (const t of ["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"]) {
      const path = `${caseId}/${t}.jpg`;
      await as(officer, () => q(`insert into storage.objects (bucket_id, name, owner) values ('officer-evidence', $1, auth.uid())`, [path]));
      await as(officer, () => q(`select public.add_officer_evidence($1, $2::public.officer_evidence_type, $3, now())`, [caseId, t, path]));
    }
  };
  const complete = (officer, caseId, code) => as(officer, () => q(`select public.complete_case($1, $2::public.enforcement_outcome_code) as r`, [caseId, code]));
  const notifCount = (reportId, type, recipient) =>
    n(`select count(*) n from public.notifications where report_id = $1 and type::text = $2 and recipient_id = $3`, [reportId, type, recipient]);
  const outboxFor = (reportId, type) =>
    n(`select count(*) n from public.push_outbox o join public.notifications x on x.id = o.notification_id where x.report_id = $1 and x.type::text = $2`, [reportId, type]);

  const TOKEN = (s) => `ExponentPushToken[t92${s}aaaaaaaaaaaa]`;
  const INST = (s) => `inst-t92-${s}-0000`;

  // ===================================================================
  // A1/A2. Device registration
  await ok("T9.2: anonymous users cannot register or unregister push devices", async () => {
    for (const [fn, args] of [["register_push_device", { p_installation_id: INST("anon"), p_expo_push_token: TOKEN("anon"), p_platform: "ios" }], ["unregister_push_device", { p_installation_id: INST("anon") }]]) {
      const res = await anon(() => err(named(fn, args)));
      if (!/permission denied/.test(res)) throw new Error(`${fn}: ${res}`);
    }
  });
  await ok("T9.2: a citizen registers this device; the row belongs to the caller (server-derived)", async () => {
    const res = await r(U.citizenA, "register_push_device", { p_installation_id: INST("a1"), p_expo_push_token: TOKEN("a1"), p_platform: "android" });
    if (!res.registered || !res.changed) throw new Error(JSON.stringify(res));
    const row = (await q(`select user_id, enabled, platform from public.push_devices where installation_id = $1`, [INST("a1")])).rows[0];
    if (row.user_id !== U.citizenA || !row.enabled || row.platform !== "android") throw new Error(JSON.stringify(row));
  });
  await ok("T9.2: registering the same device again is idempotent (one row, changed=false)", async () => {
    const res = await r(U.citizenA, "register_push_device", { p_installation_id: INST("a1"), p_expo_push_token: TOKEN("a1"), p_platform: "android" });
    const c = await n(`select count(*) n from public.push_devices where user_id = $1 and installation_id = $2`, [U.citizenA, INST("a1")]);
    if (res.changed !== false || c !== 1) throw new Error(JSON.stringify({ res, c }));
  });
  await ok("T9.2: a refreshed token replaces the token of the same installation (no second row)", async () => {
    const res = await r(U.citizenA, "register_push_device", { p_installation_id: INST("a1"), p_expo_push_token: TOKEN("a1new"), p_platform: "android" });
    const rows = (await q(`select expo_push_token from public.push_devices where user_id = $1 and installation_id = $2`, [U.citizenA, INST("a1")])).rows;
    if (!res.changed || rows.length !== 1 || rows[0].expo_push_token !== TOKEN("a1new")) throw new Error(JSON.stringify({ res, rows }));
  });
  await ok("T9.2: one account can have several devices", async () => {
    await r(U.citizenA, "register_push_device", { p_installation_id: INST("a2"), p_expo_push_token: TOKEN("a2"), p_platform: "ios" });
    const c = await n(`select count(*) n from public.push_devices where user_id = $1 and enabled`, [U.citizenA]);
    if (c !== 2) throw new Error(`enabled devices ${c}`);
  });
  for (const [what, args] of [
    ["a malformed token", { p_installation_id: INST("bad"), p_expo_push_token: "not-a-token", p_platform: "ios" }],
    ["a malformed installation id", { p_installation_id: "x", p_expo_push_token: TOKEN("bad"), p_platform: "ios" }],
    ["an unknown platform", { p_installation_id: INST("bad"), p_expo_push_token: TOKEN("bad"), p_platform: "web" }],
  ]) {
    await fails(`T9.2: registration refuses ${what}`, () => as(U.citizenA, () => named("register_push_device", args)), /INVALID_INPUT/);
  }
  await fails("T9.2: a console (supervisor) account cannot register push devices", () =>
    as(supA, () => named("register_push_device", { p_installation_id: INST("sup"), p_expo_push_token: TOKEN("sup"), p_platform: "ios" })), /FORBIDDEN/);
  for (const [who, id] of [["a citizen", U.citizenB], ["an officer", U.officer], ["a supervisor", supA]]) {
    await denied(`T9.2: ${who} cannot read push device tokens`, () => as(id, () => q(`select expo_push_token from public.push_devices`)));
    await denied(`T9.2: ${who} cannot read the push outbox`, () => as(id, () => q(`select id from public.push_outbox`)));
    await denied(`T9.2: ${who} cannot read push tickets`, () => as(id, () => q(`select id from public.push_tickets`)));
  }
  await fails("T9.2: a client cannot insert a device row for another user", () =>
    as(U.citizenB, () => q(`insert into public.push_devices (user_id, installation_id, expo_push_token, platform) values ($1, $2, $3, 'ios')`, [U.citizenA, INST("x"), TOKEN("x")])), /permission denied/);
  await fails("T9.2: a client cannot disable another user's device directly", () =>
    as(U.citizenB, () => q(`update public.push_devices set enabled = false, disabled_reason = 'SIGNED_OUT' where user_id = $1`, [U.citizenA])), /permission denied/);
  await ok("T9.2: unregister only touches the caller's own registration", async () => {
    const res = await r(U.citizenB, "unregister_push_device", { p_installation_id: INST("a2") });
    const enabled = (await q(`select enabled from public.push_devices where installation_id = $1`, [INST("a2")])).rows[0].enabled;
    if (res.unregistered !== false || enabled !== true) throw new Error(JSON.stringify({ res, enabled }));
  });
  await ok("T9.2: sign-out deactivates this device; signing in again re-enables it", async () => {
    const res = await r(U.citizenA, "unregister_push_device", { p_installation_id: INST("a2") });
    const row = (await q(`select enabled, disabled_reason from public.push_devices where installation_id = $1`, [INST("a2")])).rows[0];
    if (!res.unregistered || row.enabled || row.disabled_reason !== "SIGNED_OUT") throw new Error(JSON.stringify({ res, row }));
    const again = await r(U.citizenA, "unregister_push_device", { p_installation_id: INST("a2") });
    if (again.unregistered !== false) throw new Error("second sign-out changed something");
    await r(U.citizenA, "register_push_device", { p_installation_id: INST("a2"), p_expo_push_token: TOKEN("a2"), p_platform: "ios" });
    const back = (await q(`select enabled from public.push_devices where installation_id = $1`, [INST("a2")])).rows[0];
    if (!back.enabled) throw new Error("not re-enabled");
  });
  await ok("T9.2: a device signed in by another account moves to it; the previous account no longer receives there", async () => {
    await r(U.citizenB, "register_push_device", { p_installation_id: INST("a2"), p_expo_push_token: TOKEN("a2"), p_platform: "ios" });
    const rows = (await q(`select user_id, enabled, disabled_reason from public.push_devices where installation_id = $1 order by user_id`, [INST("a2")])).rows;
    const a = rows.find((x) => x.user_id === U.citizenA);
    const b = rows.find((x) => x.user_id === U.citizenB);
    if (!a || a.enabled || a.disabled_reason !== "MOVED_TO_OTHER_ACCOUNT" || !b || !b.enabled) throw new Error(JSON.stringify(rows));
    // Back to citizen A for the delivery scenarios below.
    await r(U.citizenB, "unregister_push_device", { p_installation_id: INST("a2") });
    await r(U.citizenA, "register_push_device", { p_installation_id: INST("a2"), p_expo_push_token: TOKEN("a2"), p_platform: "ios" });
  });
  await ok("T9.2: officers register devices the same way", async () => {
    await r(U.officer, "register_push_device", { p_installation_id: INST("o1"), p_expo_push_token: TOKEN("o1"), p_platform: "android" });
    await r(OFF2, "register_push_device", { p_installation_id: INST("o2"), p_expo_push_token: TOKEN("o2"), p_platform: "ios" });
  });

  // ===================================================================
  // Sender API is service-role only
  for (const [who, id] of [["a citizen", U.citizenA], ["an officer", U.officer], ["a supervisor", supA]]) {
    await ok(`T9.2: ${who} cannot use the push sender API (claim, record, receipts)`, async () => {
      for (const [fn, args] of [["push_claim_batch", {}], ["push_record_result", { p_outbox_id: "00000000-0000-4000-8000-000000000001" }], ["push_pending_receipts", {}], ["push_record_receipts", { p_receipts: "[]" }]]) {
        const res = await as(id, () => err(named(fn, args)));
        if (!/permission denied/.test(res)) throw new Error(`${fn}: ${res}`);
      }
    });
  }
  await ok("T9.2: anonymous users cannot use the push sender API", async () => {
    const res = await anon(() => err(named("push_claim_batch")));
    if (!/permission denied/.test(res)) throw new Error(res);
  });

  // Drain anything queued by earlier modules so the delivery scenarios below are exact.
  await q(`update public.push_outbox set status = 'FAILED', last_error = 'TEST_RESET' where status in ('PENDING', 'SENDING')`);

  // ===================================================================
  // A4. Citizen notification rules (real complete_case)
  await ok("T9.2: submitting a report queues no push (REPORT_UNDER_REVIEW stays in-app)", async () => {
    const c = await freshCase();
    if ((await notifCount(c.reportId, "REPORT_UNDER_REVIEW", U.citizenA)) !== 1) throw new Error("no in-app under-review notification");
    if ((await outboxFor(c.reportId, "REPORT_UNDER_REVIEW")) !== 0) throw new Error("under review was pushed");
  });

  const charged = await freshCase();
  await ok("T9.2: CHARGE_ISSUED -> exactly one 'verified' notification with the €5 reward, and exactly one push", async () => {
    await chargeReady(U.officer, charged.caseId);
    const res = (await complete(U.officer, charged.caseId, "CHARGE_ISSUED")).rows[0].r;
    if (res.credited_cents !== 500) throw new Error(JSON.stringify(res));
    const amount = (await q(`select amount_cents from public.notifications where report_id = $1 and type = 'REPORT_VERIFIED'`, [charged.reportId])).rows[0].amount_cents;
    if ((await notifCount(charged.reportId, "REPORT_VERIFIED", U.citizenA)) !== 1 || amount !== 500) throw new Error(`amount ${amount}`);
    if ((await outboxFor(charged.reportId, "REPORT_VERIFIED")) !== 1) throw new Error("push not queued once");
    if ((await notifCount(charged.reportId, "REPORT_REJECTED", U.citizenA)) !== 0) throw new Error("rejected also sent");
  });
  await ok("T9.2: retrying CHARGE_ISSUED adds no notification, push or reward credit", async () => {
    const res = (await complete(U.officer, charged.caseId, "CHARGE_ISSUED")).rows[0].r;
    if (res.changed !== false) throw new Error(JSON.stringify(res));
    const released = await n(`select count(*) n from public.reward_ledger where report_id = $1 and entry_type = 'REWARD_RELEASED'`, [charged.reportId]);
    if ((await notifCount(charged.reportId, "REPORT_VERIFIED", U.citizenA)) !== 1 || (await outboxFor(charged.reportId, "REPORT_VERIFIED")) !== 1 || released !== 1) {
      throw new Error("duplicated");
    }
  });
  await ok("T9.2: the officer's own completion notification is never pushed", async () => {
    if ((await outboxFor(charged.reportId, "PARKING_CHARGE_ISSUED")) !== 0) throw new Error("officer completion pushed");
  });

  const rejected = await freshCase();
  await ok("T9.2: REPORT_REJECTED -> exactly one 'rejected' notification and one push; no reward", async () => {
    await r(U.officer, "accept_case", { p_case_id: rejected.caseId });
    await complete(U.officer, rejected.caseId, "REPORT_REJECTED");
    await complete(U.officer, rejected.caseId, "REPORT_REJECTED"); // retry
    if ((await notifCount(rejected.reportId, "REPORT_REJECTED", U.citizenA)) !== 1) throw new Error("not exactly one");
    if ((await outboxFor(rejected.reportId, "REPORT_REJECTED")) !== 1) throw new Error("push not exactly once");
    const status = (await q(`select status from public.reports where id = $1`, [rejected.reportId])).rows[0].status;
    const voided = await n(`select count(*) n from public.reward_ledger where report_id = $1 and entry_type = 'REWARD_VOIDED'`, [rejected.reportId]);
    if (status !== "REJECTED" || voided !== 1) throw new Error(`${status} voided=${voided}`);
  });

  for (const code of ["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"]) {
    await ok(`T9.2: ${code} -> case completed, citizen status untouched, NO citizen outcome notification or push`, async () => {
      const c = await freshCase();
      if (code === "VALID_PERMIT") await toInspection(U.officer, c.caseId);
      else if (code !== "DUPLICATE") await r(U.officer, "accept_case", { p_case_id: c.caseId });
      await complete(U.officer, c.caseId, code);
      await complete(U.officer, c.caseId, code); // retry
      const report = (await q(`select status from public.reports where id = $1`, [c.reportId])).rows[0];
      const caseStatus = (await q(`select status from public.officer_cases where id = $1`, [c.caseId])).rows[0].status;
      const citizenOutcome = await n(`select count(*) n from public.notifications where report_id = $1 and recipient_id = $2 and type in ('REPORT_VERIFIED', 'REPORT_REJECTED')`, [c.reportId, U.citizenA]);
      const citizenPush = await n(`select count(*) n from public.push_outbox o where o.recipient_id = $1 and o.notification_id in (select id from public.notifications where report_id = $2)`, [U.citizenA, c.reportId]);
      const voided = await n(`select count(*) n from public.reward_ledger where report_id = $1 and entry_type = 'REWARD_VOIDED'`, [c.reportId]);
      if (report.status !== "UNDER_REVIEW" || caseStatus !== "COMPLETED" || citizenOutcome !== 0 || citizenPush !== 0 || voided !== 1) {
        throw new Error(JSON.stringify({ report, caseStatus, citizenOutcome, citizenPush, voided }));
      }
    });
  }

  // ===================================================================
  // Trusted sender: claim -> record (fake transport results)
  const claim = async () => svc("push_claim_batch", { p_limit: 100 });
  await ok("T9.2: the sender claims due pushes with the recipient's enabled device tokens and nothing sensitive", async () => {
    const batch = await claim();
    const verified = batch.find((b) => b.notification.type === "REPORT_VERIFIED" && Number(b.notification.report_number) === charged.number);
    if (!verified) throw new Error(`not claimed: ${JSON.stringify(batch.map((b) => b.notification.type))}`);
    const tokens = verified.devices.map((d) => d.token).sort();
    if (JSON.stringify(tokens) !== JSON.stringify([TOKEN("a1new"), TOKEN("a2")].sort())) throw new Error(JSON.stringify(tokens));
    const json = JSON.stringify(batch);
    for (const bad of ["storage_path", "latitude", "longitude", "location", "plate", "citizen_id", "display_name", "notes", "email"]) {
      if (json.includes(bad)) throw new Error(`claimed payload contains ${bad}`);
    }
    if (batch.some((b) => b.notification.recipient_role === "CITIZEN" && b.notification.case_id && b.notification.type !== "REPORT_VERIFIED" && b.notification.type !== "REPORT_REJECTED")) {
      throw new Error("unexpected citizen push type");
    }
    // A second claim while leased returns none of these rows (no double send).
    const again = await claim();
    if (again.some((b) => b.outbox_id === verified.outbox_id)) throw new Error("claimed twice while leased");
    // Delivered to both devices -> SENT.
    const st = await svc("push_record_result", {
      p_outbox_id: verified.outbox_id,
      p_tickets: JSON.stringify(verified.devices.map((d, i) => ({ device_id: d.device_id, status: "ok", ticket_id: `tkt-verified-${i}` }))),
    });
    if (st.status !== "SENT") throw new Error(JSON.stringify(st));
    // Every other claimed row: record a transient request failure for the retry scenarios.
    for (const b of batch.filter((x) => x.outbox_id !== verified.outbox_id)) {
      await svc("push_record_result", { p_outbox_id: b.outbox_id, p_request_error: "NETWORK" });
    }
  });
  await ok("T9.2: a recorded result is applied once (a late duplicate result is ignored)", async () => {
    const id = (await q(`select o.id from public.push_outbox o join public.notifications x on x.id = o.notification_id where x.report_id = $1 and x.type = 'REPORT_VERIFIED'`, [charged.reportId])).rows[0].id;
    const st = await svc("push_record_result", { p_outbox_id: id, p_tickets: "[]", p_request_error: "NETWORK" });
    const row = (await q(`select status from public.push_outbox where id = $1`, [id])).rows[0];
    if (!st.ignored || row.status !== "SENT") throw new Error(JSON.stringify({ st, row }));
  });
  await ok("T9.2: a temporary failure is retried later with backoff (not immediately)", async () => {
    const row = (await q(`select o.status, o.attempts, o.next_attempt_at > now() later, o.last_error from public.push_outbox o join public.notifications x on x.id = o.notification_id
      where x.report_id = $1 and x.type = 'REPORT_REJECTED'`, [rejected.reportId])).rows[0];
    if (row.status !== "PENDING" || row.attempts !== 1 || !row.later || row.last_error !== "NETWORK") throw new Error(JSON.stringify(row));
    const batch = await claim();
    if (batch.some((b) => Number(b.notification.report_number) === rejected.number)) throw new Error("retried before backoff");
  });
  await ok("T9.2: retries stop after 5 attempts (FAILED, never forever)", async () => {
    const id = (await q(`select o.id from public.push_outbox o join public.notifications x on x.id = o.notification_id where x.report_id = $1 and x.type = 'REPORT_REJECTED'`, [rejected.reportId])).rows[0].id;
    let last;
    for (let i = 0; i < 6; i++) {
      await q(`update public.push_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [id]);
      const b = (await claim()).find((x) => x.outbox_id === id);
      if (!b) break;
      last = await svc("push_record_result", { p_outbox_id: id, p_request_error: "HTTP_503" });
    }
    const row = (await q(`select status, attempts, last_error from public.push_outbox where id = $1`, [id])).rows[0];
    if (row.status !== "FAILED" || row.attempts !== 5 || row.last_error !== "HTTP_503" || last?.status !== "FAILED") throw new Error(JSON.stringify({ row, last }));
  });
  await ok("T9.2: DeviceNotRegistered disables that device; MessageRateExceeded is retried for that device only", async () => {
    const c = await freshCase();
    await r(U.officer, "accept_case", { p_case_id: c.caseId });
    await complete(U.officer, c.caseId, "REPORT_REJECTED");
    const b = (await claim()).find((x) => Number(x.notification.report_number) === c.number);
    const [d1, d2] = b.devices;
    const st = await svc("push_record_result", {
      p_outbox_id: b.outbox_id,
      p_tickets: JSON.stringify([{ device_id: d1.device_id, status: "error", error: "MessageRateExceeded" }, { device_id: d2.device_id, status: "error", error: "DeviceNotRegistered" }]),
    });
    const dev2 = (await q(`select enabled, disabled_reason from public.push_devices where id = $1`, [d2.device_id])).rows[0];
    if (st.status !== "PENDING" || dev2.enabled || dev2.disabled_reason !== "DEVICE_NOT_REGISTERED") throw new Error(JSON.stringify({ st, dev2 }));
    await q(`update public.push_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [b.outbox_id]);
    const again = (await claim()).find((x) => x.outbox_id === b.outbox_id);
    if (!again || again.devices.length !== 1 || again.devices[0].device_id !== d1.device_id) throw new Error(JSON.stringify(again));
    const done = await svc("push_record_result", { p_outbox_id: b.outbox_id, p_tickets: JSON.stringify([{ device_id: d1.device_id, status: "ok", ticket_id: "tkt-rate-retry" }]) });
    if (done.status !== "SENT") throw new Error(JSON.stringify(done));
    // Re-register device 2 (a fresh token from the app) for the next scenarios.
    await r(U.citizenA, "register_push_device", { p_installation_id: INST("a2"), p_expo_push_token: TOKEN("a2b"), p_platform: "ios" });
  });
  await ok("T9.2: a result naming another user's device is ignored", async () => {
    const c = await freshCase();
    await r(U.officer, "accept_case", { p_case_id: c.caseId });
    await complete(U.officer, c.caseId, "REPORT_REJECTED");
    const b = (await claim()).find((x) => Number(x.notification.report_number) === c.number);
    const foreign = (await q(`select id from public.push_devices where user_id = $1 limit 1`, [U.officer])).rows[0].id;
    await svc("push_record_result", { p_outbox_id: b.outbox_id, p_tickets: JSON.stringify([{ device_id: foreign, status: "error", error: "DeviceNotRegistered" }]), p_request_error: "NETWORK" });
    const dev = (await q(`select enabled from public.push_devices where id = $1`, [foreign])).rows[0];
    const t = await n(`select count(*) n from public.push_tickets where outbox_id = $1`, [b.outbox_id]);
    if (!dev.enabled || t !== 0) throw new Error(JSON.stringify({ dev, t }));
  });
  await ok("T9.2: a recipient without devices -> NO_DEVICE (nothing sent, nothing retried)", async () => {
    const c = await freshCase(U.citizenB);
    await r(U.officer, "accept_case", { p_case_id: c.caseId });
    await complete(U.officer, c.caseId, "REPORT_REJECTED");
    const b = (await claim()).find((x) => Number(x.notification.report_number) === c.number);
    if (!b || b.devices.length !== 0) throw new Error(JSON.stringify(b));
    const st = await svc("push_record_result", { p_outbox_id: b.outbox_id, p_tickets: "[]" });
    if (st.status !== "NO_DEVICE") throw new Error(JSON.stringify(st));
  });
  await ok("T9.2: a push older than its expiry is never sent (FAILED EXPIRED)", async () => {
    const c = await freshCase();
    await r(U.officer, "accept_case", { p_case_id: c.caseId });
    await complete(U.officer, c.caseId, "REPORT_REJECTED");
    await q(`update public.push_outbox set expires_at = now() - interval '1 minute' where notification_id in (select id from public.notifications where report_id = $1)`, [c.reportId]);
    const batch = await claim();
    const row = (await q(`select status, last_error from public.push_outbox where notification_id in (select id from public.notifications where report_id = $1)`, [c.reportId])).rows[0];
    if (batch.some((x) => Number(x.notification.report_number) === c.number) || row.status !== "FAILED" || row.last_error !== "EXPIRED") throw new Error(JSON.stringify(row));
  });
  await ok("T9.2: receipts: due tickets are listed; a DeviceNotRegistered receipt disables the device", async () => {
    await q(`update public.push_tickets set created_at = now() - interval '20 minutes' where ticket_id = 'tkt-verified-0'`);
    const due = await svc("push_pending_receipts");
    if (!due.includes("tkt-verified-0") || due.includes("tkt-verified-1")) throw new Error(JSON.stringify(due));
    const dev = (await q(`select device_id from public.push_tickets where ticket_id = 'tkt-verified-0'`)).rows[0].device_id;
    const res = await svc("push_record_receipts", { p_receipts: JSON.stringify([{ ticket_id: "tkt-verified-0", status: "error", error: "DeviceNotRegistered" }, { ticket_id: "tkt-verified-0", status: "ok" }]) });
    const d = (await q(`select enabled, disabled_reason from public.push_devices where id = $1`, [dev])).rows[0];
    const again = await svc("push_pending_receipts");
    if (res.recorded !== 1 || d.enabled || d.disabled_reason !== "DEVICE_NOT_REGISTERED" || again.includes("tkt-verified-0")) throw new Error(JSON.stringify({ res, d }));
  });

  // ===================================================================
  // B1-B3. Supervisor assignment
  const assign = (user, caseId, officer, version) => as(user, () => named("admin_assign_case", { p_case_id: caseId, p_officer_id: officer, p_expected_version: version }));
  const unassign = (user, caseId, version) => as(user, () => named("admin_unassign_case", { p_case_id: caseId, p_expected_version: version }));
  const caseRow = async (id) => (await q(`select status, assigned_officer_id, assignment_version, assigned_at from public.officer_cases where id = $1`, [id])).rows[0];
  const auditCount = (caseId, event) => n(`select count(*) n from public.audit_events where entity_type = 'officer_case' and entity_id = $1 and event_type = $2`, [caseId, event]);
  const caseNotif = (caseId, type, recipient) => n(`select count(*) n from public.notifications where case_id = $1 and type::text = $2 and recipient_id = $3`, [caseId, type, recipient]);
  const casePush = (caseId, recipient) =>
    n(`select count(*) n from public.push_outbox o join public.notifications x on x.id = o.notification_id where x.case_id = $1 and o.recipient_id = $2`, [caseId, recipient]);

  const k = await freshCase();
  await ok("T9.2: the assignable officer list = active OFFICERs of the case's organization only", async () => {
    const list = await r(supA, "admin_list_assignable_officers", { p_case_id: k.caseId });
    const ids = list.map((o) => o.user_id);
    if (!ids.includes(U.officer) || !ids.includes(OFF2)) throw new Error(`missing active officers: ${ids}`);
    if (ids.includes(OFFX) || ids.includes(OFFB) || ids.includes(supA) || ids.includes(adminA)) throw new Error(`ineligible listed: ${ids}`);
    if (list.some((o) => "email" in o || "latitude" in o || "expo_push_token" in o)) throw new Error("extra personal data");
    if ((await r(supB, "admin_list_assignable_officers", { p_case_id: k.caseId })) !== null) throw new Error("org B sees org A case");
  });
  for (const [who, id, pattern] of [["a citizen", U.citizenA, /FORBIDDEN/], ["an officer", U.officer, /FORBIDDEN/], ["an inactive supervisor", supInactive, /FORBIDDEN/], ["another organization's supervisor", supB, /NOT_FOUND/]]) {
    await fails(`T9.2: ${who} cannot assign a case`, () => assign(id, k.caseId, OFF2, 0), pattern);
    await fails(`T9.2: ${who} cannot return a case to the queue`, () => unassign(id, k.caseId, 0), pattern);
  }
  await ok("T9.2: anonymous users cannot use the assignment functions", async () => {
    const res = await anon(() => err(named("admin_assign_case", { p_case_id: k.caseId, p_officer_id: OFF2, p_expected_version: 0 })));
    if (!/permission denied/.test(res)) throw new Error(res);
  });
  for (const [who, id] of [["an officer of another organization", OFFB], ["an inactive officer", OFFX], ["a supervisor (not an officer)", supA], ["a citizen", U.citizenB]]) {
    await fails(`T9.2: a case cannot be assigned to ${who}`, () => assign(supA, k.caseId, id, 0), /INVALID_OFFICER/);
  }
  await fails("T9.2: supervisors cannot change cases directly (server functions only)", () =>
    as(supA, () => q(`update public.officer_cases set assigned_officer_id = $2 where id = $1`, [k.caseId, OFF2])), /permission denied/);
  await ok("T9.2: nothing changed after the refused attempts", async () => {
    const row = await caseRow(k.caseId);
    if (row.status !== "NEW" || row.assigned_officer_id !== null || row.assignment_version !== 0) throw new Error(JSON.stringify(row));
  });

  await ok("T9.2: a supervisor assigns a NEW case to an active same-org officer (one notification, one push, one audit)", async () => {
    const res = await r(supA, "admin_assign_case", { p_case_id: k.caseId, p_officer_id: OFF2, p_expected_version: 0 });
    const row = await caseRow(k.caseId);
    if (!res.changed || res.assignment_version !== 1 || row.status !== "ASSIGNED" || row.assigned_officer_id !== OFF2 || !row.assigned_at) throw new Error(JSON.stringify({ res, row }));
    if ((await caseNotif(k.caseId, "CASE_ASSIGNED", OFF2)) !== 1 || (await casePush(k.caseId, OFF2)) !== 1 || (await auditCount(k.caseId, "CASE_ASSIGNED")) !== 1) throw new Error("counts");
    const a = (await q(`select actor_user_id, actor_role, metadata from public.audit_events where entity_id = $1 and event_type = 'CASE_ASSIGNED'`, [k.caseId])).rows[0];
    if (a.actor_user_id !== supA || a.actor_role !== "SUPERVISOR" || a.metadata.to_officer !== OFF2 || "from_officer" in a.metadata || a.metadata.from !== "NEW") throw new Error(JSON.stringify(a));
  });
  await ok("T9.2: retrying the same assignment is a no-op (no second notification, push or audit)", async () => {
    const res = await r(supA, "admin_assign_case", { p_case_id: k.caseId, p_officer_id: OFF2, p_expected_version: 0 });
    if (res.changed !== false || (await caseNotif(k.caseId, "CASE_ASSIGNED", OFF2)) !== 1 || (await casePush(k.caseId, OFF2)) !== 1 || (await auditCount(k.caseId, "CASE_ASSIGNED")) !== 1) {
      throw new Error(JSON.stringify(res));
    }
  });
  await ok("T9.2: no citizen notification is created by assignment", async () => {
    const c = await n(`select count(*) n from public.notifications where report_id = $1 and recipient_id = $2 and type <> 'REPORT_UNDER_REVIEW'`, [k.reportId, U.citizenA]);
    if (c !== 0) throw new Error(`${c}`);
  });
  await ok("T9.2: the assigned officer sees the case as theirs; another officer cannot accept it", async () => {
    const s = await r(OFF2, "get_officer_summary");
    if (Number(s.assigned_to_me) < 1) throw new Error(JSON.stringify(s));
    const res = await as(U.officer, () => err(named("accept_case", { p_case_id: k.caseId })));
    if (!/CASE_TAKEN/.test(res)) throw new Error(res);
  });
  await fails("T9.2: a stale screen (old version) cannot overwrite the assignment", () => assign(supA, k.caseId, U.officer, 0), /STALE_ASSIGNMENT/);

  await ok("T9.2: reassignment: new officer notified + pushed, previous officer gets an in-app update only, audit has both", async () => {
    const res = await r(adminA, "admin_assign_case", { p_case_id: k.caseId, p_officer_id: U.officer, p_expected_version: 1 });
    const row = await caseRow(k.caseId);
    if (!res.changed || row.assigned_officer_id !== U.officer || row.assignment_version !== 2 || row.status !== "ASSIGNED") throw new Error(JSON.stringify({ res, row }));
    if ((await caseNotif(k.caseId, "CASE_ASSIGNED", U.officer)) !== 1 || (await casePush(k.caseId, U.officer)) !== 1) throw new Error("new officer not notified once");
    if ((await caseNotif(k.caseId, "CASE_ASSIGNMENT_REMOVED", OFF2)) !== 1 || (await casePush(k.caseId, OFF2)) !== 1) throw new Error("previous officer: in-app once, no new push");
    const a = (await q(`select actor_role, metadata from public.audit_events where entity_id = $1 and event_type = 'CASE_REASSIGNED'`, [k.caseId])).rows;
    if (a.length !== 1 || a[0].actor_role !== "ADMIN" || a[0].metadata.from_officer !== OFF2 || a[0].metadata.to_officer !== U.officer) throw new Error(JSON.stringify(a));
  });
  await ok("T9.2: console history shows officer NAMES for assignment events, never ids", async () => {
    const d = await r(supA, "admin_get_case", { p_case_id: k.caseId });
    const ev = d.audit.find((e) => e.event_type === "CASE_REASSIGNED");
    if (!ev || ev.metadata.from_officer !== "Olga Officer" || ev.metadata.to_officer !== "Olli Officer") throw new Error(JSON.stringify(ev));
    for (const e of d.audit) if (UUID_RE.test(JSON.stringify(e.metadata))) throw new Error(`id in metadata: ${JSON.stringify(e.metadata)}`);
    if (d.case.assignment_version !== 2 || d.case.assigned_officer_id !== U.officer) throw new Error(JSON.stringify(d.case));
    const log = await r(supA, "admin_page_audit", { p_ref: String(k.number), p_limit: 100 });
    if (log.rows.some((e) => UUID_RE.test(JSON.stringify(e.metadata)))) throw new Error("id in audit log metadata");
  });
  await ok("T9.2: return to queue: ASSIGNED -> NEW, previous officer informed in-app, audited once; retry is a no-op", async () => {
    const res = await r(supA, "admin_unassign_case", { p_case_id: k.caseId, p_expected_version: 2 });
    const row = await caseRow(k.caseId);
    if (!res.changed || row.status !== "NEW" || row.assigned_officer_id !== null || row.assigned_at !== null || row.assignment_version !== 3) throw new Error(JSON.stringify({ res, row }));
    const again = await r(supA, "admin_unassign_case", { p_case_id: k.caseId, p_expected_version: 2 });
    if (again.changed !== false || (await auditCount(k.caseId, "CASE_UNASSIGNED")) !== 1 || (await caseNotif(k.caseId, "CASE_ASSIGNMENT_REMOVED", U.officer)) !== 1) throw new Error(JSON.stringify(again));
    if ((await casePush(k.caseId, U.officer)) !== 1) throw new Error("unassignment was pushed");
  });
  await ok("T9.2: a started case (EN_ROUTE) cannot be reassigned or returned to the queue", async () => {
    await r(supA, "admin_assign_case", { p_case_id: k.caseId, p_officer_id: OFF2, p_expected_version: 3 });
    await r(OFF2, "accept_case", { p_case_id: k.caseId }); // ASSIGNED -> EN_ROUTE
    const row = await caseRow(k.caseId);
    if (row.status !== "EN_ROUTE") throw new Error(JSON.stringify(row));
    const a = await as(supA, () => err(named("admin_assign_case", { p_case_id: k.caseId, p_officer_id: U.officer, p_expected_version: 4 })));
    const u = await as(supA, () => err(named("admin_unassign_case", { p_case_id: k.caseId, p_expected_version: 4 })));
    if (!/NOT_ASSIGNABLE/.test(a) || !/NOT_ASSIGNABLE/.test(u)) throw new Error(`${a} | ${u}`);
  });
  await ok("T9.2: a completed case cannot be assigned", async () => {
    await complete(OFF2, k.caseId, "VEHICLE_MOVED");
    const a = await as(supA, () => err(named("admin_assign_case", { p_case_id: k.caseId, p_officer_id: U.officer, p_expected_version: 4 })));
    if (!/ALREADY_COMPLETED/.test(a)) throw new Error(a);
  });
  await ok("T9.2: a supervisor and an officer racing: the officer accepted first -> the stale assignment is refused", async () => {
    const c = await freshCase();
    await r(OFF2, "accept_case", { p_case_id: c.caseId });
    const a = await as(supA, () => err(named("admin_assign_case", { p_case_id: c.caseId, p_officer_id: U.officer, p_expected_version: 0 })));
    if (!/NOT_ASSIGNABLE/.test(a)) throw new Error(a);
  });
  await ok("T9.2: a push problem never fails an assignment (enqueue errors are swallowed)", async () => {
    const c = await freshCase();
    await q(`alter table public.push_outbox add constraint t92_probe_block check (recipient_id is null) not valid`);
    try {
      const res = await r(supA, "admin_assign_case", { p_case_id: c.caseId, p_officer_id: OFF2, p_expected_version: 0 });
      if (!res.changed || (await caseNotif(c.caseId, "CASE_ASSIGNED", OFF2)) !== 1 || (await casePush(c.caseId, OFF2)) !== 0) throw new Error(JSON.stringify(res));
    } finally {
      await q(`alter table public.push_outbox drop constraint t92_probe_block`);
    }
  });

  // ===================================================================
  // B4. Needs attention (lifecycle timestamps only)
  await ok("T9.2: a NEW case waiting longer than its threshold needs attention; a fresh one does not", async () => {
    const old = await freshCase();
    const fresh = await freshCase();
    await q(`update public.officer_cases set created_at = now() - interval '2 hours' where id = $1`, [old.caseId]);
    const page = await r(supA, "admin_page_cases", { p_status: "NEW", p_limit: 100 });
    const o = page.rows.find((x) => x.id === old.caseId);
    const f = page.rows.find((x) => x.id === fresh.caseId);
    if (!o?.needs_attention || f?.needs_attention !== false || !o.status_since) throw new Error(JSON.stringify({ o, f }));
    const flagged = await r(supA, "admin_page_cases", { p_attention: true, p_limit: 100 });
    if (!flagged.rows.some((x) => x.id === old.caseId) || flagged.rows.some((x) => !x.needs_attention)) throw new Error("attention filter");
    const ov = await r(supA, "admin_overview");
    if (Number(ov.cases_needing_attention) !== Number(flagged.total)) throw new Error(`overview ${ov.cases_needing_attention} != ${flagged.total}`);
  });
  await ok("T9.2: an EN_ROUTE case is measured from en_route_at (not creation); thresholds are server settings", async () => {
    const c = await freshCase();
    await r(OFF2, "accept_case", { p_case_id: c.caseId });
    await q(`update public.officer_cases set created_at = now() - interval '5 hours', en_route_at = now() - interval '10 minutes' where id = $1`, [c.caseId]);
    let d = await r(supA, "admin_get_case", { p_case_id: c.caseId });
    if (d.case.needs_attention !== false || d.case.attention_minutes !== 45) throw new Error(JSON.stringify(d.case));
    await q(`update public.app_settings set attention_en_route_minutes = 5`);
    d = await r(supA, "admin_get_case", { p_case_id: c.caseId });
    await q(`update public.app_settings set attention_en_route_minutes = 45`);
    if (d.case.needs_attention !== true) throw new Error(JSON.stringify(d.case));
  });
  await ok("T9.2: a completed case is never flagged, however old", async () => {
    const page = await r(supA, "admin_page_cases", { p_status: "COMPLETED", p_limit: 100 });
    await q(`update public.officer_cases set created_at = now() - interval '30 days' where status = 'COMPLETED'`);
    const again = await r(supA, "admin_page_cases", { p_status: "COMPLETED", p_limit: 100 });
    if (!page.rows.length || again.rows.some((x) => x.needs_attention || x.status_since)) throw new Error("completed flagged");
  });
  await ok("T9.2: attention counts are organization-scoped", async () => {
    const b = await r(supB, "admin_page_cases", { p_attention: true, p_limit: 100 });
    if (b.rows.some((x) => x.id === k.caseId)) throw new Error("org A case in org B attention list");
  });
}
