// T9.0 hardening scenarios (after the independent security review) for
// scripts/verify-migrations.mjs. Runs after runT90 and reuses its accounts
// and organization B fixtures. Real migrations, real database roles.

export async function runT90Hardening(ctx) {
  const { db, q, as, anon, ok, fails, denied, U, org } = ctx;
  const OFFB = "00000000-0000-4000-8000-0000000000cb";
  const supA = "00000000-0000-4000-8000-00000000a0a1";
  const supB = "00000000-0000-4000-8000-00000000b0b1";
  const H = {
    multi: "00000000-0000-4000-8000-00000000c0c1", // active supervisor in A and B
    activeAInactiveB: "00000000-0000-4000-8000-00000000c0c2",
    supProfileAdminMember: "00000000-0000-4000-8000-00000000c0c3",
    adminProfileSupMember: "00000000-0000-4000-8000-00000000c0c4",
    revoked: "00000000-0000-4000-8000-00000000c0c5",
    forged: "00000000-0000-4000-8000-00000000c0c6",
  };
  const orgB = (await q(`select organization_id id from public.jurisdictions where id = 'other-city'`)).rows[0].id;
  await db.exec(`
    insert into auth.users (id, raw_user_meta_data) values
      ('${H.multi}', '{}'), ('${H.activeAInactiveB}', '{}'), ('${H.supProfileAdminMember}', '{}'),
      ('${H.adminProfileSupMember}', '{}'), ('${H.revoked}', '{}'),
      ('${H.forged}', '{"display_name": "Forged", "role": "ADMIN", "member_role": "ADMIN"}');
    update public.profiles set role = 'SUPERVISOR' where id in ('${H.multi}', '${H.activeAInactiveB}', '${H.supProfileAdminMember}', '${H.revoked}');
    update public.profiles set role = 'ADMIN' where id = '${H.adminProfileSupMember}';
    insert into public.organization_members (organization_id, user_id, member_role, active) values
      ('${org}', '${H.multi}', 'SUPERVISOR', true), ('${orgB}', '${H.multi}', 'SUPERVISOR', true),
      ('${org}', '${H.activeAInactiveB}', 'SUPERVISOR', true), ('${orgB}', '${H.activeAInactiveB}', 'SUPERVISOR', false),
      ('${org}', '${H.supProfileAdminMember}', 'ADMIN', true),
      ('${org}', '${H.adminProfileSupMember}', 'SUPERVISOR', true),
      ('${org}', '${H.revoked}', 'SUPERVISOR', true);
  `);

  const named = (fn, args = {}) => {
    const keys = Object.keys(args);
    return q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
  };
  const r = async (user, fn, args = {}) => (await as(user, () => named(fn, args))).rows[0].r;
  const scalar = async (sql, params) => Number((await q(sql, params)).rows[0].n);
  const countA = await scalar(`select count(*) n from public.reports where jurisdiction_id = 'helsinki-demo'`);
  const countB = await scalar(`select count(*) n from public.reports where jurisdiction_id = 'other-city'`);

  // Organization B: complete its case with an outcome and the audit event complete_case would write.
  const caseB = (await q(`select c.id from public.officer_cases c where c.jurisdiction_id = 'other-city' limit 1`)).rows[0].id;
  await q(`update public.officer_cases set status = 'COMPLETED', assigned_officer_id = $2, completed_at = now() where id = $1`, [caseB, OFFB]);
  await q(`insert into public.enforcement_outcomes (case_id, code, decided_by, decided_at) values ($1, 'VEHICLE_MOVED', $2, now())`, [caseB, OFFB]);
  await q(`insert into public.audit_events (actor_user_id, actor_role, source, entity_type, entity_id, event_type, metadata)
    values ($2, 'OFFICER', 'USER_ACTION', 'outcome', $1, 'OUTCOME_RECORDED', '{"code": "VEHICLE_MOVED", "charge_cents": null}')`, [caseB, OFFB]);

  // ===================================================================
  // A. OUTCOME_RECORDED (entity id = case id, as complete_case writes it)
  for (const code of ["CHARGE_ISSUED", "REPORT_REJECTED"]) {
    await ok(`T9.0 hardening: a completed ${code} case shows OUTCOME_RECORDED in its history`, async () => {
      // Prefer an event written by complete_case itself (it carries charge_cents).
      const row = (await q(`select c.id, a.metadata from public.officer_cases c join public.enforcement_outcomes o on o.case_id = c.id
        join public.audit_events a on a.entity_type = 'outcome' and a.entity_id = c.id
        where c.jurisdiction_id = 'helsinki-demo' and o.code = $1 order by (a.metadata ? 'charge_cents') desc limit 1`, [code])).rows[0];
      if (!row) throw new Error(`scenario has no ${code} outcome with an audit event`);
      const id = row.id;
      if (code === "CHARGE_ISSUED" && row.metadata.charge_cents == null) throw new Error("no complete_case event with charge_cents to check");
      const d = await r(supA, "admin_get_case", { p_case_id: id });
      const ev = d.audit.find((e) => e.event_type === "OUTCOME_RECORDED");
      if (!ev || ev.metadata.code !== code) throw new Error(JSON.stringify(d.audit.map((e) => e.event_type)));
      const rep = await r(supA, "admin_get_report", { p_public_number: Number(d.report.public_report_number) });
      if (!rep.audit.some((e) => e.event_type === "OUTCOME_RECORDED")) throw new Error("missing from report history");
      if (row.metadata.charge_cents != null && Number(ev.metadata.charge_cents) !== Number(row.metadata.charge_cents)) throw new Error(JSON.stringify(ev.metadata));
      if (code === "CHARGE_ISSUED" && row.metadata.charge_cents != null && !(Number(ev.metadata.charge_cents) > 0)) throw new Error("charge lost");
    });
  }
  await ok("T9.0 hardening: Audit 'outcome' filter returns OUTCOME_RECORDED for every organization A outcome", async () => {
    const want = await scalar(`select count(*) n from public.audit_events a join public.officer_cases c on c.id = a.entity_id
      where a.entity_type = 'outcome' and c.jurisdiction_id = 'helsinki-demo'`);
    const p = await r(supA, "admin_page_audit", { p_entity_type: "outcome", p_limit: 100 });
    if (want < 2 || Number(p.total) !== want) throw new Error(`total ${p.total}, want ${want}`);
    if (p.rows.some((e) => e.event_type !== "OUTCOME_RECORDED" || e.entity_type !== "outcome")) throw new Error("wrong rows");
  });
  await ok("T9.0 hardening: organization B's outcome event stays invisible to organization A", async () => {
    const a = await r(supA, "admin_page_audit", { p_entity_type: "outcome", p_ref: caseB, p_limit: 100 });
    if (Number(a.total) !== 0) throw new Error(`A sees ${a.total}`);
    const b = await r(supB, "admin_page_audit", { p_entity_type: "outcome", p_limit: 100 });
    if (Number(b.total) !== 1 || b.rows[0].metadata.code !== "VEHICLE_MOVED") throw new Error(JSON.stringify(b));
    if ((await r(supA, "admin_get_case", { p_case_id: caseB })) !== null) throw new Error("A opened B's case");
  });

  // ===================================================================
  // H. Metadata sanitizer (server-side allow-list)
  await ok("T9.0 hardening: audit metadata is reduced to allowed operational keys (case_id and unknown keys removed)", async () => {
    const rep = (await q(`select id, public_report_number n from public.reports where jurisdiction_id = 'helsinki-demo' order by submitted_at limit 1`)).rows[0];
    await q(`insert into public.audit_events (actor_user_id, actor_role, source, entity_type, entity_id, event_type, metadata)
      values (null, 'SYSTEM', 'SYSTEM', 'report', $1, 'CONSOLE_PROBE', $2::jsonb)`, [
      rep.id,
      JSON.stringify({ code: "OTHER", to: "VERIFIED", answer: false, case_id: rep.id, storage_path: "u/x/y.jpg", signed_url: "https://x", future_internal_key: "secret-ish", account: rep.id, nested: { code: "X" }, amount_cents: 500 }),
    ]);
    const d = await r(supA, "admin_get_report", { p_public_number: Number(rep.n) });
    const probe = d.audit.find((e) => e.event_type === "CONSOLE_PROBE");
    const keys = Object.keys(probe.metadata).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["amount_cents", "answer", "code", "to"])) throw new Error(JSON.stringify(probe.metadata));
    const page = await r(supA, "admin_page_audit", { p_ref: String(rep.n), p_limit: 100 });
    const p2 = page.rows.find((e) => e.event_type === "CONSOLE_PROBE");
    if (JSON.stringify(Object.keys(p2.metadata).sort()) !== JSON.stringify(keys)) throw new Error("audit page not sanitized");
  });
  await ok("T9.0 hardening: no console audit row carries case_id, ids, paths or URLs", async () => {
    const p = await r(supA, "admin_page_audit", { p_limit: 100 });
    const text = JSON.stringify(p.rows.map((e) => e.metadata));
    if (/case_id|storage_path|https?:|public_report_number/.test(text)) throw new Error(text.slice(0, 300));
    if (!p.rows.some((e) => e.event_type === "EVIDENCE_ADDED" && e.metadata.type)) throw new Error("allowed key 'type' was lost");
  });
  await fails("T9.0 hardening: the metadata sanitizer is internal (not callable by clients)", () => as(supA, () => q(`select public.pw_console_audit_metadata('{}'::jsonb)`)), /permission denied/);

  // ===================================================================
  // B. Multiple organizations
  await ok("T9.0 hardening: active in A and B -> sees the union of both organizations", async () => {
    const w = await r(H.multi, "admin_whoami");
    if (JSON.stringify(w.jurisdictions) !== JSON.stringify(["helsinki-demo", "other-city"])) throw new Error(JSON.stringify(w.jurisdictions));
    const p = await r(H.multi, "admin_page_reports", { p_limit: 100 });
    if (Number(p.total) !== countA + countB) throw new Error(`${p.total} vs ${countA}+${countB}`);
  });
  await ok("T9.0 hardening: active in A, inactive in B -> only A", async () => {
    const w = await r(H.activeAInactiveB, "admin_whoami");
    if (JSON.stringify(w.jurisdictions) !== JSON.stringify(["helsinki-demo"])) throw new Error(JSON.stringify(w.jurisdictions));
    const p = await r(H.activeAInactiveB, "admin_page_reports", { p_limit: 100 });
    if (Number(p.total) !== countA) throw new Error(`total ${p.total}`);
    if ((await r(H.activeAInactiveB, "admin_get_case", { p_case_id: caseB })) !== null) throw new Error("inactive org visible");
  });

  // C. Mismatched (but trusted, server-set) staff roles
  for (const [label, id] of [
    ["SUPERVISOR profile + ADMIN membership", H.supProfileAdminMember],
    ["ADMIN profile + SUPERVISOR membership", H.adminProfileSupMember],
  ]) {
    await ok(`T9.0 hardening: ${label} -> organization-scoped access`, async () => {
      const w = await r(id, "admin_whoami");
      if (JSON.stringify(w.jurisdictions) !== JSON.stringify(["helsinki-demo"])) throw new Error(JSON.stringify(w));
      const p = await r(id, "admin_page_reports", { p_limit: 100 });
      if (Number(p.total) !== countA) throw new Error(`total ${p.total}`);
    });
  }

  // D. Foreign officer filter
  await ok("T9.0 hardening: an organization B officer id as filter returns no rows to organization A", async () => {
    const p = await r(supA, "admin_page_cases", { p_officer: OFFB, p_limit: 100 });
    if (Number(p.total) !== 0 || p.rows.length !== 0) throw new Error(JSON.stringify(p));
  });

  // E. Membership revocation
  const pathA = (await q(`select e.storage_path p from public.report_evidence e join public.reports r on r.id = e.report_id
    join storage.objects o on o.bucket_id = 'report-evidence' and o.name = e.storage_path where r.jurisdiction_id = 'helsinki-demo' limit 1`)).rows[0].p;
  await ok("T9.0 hardening: revoked membership -> next console call FORBIDDEN and evidence access refused", async () => {
    await r(H.revoked, "admin_whoami");
    const before = await as(H.revoked, () => q(`select public.can_console_read_evidence_object('report-evidence', $1) x`, [pathA]));
    if (before.rows[0].x !== true) throw new Error("no access before revocation");
    await q(`update public.organization_members set active = false where user_id = $1`, [H.revoked]);
    const res = await as(H.revoked, () => named("admin_page_reports").then(() => "allowed", (e) => String(e.message)));
    if (!/FORBIDDEN/.test(res)) throw new Error(res);
    const after = await as(H.revoked, () => q(`select public.can_console_read_evidence_object('report-evidence', $1) x`, [pathA]));
    if (after.rows[0].x !== false) throw new Error("helper still true");
    const rows = (await as(H.revoked, () => q(`select name from storage.objects where bucket_id = 'report-evidence' and name = $1`, [pathA]))).rows;
    // SUPERVISOR is also an enforcement-member role (pre-existing rule); with the membership gone that path closes too.
    if (rows.length !== 0) throw new Error("object still readable");
  });

  // F. Storage helper called directly by non-console users on a REAL object
  await ok("T9.0 hardening: a citizen calling the console storage helper on a real object gets false", async () => {
    const x = (await as(U.citizenA, () => q(`select public.can_console_read_evidence_object('report-evidence', $1) x`, [pathA]))).rows[0].x;
    if (x !== false) throw new Error(String(x));
  });
  await ok("T9.0 hardening: an officer without staff access calling the console storage helper gets false", async () => {
    const x = (await as(U.officer, () => q(`select public.can_console_read_evidence_object('report-evidence', $1) x`, [pathA]))).rows[0].x;
    if (x !== false) throw new Error(String(x));
  });
  await denied("T9.0 hardening: anonymous users cannot call the console storage helper", () => anon(() => q(`select public.can_console_read_evidence_object('report-evidence', $1)`, [pathA])));

  // G. Forged user metadata
  await ok("T9.0 hardening: a citizen whose sign-up metadata claims ADMIN stays a citizen and is refused", async () => {
    const role = (await q(`select role from public.profiles where id = $1`, [H.forged])).rows[0].role;
    if (role !== "CITIZEN") throw new Error(role);
    const res = await as(H.forged, () => named("admin_whoami").then(() => "allowed", (e) => String(e.message)));
    if (!/FORBIDDEN/.test(res)) throw new Error(res);
  });
}
