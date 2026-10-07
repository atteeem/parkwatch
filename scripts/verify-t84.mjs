// T8.4 scenarios for scripts/verify-migrations.mjs: paginated, filter-aware
// reads and server-side counts (supabase/migrations/20261008000001_paged_reads.sql),
// executed against the REAL migrations under real roles.

export async function runT84(ctx) {
  const { db, q, as, anon, ok, fails, denied, U, org } = ctx;
  const P = "00000000-0000-4000-8000-0000000000d"; // + hex digit
  const CIT = `${P}a`; // citizen with many reports
  const CIT2 = `${P}b`; // another citizen
  const OFF = `${P}c`; // officer in org (helsinki-demo)
  const OFFX = `${P}e`; // officer in another org
  await db.exec(`insert into auth.users (id) values ('${CIT}'), ('${CIT2}'), ('${OFF}'), ('${OFFX}');
    update public.profiles set role = 'OFFICER' where id in ('${OFF}', '${OFFX}');
    insert into public.organization_members (organization_id, user_id, member_role) values ('${org}', '${OFF}', 'OFFICER');`);
  const orgX = (await q(`insert into public.organizations (name) values ('Paging Other') returning id`)).rows[0].id;
  await db.exec(`insert into public.jurisdictions (id, organization_id, name) values ('paging-other', '${orgX}', 'Other');
    insert into public.organization_members (organization_id, user_id, member_role) values ('${orgX}', '${OFFX}', 'OFFICER');`);

  // Server-side data (as the platform would create it): 60 reports for CIT, oldest first.
  // The two oldest are REJECTED and the three oldest cases are HIGH priority, so a
  // client that filtered only page 1 would wrongly report "none".
  const N = 60;
  await db.exec(`
    insert into public.reports (citizen_id, source_draft_id, jurisdiction_id, violation_type, location_address, latitude, longitude, observed_at, submitted_at, status, resolved_at)
    select '${CIT}', 'page-' || g, 'helsinki-demo', 'no-parking', 'Street ' || g, 60.1 + g * 0.001, 24.9, now() - (g || ' hours')::interval, now() - (g || ' hours')::interval,
           (case when g > ${N - 2} then 'REJECTED' else 'UNDER_REVIEW' end)::public.citizen_report_status,
           case when g > ${N - 2} then now() else null end
    from generate_series(1, ${N}) g;
    insert into public.officer_cases (report_id, jurisdiction_id, status, priority)
    select r.id, r.jurisdiction_id, 'NEW', (case when r.source_draft_id in ('page-${N}', 'page-${N - 1}', 'page-${N - 2}') then 'HIGH' else 'NORMAL' end)::public.report_priority
    from public.reports r where r.citizen_id = '${CIT}';
    insert into public.notifications (recipient_id, recipient_role, type, report_id, idempotency_key, created_at)
    select '${CIT}', 'CITIZEN', 'REPORT_UNDER_REVIEW', r.id, 'page-n-' || r.id, r.submitted_at from public.reports r where r.citizen_id = '${CIT}';
  `);
  // One case of another organization's area.
  await db.exec(`insert into public.reports (citizen_id, source_draft_id, jurisdiction_id, violation_type, location_address, observed_at, submitted_at)
    values ('${CIT2}', 'other-1', 'paging-other', 'no-parking', 'Elsewhere', now(), now());
    insert into public.officer_cases (report_id, jurisdiction_id) select id, jurisdiction_id from public.reports where source_draft_id = 'other-1';`);

  const call = async (user, sql, params = []) => (await as(user, () => q(sql, params))).rows[0].r;
  async function pageAll(user, fn, fixed, cursorKind) {
    const seen = [];
    let cursor = null;
    let offset = 0;
    for (let i = 0; i < 20; i++) {
      const r =
        cursorKind === "offset"
          ? await call(user, `select public.${fn}(${fixed}, p_offset => $1, p_limit => 25) as r`, [offset])
          : await call(user, `select public.${fn}(${fixed}${fixed ? ", " : ""}p_before_ts => $1, p_before_id => $2, p_limit => 25) as r`, [cursor?.ts ?? null, cursor?.id ?? null]);
      seen.push(...r.ids);
      if (cursorKind === "offset") {
        if (r.next_offset === null) break;
        offset = r.next_offset;
      } else {
        if (!r.next_cursor) break;
        cursor = r.next_cursor;
      }
    }
    return seen;
  }

  // --- citizen reports ---
  await ok("T8.4: my reports page in 25s, newest first, every report exactly once", async () => {
    const first = await call(CIT, `select public.page_my_reports(p_limit => 25) as r`);
    if (first.ids.length !== 25 || !first.next_cursor || first.reports.length !== 25) throw new Error(JSON.stringify({ n: first.ids.length }));
    const times = first.ids.map((id) => first.reports.find((x) => x.id === id).submitted_at);
    if ([...times].sort().reverse().join() !== times.join()) throw new Error("not newest first");
    const all = await pageAll(CIT, "page_my_reports", "", "keyset");
    if (all.length !== N || new Set(all).size !== N) throw new Error(`n=${all.length} unique=${new Set(all).size}`);
  });
  await ok("T8.4: a status filter is applied before paging (old rejected reports are found on page 1)", async () => {
    const r = await call(CIT, `select public.page_my_reports(p_status => 'REJECTED', p_limit => 25) as r`);
    if (r.ids.length !== 2 || r.next_cursor !== null || r.reports.some((x) => x.status !== "REJECTED")) throw new Error(JSON.stringify(r.ids));
  });
  await ok("T8.4: page size is clamped to 50", async () => {
    const r = await call(CIT, `select public.page_my_reports(p_limit => 100000) as r`);
    if (r.ids.length !== 50) throw new Error(`n=${r.ids.length}`);
  });
  await ok("T8.4: another citizen pages nothing of it", async () => {
    const r = await call(CIT2, `select public.page_my_reports() as r`);
    if (r.ids.some((id) => r.reports.find((x) => x.id === id)?.citizen_id === CIT)) throw new Error("leak");
    const one = await call(CIT2, `select public.get_my_report((select public_report_number from public.reports where source_draft_id = 'page-1')) as r`);
    if (one.reports.length !== 0) throw new Error("leak via get_my_report");
  });
  await ok("T8.4: citizen summary counts all reports (not just a page)", async () => {
    const s = await call(CIT, `select public.get_citizen_summary(now() - interval '10 hours') as r`);
    if (s.total !== N || s.rejected !== 2 || s.under_review !== N - 2 || s.since_total !== 9 || s.unread_notifications !== N) throw new Error(JSON.stringify(s));
  });
  await ok("T8.4: notifications page with a keyset cursor, each exactly once, with report numbers", async () => {
    const all = await pageAll(CIT, "page_my_notifications", "", "keyset");
    if (all.length !== N || new Set(all).size !== N) throw new Error(`n=${all.length}`);
    const first = await call(CIT, `select public.page_my_notifications(p_limit => 5) as r`);
    if (first.reports.length !== 5) throw new Error("referenced reports missing");
  });
  await ok("T8.4: a citizen's queue / my cases / case detail / officer summary are empty (RLS)", async () => {
    const qq = await call(CIT, `select public.page_officer_queue() as r`);
    const mc = await call(CIT, `select public.page_my_cases() as r`);
    const anyCase = (await q(`select id from public.officer_cases limit 1`)).rows[0].id;
    const d = await call(CIT, `select public.get_case_detail($1) as r`, [anyCase]);
    const s = await call(CIT, `select public.get_officer_summary() as r`);
    if (qq.ids.length || mc.ids.length || d.cases.length || s.open !== 0) throw new Error(JSON.stringify({ q: qq.ids.length, d: d.cases.length, s }));
  });

  // --- officer queue ---
  await ok("T8.4: officer queue pages cover every open visible case exactly once", async () => {
    const all = await pageAll(OFF, "page_officer_queue", "p_filter => 'all'", "offset");
    const expected = Number((await as(OFF, () => q(`select count(*) n from public.officer_cases where status <> 'COMPLETED'`))).rows[0].n);
    if (all.length !== expected || new Set(all).size !== expected || expected < N) throw new Error(`n=${all.length} expected=${expected}`);
  });
  await ok("T8.4: the High Priority filter finds high cases that are on the last page of 'all'", async () => {
    const r = await call(OFF, `select public.page_officer_queue(p_filter => 'high', p_limit => 25) as r`);
    const mine = r.cases.filter((c) => r.reports.find((x) => x.id === c.report_id)?.citizen_id === CIT);
    if (mine.length !== 3 || r.cases.some((c) => c.priority !== "HIGH" || c.status === "COMPLETED")) throw new Error(JSON.stringify(r.cases.map((c) => c.priority)));
  });
  await ok("T8.4: queue with a position is nearest first", async () => {
    const r = await call(OFF, `select public.page_officer_queue(p_filter => 'new', p_lat => 60.16, p_lng => 24.9, p_limit => 5) as r`);
    const lats = r.ids.map((id) => r.reports.find((x) => x.id === r.cases.find((c) => c.id === id).report_id).latitude);
    const d = lats.map((l) => Math.abs(l - 60.16));
    if (d.join() !== [...d].sort((a, b) => a - b).join()) throw new Error(JSON.stringify(lats));
  });
  await fails("T8.4: an unknown queue filter is refused", () => as(OFF, () => q(`select public.page_officer_queue(p_filter => 'everything')`)), /INVALID_DATA/);
  await ok("T8.4: an officer of another organization sees only their own area", async () => {
    const r = await call(OFFX, `select public.page_officer_queue() as r`);
    if (r.cases.some((c) => c.jurisdiction_id !== "paging-other") || r.cases.length !== 1) throw new Error(JSON.stringify(r.cases.map((c) => c.jurisdiction_id)));
    const s = await call(OFFX, `select public.get_officer_summary() as r`);
    if (s.open !== 1) throw new Error(JSON.stringify(s));
  });
  await ok("T8.4: Assigned / My cases tabs and summary counts follow the server state", async () => {
    // The officer takes and completes two cases through the real functions.
    const [c1, c2, c3] = (await as(OFF, () => q(`select c.id from public.officer_cases c join public.reports r on r.id = c.report_id where r.citizen_id = '${CIT}' and r.status = 'UNDER_REVIEW' order by r.submitted_at desc limit 3`))).rows.map((x) => x.id);
    await as(OFF, async () => {
      for (const c of [c1, c2, c3]) await q(`select public.accept_case($1)`, [c]);
      await q(`select public.complete_case($1, 'REPORT_REJECTED')`, [c1]);
      await q(`select public.complete_case($1, 'VEHICLE_MOVED')`, [c2]);
    });
    const assigned = await call(OFF, `select public.page_officer_queue(p_filter => 'assigned') as r`);
    const completed = await pageAll(OFF, "page_my_cases", "p_tab => 'completed'", "keyset");
    const rejected = await pageAll(OFF, "page_my_cases", "p_tab => 'rejected'", "keyset");
    const all = await pageAll(OFF, "page_my_cases", "p_tab => 'all'", "keyset");
    const s = await call(OFF, `select public.get_officer_summary(now() - interval '1 hour') as r`);
    const good = assigned.ids.length === 1 && assigned.ids[0] === c3 && completed.length === 2 && rejected.length === 1 && rejected[0] === c1 &&
      all.length === 3 && s.assigned_to_me === 1 && s.mine_total === 3 && s.mine_completed === 2 && s.mine_rejected === 1 && s.since_completed === 2;
    if (!good) throw new Error(JSON.stringify({ a: assigned.ids.length, completed: completed.length, rejected: rejected.length, all: all.length, s }));
    const d = await call(OFF, `select public.get_case_detail($1) as r`, [c3]);
    if (d.cases.length !== 1 || d.reports.length !== 1) throw new Error("detail");
  });
  await ok("T8.4: case detail of another organization's case is empty", async () => {
    const other = (await q(`select c.id from public.officer_cases c where c.jurisdiction_id = 'paging-other'`)).rows[0].id;
    const d = await call(OFF, `select public.get_case_detail($1) as r`, [other]);
    if (d.cases.length || d.reports.length) throw new Error("leak");
  });
  await denied("T8.4: anonymous users cannot page reports", () => anon(() => q(`select public.page_my_reports()`)));
  await denied("T8.4: anonymous users cannot read the officer queue", () => anon(() => q(`select public.page_officer_queue()`)));
  await ok("T8.4: every new read function is SECURITY INVOKER (RLS applies)", async () => {
    const rows = (await q(`select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname in ('page_my_reports','get_my_report','get_citizen_summary','get_my_ledger','page_my_notifications','page_officer_queue','page_my_cases','get_case_detail','get_officer_summary','pw_report_bundle','pw_case_bundle')`)).rows;
    if (rows.length !== 11 || rows.some((r) => r.prosecdef)) throw new Error(JSON.stringify(rows));
  });
}
