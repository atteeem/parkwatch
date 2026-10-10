// T9.0 scenarios for scripts/verify-migrations.mjs: the read-only operations
// console (admin_* functions) against the REAL migrations under real roles.
// Organization A = the main verifier organization (jurisdiction helsinki-demo,
// filled by the T8.3/T8.7 scenarios). Organization B = "Other City" (T8.3).

export async function runT90(ctx) {
  const { db, q, as, anon, ok, fails, denied, U, org } = ctx;
  const OFFB = "00000000-0000-4000-8000-0000000000cb"; // officer of org B (T8.3)
  const S = {
    supA: "00000000-0000-4000-8000-00000000a0a1",
    supB: "00000000-0000-4000-8000-00000000b0b1",
    supInactive: "00000000-0000-4000-8000-00000000a0a2",
    adminA: "00000000-0000-4000-8000-00000000a0a3",
    adminNoMember: "00000000-0000-4000-8000-00000000a0a4",
    citizenWithStaffRow: "00000000-0000-4000-8000-00000000a0a5",
  };
  const orgB = (await q(`select organization_id id from public.jurisdictions where id = 'other-city'`)).rows[0].id;
  await db.exec(`
    insert into auth.users (id) values ('${S.supA}'), ('${S.supB}'), ('${S.supInactive}'), ('${S.adminA}'), ('${S.adminNoMember}'), ('${S.citizenWithStaffRow}');
    update public.profiles set role = 'SUPERVISOR', display_name = 'Sanna Supervisor' where id in ('${S.supA}', '${S.supB}', '${S.supInactive}');
    update public.profiles set role = 'ADMIN', display_name = 'Aino Admin' where id in ('${S.adminA}', '${S.adminNoMember}');
    update public.profiles set display_name = 'Olli Officer' where id = '${U.officer}';
    insert into public.organization_members (organization_id, user_id, member_role, active) values
      ('${org}', '${S.supA}', 'SUPERVISOR', true),
      ('${orgB}', '${S.supB}', 'SUPERVISOR', true),
      ('${org}', '${S.supInactive}', 'SUPERVISOR', false),
      ('${org}', '${S.adminA}', 'ADMIN', true),
      ('${org}', '${S.citizenWithStaffRow}', 'ADMIN', true);
  `);

  // Organization B data (service side): a report with case, evidence, ledger and history.
  const repB = (await q(`insert into public.reports (citizen_id, source_draft_id, jurisdiction_id, violation_type, plate_raw, plate_normalized,
      location_address, observed_at, submitted_at, notes)
    values ('${U.citizenB}', 't90-orgb', 'other-city', 'no-parking', 'ZZZ-999', 'ZZZ999', 'Other street 1', now(), now(), 'org B secret note')
    returning id, public_report_number`)).rows[0];
  const caseB = (await q(`insert into public.officer_cases (report_id, jurisdiction_id) values ($1, 'other-city') returning id`, [repB.id])).rows[0].id;
  const pathB = `${U.citizenB}/t90-orgb/FRONT.jpg`;
  await q(`insert into storage.objects (bucket_id, name, owner) values ('report-evidence', $1, $2)`, [pathB, U.citizenB]);
  await q(`insert into public.report_evidence (report_id, slot, capture_source, storage_path, captured_at) values ($1, 'FRONT', 'CAMERA', $2, now())`, [repB.id, pathB]);
  await q(`insert into public.reward_ledger (citizen_id, entry_type, amount_cents, report_id, idempotency_key) values ($1, 'REWARD_PENDING', 500, $2, $3)`, [U.citizenB, repB.id, `REWARD_PENDING:${repB.id}`]);
  await q(`insert into public.audit_events (actor_user_id, actor_role, source, entity_type, entity_id, event_type) values ($1, 'CITIZEN', 'USER_ACTION', 'report', $2, 'REPORT_SUBMITTED')`, [U.citizenB, repB.id]);

  const call = (fn, ...args) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args);
  const named = (fn, args) => {
    const keys = Object.keys(args);
    return q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
  };
  const r = async (user, fn, args = {}) => (await as(user, () => named(fn, args))).rows[0].r;
  const scalar = async (sql, params) => Number((await q(sql, params)).rows[0].n);
  const totalsSql = `select (select count(*) from public.reports) + (select count(*) from public.officer_cases) + (select count(*) from public.reward_ledger)
    + (select count(*) from public.audit_events) + (select count(*) from public.enforcement_outcomes) + (select count(*) from public.notifications) n`;

  const FUNCS = [
    ["admin_whoami", {}],
    ["admin_overview", { p_time_zone: "UTC" }],
    ["admin_page_reports", {}],
    ["admin_get_report", { p_public_number: Number(repB.public_report_number) }],
    ["admin_page_cases", {}],
    ["admin_get_case", { p_case_id: caseB }],
    ["admin_list_officers", {}],
    ["admin_page_rewards", {}],
    ["admin_page_audit", {}],
  ];

  // ===================================================================
  // Access matrix
  for (const [who, id] of [
    ["a citizen", U.citizenA],
    ["an officer", U.officer],
    ["an inactive supervisor", S.supInactive],
    ["an ADMIN profile without membership (no global admin)", S.adminNoMember],
    ["a citizen profile with an ADMIN membership row", S.citizenWithStaffRow],
  ]) {
    await ok(`T9.0: ${who} is refused by every console function`, async () => {
      for (const [fn, args] of FUNCS) {
        const res = await as(id, () => named(fn, args).then(() => "allowed", (e) => String(e.message)));
        if (!/FORBIDDEN/.test(res)) throw new Error(`${fn}: ${res}`);
      }
    });
  }
  await ok("T9.0: anonymous users cannot execute any console function", async () => {
    for (const [fn, args] of FUNCS) {
      const res = await anon(() => named(fn, args).then(() => "allowed", (e) => String(e.message)));
      if (!/permission denied/.test(res)) throw new Error(`${fn}: ${res}`);
    }
  });
  await ok("T9.0: an active supervisor sees their own organization", async () => {
    const w = await r(S.supA, "admin_whoami");
    if (w.role !== "SUPERVISOR" || w.organizations.length !== 1 || w.organizations[0].id !== org) throw new Error(JSON.stringify(w));
    if (JSON.stringify(w.jurisdictions) !== JSON.stringify(["helsinki-demo"])) throw new Error(JSON.stringify(w.jurisdictions));
  });
  await ok("T9.0: an active ADMIN member is scoped exactly like a supervisor (own organization only)", async () => {
    const w = await r(S.adminA, "admin_whoami");
    if (w.role !== "ADMIN" || JSON.stringify(w.jurisdictions) !== JSON.stringify(["helsinki-demo"])) throw new Error(JSON.stringify(w));
    const p = await r(S.adminA, "admin_page_reports", { p_limit: 100 });
    if (p.rows.some((x) => x.plate_raw === "ZZZ-999")) throw new Error("admin saw organization B");
  });

  // ===================================================================
  // Organization isolation
  const countA = await scalar(`select count(*) n from public.reports where jurisdiction_id = 'helsinki-demo'`);
  await ok("T9.0: Supervisor A's report list = exactly organization A's reports (B never appears)", async () => {
    const p = await r(S.supA, "admin_page_reports", { p_limit: 100 });
    if (Number(p.total) !== countA) throw new Error(`total ${p.total} != ${countA}`);
    if (p.rows.some((x) => x.plate_raw === "ZZZ-999")) throw new Error("org B row visible");
    if (countA < 3) throw new Error("scenario needs organization A reports");
  });
  await ok("T9.0: Supervisor A cannot open organization B's report or case (looks missing)", async () => {
    const rep = await r(S.supA, "admin_get_report", { p_public_number: Number(repB.public_report_number) });
    const c = await r(S.supA, "admin_get_case", { p_case_id: caseB });
    if (rep !== null || c !== null) throw new Error(JSON.stringify({ rep, c }));
  });
  await ok("T9.0: Supervisor B sees organization B only", async () => {
    const p = await r(S.supB, "admin_page_reports", { p_limit: 100 });
    if (Number(p.total) !== 1 || p.rows[0].plate_raw !== "ZZZ-999") throw new Error(JSON.stringify(p));
    const d = await r(S.supB, "admin_get_report", { p_public_number: Number(repB.public_report_number) });
    if (!d || d.report.notes !== "org B secret note" || d.evidence.length !== 1) throw new Error(JSON.stringify(d));
    const someA = (await q(`select public_report_number n from public.reports where jurisdiction_id = 'helsinki-demo' limit 1`)).rows[0].n;
    if ((await r(S.supB, "admin_get_report", { p_public_number: Number(someA) })) !== null) throw new Error("B opened an A report");
  });
  await ok("T9.0: officer lists never include another organization's members; inactive members are marked", async () => {
    const a = await r(S.supA, "admin_list_officers");
    if (a.some((m) => m.user_id === OFFB || m.user_id === S.supB)) throw new Error("org B member listed for A");
    if (a.some((m) => m.organization_id !== org)) throw new Error("foreign organization");
    const inactive = a.find((m) => m.user_id === S.supInactive);
    if (!inactive || inactive.active !== false) throw new Error(JSON.stringify(inactive));
    if (a.some((m) => "latitude" in m || "email" in m)) throw new Error("location/email exposed");
    const b = await r(S.supB, "admin_list_officers");
    if (!b.some((m) => m.user_id === OFFB) || b.some((m) => m.organization_id !== orgB)) throw new Error(JSON.stringify(b));
  });
  await ok("T9.0: the audit log is organization-scoped", async () => {
    const a = await r(S.supA, "admin_page_audit", { p_limit: 100 });
    if (a.rows.some((e) => Number(e.public_report_number) === Number(repB.public_report_number))) throw new Error("org B event visible to A");
    if (Number(a.total) < 5) throw new Error(`too few events: ${a.total}`);
    const b = await r(S.supB, "admin_page_audit", { p_limit: 100 });
    if (Number(b.total) !== 1) throw new Error(`B total ${b.total}`);
  });
  await ok("T9.0: audit filter by report number returns only that report's history", async () => {
    // A report that has recorded history (some verifier fixtures were inserted without any).
    const someA = (await q(`select r.public_report_number n from public.reports r where r.jurisdiction_id = 'helsinki-demo'
      and exists (select 1 from public.audit_events a where a.entity_type = 'report' and a.entity_id = r.id) limit 1`)).rows[0].n;
    const a = await r(S.supA, "admin_page_audit", { p_ref: String(someA), p_limit: 100 });
    if (Number(a.total) === 0 || a.rows.some((e) => Number(e.public_report_number) !== Number(someA))) throw new Error(JSON.stringify(a.rows.slice(0, 3)));
    const cross = await r(S.supA, "admin_page_audit", { p_ref: String(repB.public_report_number), p_limit: 100 });
    if (Number(cross.total) !== 0) throw new Error("org B history by reference");
  });
  await ok("T9.0: citizens appear only as a pseudonymous reference (no ids, names or emails)", async () => {
    const someA = (await q(`select public_report_number n, citizen_id c from public.reports where jurisdiction_id = 'helsinki-demo' limit 1`)).rows[0];
    const d = await r(S.supA, "admin_get_report", { p_public_number: Number(someA.n) });
    const text = JSON.stringify(d);
    if (!/^C-[0-9A-F]{8}$/.test(d.report.citizen_ref)) throw new Error(d.report.citizen_ref);
    if (text.includes(someA.c)) throw new Error("citizen uuid exposed");
    if (/citizen_id|email/.test(text)) throw new Error("citizen field exposed");
  });

  // ===================================================================
  // Evidence (private storage)
  // An organization A evidence row whose object really exists in storage.
  const pathA = (await q(`select e.storage_path p from public.report_evidence e join public.reports r on r.id = e.report_id
    join storage.objects o on o.bucket_id = 'report-evidence' and o.name = e.storage_path where r.jurisdiction_id = 'helsinki-demo' limit 1`)).rows[0].p;
  await ok("T9.0: a supervisor can read their organization's evidence objects (for signed URLs)", async () => {
    const n = (await as(S.supA, () => q(`select count(*) n from storage.objects where bucket_id = 'report-evidence' and name = $1`, [pathA]))).rows[0].n;
    if (Number(n) !== 1) throw new Error(`n=${n}`);
  });
  await denied("T9.0: a supervisor cannot read another organization's evidence objects", () =>
    as(S.supA, () => q(`select name from storage.objects where bucket_id = 'report-evidence' and name = $1`, [pathB]))
  );
  // ADMIN members are not enforcement members: only the new console policy lets them read (own org only).
  await ok("T9.0: an active ADMIN member can read their organization's evidence objects (console policy)", async () => {
    const n = (await as(S.adminA, () => q(`select count(*) n from storage.objects where bucket_id = 'report-evidence' and name = $1`, [pathA]))).rows[0].n;
    if (Number(n) !== 1) throw new Error(`n=${n}`);
  });
  await denied("T9.0: an ADMIN member cannot read another organization's evidence objects", () =>
    as(S.adminA, () => q(`select name from storage.objects where bucket_id = 'report-evidence' and name = $1`, [pathB]))
  );
  await denied("T9.0: an ADMIN profile without membership cannot read evidence objects", () =>
    as(S.adminNoMember, () => q(`select name from storage.objects where bucket_id = 'report-evidence' and name = $1`, [pathA]))
  );
  await denied("T9.0: an inactive supervisor cannot read evidence objects", () =>
    as(S.supInactive, () => q(`select name from storage.objects where bucket_id = 'report-evidence' and name = $1`, [pathA]))
  );
  await denied("T9.0: anonymous users still cannot read evidence objects", () => anon(() => q(`select name from storage.objects where bucket_id = 'report-evidence'`)));
  await ok("T9.0: evidence buckets stay private", async () => {
    const rows = (await q(`select id, public from storage.buckets where id in ('report-evidence', 'officer-evidence')`)).rows;
    if (rows.length !== 2 || rows.some((x) => x.public)) throw new Error(JSON.stringify(rows));
  });

  // ===================================================================
  // Pagination and filters
  await ok("T9.0: report pages are disjoint, ordered and report total / next_offset correctly", async () => {
    const p1 = await r(S.supA, "admin_page_reports", { p_offset: 0, p_limit: 2 });
    const p2 = await r(S.supA, "admin_page_reports", { p_offset: 2, p_limit: 2 });
    const ids1 = p1.rows.map((x) => x.id);
    if (ids1.length !== 2 || p2.rows.some((x) => ids1.includes(x.id))) throw new Error("pages overlap");
    if (Number(p1.total) !== countA || p1.next_offset !== 2) throw new Error(JSON.stringify({ t: p1.total, n: p1.next_offset }));
    const last = await r(S.supA, "admin_page_reports", { p_offset: countA - 1, p_limit: 2 });
    if (last.rows.length !== 1 || last.next_offset !== null) throw new Error(JSON.stringify(last.next_offset));
  });
  await ok("T9.0: page size is capped server-side (max 100)", async () => {
    const p = await r(S.supA, "admin_page_audit", { p_limit: 100000 });
    if (p.rows.length > 100) throw new Error(`rows=${p.rows.length}`);
  });
  await ok("T9.0: report filters run on the server (status, number search, plate search, case state)", async () => {
    const verified = await r(S.supA, "admin_page_reports", { p_status: "VERIFIED", p_limit: 100 });
    const want = await scalar(`select count(*) n from public.reports where jurisdiction_id = 'helsinki-demo' and status = 'VERIFIED'`);
    if (Number(verified.total) !== want || verified.rows.some((x) => x.status !== "VERIFIED")) throw new Error(`verified ${verified.total} vs ${want}`);
    const one = (await q(`select public_report_number n, plate_raw p from public.reports where jurisdiction_id = 'helsinki-demo' and plate_raw is not null limit 1`)).rows[0];
    const byNum = await r(S.supA, "admin_page_reports", { p_search: `#${one.n}` });
    if (Number(byNum.total) !== 1 || Number(byNum.rows[0].public_report_number) !== Number(one.n)) throw new Error(JSON.stringify(byNum));
    const byPlate = await r(S.supA, "admin_page_reports", { p_search: one.p.toLowerCase(), p_limit: 100 });
    if (Number(byPlate.total) < 1 || byPlate.rows.some((x) => x.plate_raw !== one.p)) throw new Error(JSON.stringify(byPlate.rows.map((x) => x.plate_raw)));
    const done = await r(S.supA, "admin_page_reports", { p_case_state: "completed", p_limit: 100 });
    if (done.rows.some((x) => x.case_status !== "COMPLETED")) throw new Error("case_state filter");
    const crossPlate = await r(S.supA, "admin_page_reports", { p_search: "ZZZ" });
    if (Number(crossPlate.total) !== 0) throw new Error("org B plate found by search");
  });
  await ok("T9.0: case filters (status, outcome) and the charge amount only for CHARGE_ISSUED", async () => {
    for (const st of ["NEW", "ASSIGNED", "EN_ROUTE", "ON_SITE", "INSPECTION", "COMPLETED"]) {
      const p = await r(S.supA, "admin_page_cases", { p_status: st, p_limit: 100 });
      const want = await scalar(`select count(*) n from public.officer_cases where jurisdiction_id = 'helsinki-demo' and status = $1`, [st]);
      if (Number(p.total) !== want || p.rows.some((x) => x.status !== st)) throw new Error(`${st}: ${p.total} vs ${want}`);
    }
    const all = await r(S.supA, "admin_page_cases", { p_limit: 100 });
    for (const c of all.rows) {
      if (c.outcome_code === "CHARGE_ISSUED" && !(c.parking_charge_amount_cents > 0)) throw new Error("charge missing");
      if (c.outcome_code !== "CHARGE_ISSUED" && c.parking_charge_amount_cents != null) throw new Error("charge on a non-charge outcome");
    }
    const charged = await r(S.supA, "admin_page_cases", { p_outcome: "CHARGE_ISSUED", p_limit: 100 });
    if (Number(charged.total) < 1 || charged.rows.some((x) => x.outcome_code !== "CHARGE_ISSUED")) throw new Error(JSON.stringify(charged.total));
  });
  await ok("T9.0: case detail shows citizen + officer evidence, checks and the outcome", async () => {
    const id = (await q(`select c.id from public.officer_cases c join public.enforcement_outcomes o on o.case_id = c.id
      where c.jurisdiction_id = 'helsinki-demo' and o.code = 'CHARGE_ISSUED'
        and (select count(*) from public.officer_evidence e where e.case_id = c.id) = 4 limit 1`)).rows[0].id;
    const d = await r(S.supA, "admin_get_case", { p_case_id: id });
    if (!d || d.citizen_evidence.length < 3 || d.officer_evidence.length !== 4 || !d.inspection || d.inspection.checks.length !== 4)
      throw new Error(JSON.stringify({ ce: d?.citizen_evidence.length, oe: d?.officer_evidence.length, checks: d?.inspection?.checks.length }));
    if (d.outcome.code !== "CHARGE_ISSUED" || !(d.outcome.parking_charge_amount_cents > 0)) throw new Error(JSON.stringify(d.outcome));
    if (!Array.isArray(d.audit) || d.audit.length === 0) throw new Error("no history");
  });

  // ===================================================================
  // Rewards
  await ok("T9.0: reward summary counts one reward per report (pending + release is not double-counted)", async () => {
    const p = await r(S.supA, "admin_page_rewards", { p_limit: 100 });
    const s = p.summary;
    const withPending = await scalar(`select count(*) n from public.reward_ledger l join public.reports r on r.id = l.report_id
      where r.jurisdiction_id = 'helsinki-demo' and l.entry_type = 'REWARD_PENDING'`);
    if (Number(s.pending_count) + Number(s.available_count) + Number(s.voided_count) !== withPending) throw new Error(JSON.stringify(s));
    const released = await scalar(`select count(*) n from public.reward_ledger l join public.reports r on r.id = l.report_id
      where r.jurisdiction_id = 'helsinki-demo' and l.entry_type = 'REWARD_RELEASED'`);
    if (Number(s.available_count) !== released) throw new Error(`available ${s.available_count} != released ${released}`);
    if (Number(s.available_cents) !== released * 500) throw new Error(`available cents ${s.available_cents}`);
    if (Number(s.pending_cents) !== Number(s.pending_count) * 500) throw new Error(`pending cents ${s.pending_cents}`);
    if (released < 1) throw new Error("scenario needs a released reward");
  });
  await ok("T9.0: reward rows belong to the right report and organization", async () => {
    const p = await r(S.supA, "admin_page_rewards", { p_limit: 100 });
    const entries = await scalar(`select count(*) n from public.reward_ledger l join public.reports r on r.id = l.report_id where r.jurisdiction_id = 'helsinki-demo'`);
    if (Number(p.total) !== entries) throw new Error(`total ${p.total} != ${entries}`);
    if (p.rows.some((x) => Number(x.public_report_number) === Number(repB.public_report_number))) throw new Error("org B ledger visible");
    for (const x of p.rows.slice(0, 10)) {
      const real = (await q(`select r.public_report_number n, l.amount_cents a from public.reward_ledger l join public.reports r on r.id = l.report_id where l.id = $1`, [x.id])).rows[0];
      if (Number(real.n) !== Number(x.public_report_number) || Number(real.a) !== Number(x.amount_cents)) throw new Error(JSON.stringify({ x, real }));
    }
    const pendingOnly = await r(S.supA, "admin_page_rewards", { p_state: "PENDING", p_limit: 100 });
    if (pendingOnly.rows.some((x) => x.reward_state !== "PENDING")) throw new Error("state filter");
  });

  // ===================================================================
  // Overview + read-only + existing RLS unchanged
  await ok("T9.0: overview numbers equal the organization's records", async () => {
    const o = await r(S.supA, "admin_overview", { p_time_zone: "Europe/Helsinki" });
    const active = await scalar(`select count(*) n from public.officer_cases where jurisdiction_id = 'helsinki-demo' and status <> 'COMPLETED'`);
    const fresh = await scalar(`select count(*) n from public.officer_cases where jurisdiction_id = 'helsinki-demo' and status = 'NEW'`);
    const review = await scalar(`select count(*) n from public.reports where jurisdiction_id = 'helsinki-demo' and status = 'UNDER_REVIEW'`);
    if (Number(o.cases_active) !== active || Number(o.cases_new) !== fresh || Number(o.reports_under_review) !== review) throw new Error(JSON.stringify(o));
    if (!Array.isArray(o.last_7_days) || o.last_7_days.length !== 7) throw new Error("7 days");
    const ob = await r(S.supB, "admin_overview", { p_time_zone: "UTC" });
    if (Number(ob.cases_new) !== 1 || Number(ob.reports_under_review) !== 1) throw new Error(JSON.stringify(ob));
  });
  await ok("T9.0: console functions are read-only (no row changes)", async () => {
    const before = await scalar(totalsSql);
    for (const [fn, args] of FUNCS) await as(S.supA, () => named(fn, args));
    const after = await scalar(totalsSql);
    if (before !== after) throw new Error(`${before} -> ${after}`);
  });
  await ok("T9.0: existing RLS is unchanged: supervisors still cannot read ledger/audit tables directly", async () => {
    const ledger = (await as(S.supA, () => q(`select count(*) n from public.reward_ledger`))).rows[0].n;
    if (Number(ledger) !== 0) throw new Error(`ledger rows visible: ${ledger}`);
    const audit = await as(S.supA, () => q(`select 1 from public.audit_events limit 1`).then(() => "readable", (e) => String(e.message)));
    if (!/permission denied/.test(audit)) throw new Error(audit);
  });
  await fails("T9.0: internal console helpers are not callable by clients", () => as(S.supA, () => call("pw_console_org_ids")), /permission denied/);
  await fails("T9.0: an invalid filter value is refused (not silently ignored)", () => as(S.supA, () => named("admin_page_reports", { p_case_state: "anything" })), /INVALID_INPUT/);
}
