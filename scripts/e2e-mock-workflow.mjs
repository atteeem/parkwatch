// DEVELOPMENT/TEST ONLY: end-to-end release smoke against the LOCAL mock
// backend (npm run mock:backend). Drives the real server functions through
// the same public API the app uses, as the mock test accounts:
//
//   citizen submits -> supervisor assigns -> officer starts route + inspection
//   -> 4 checks + 4 officer photos -> CHARGE_ISSUED -> citizen VERIFIED, €5 once,
//   one verified notification, one queued (not sent) push; a second report closed
//   as VEHICLE_MOVED -> no citizen outcome notification or push; retries change nothing.
//
//   node scripts/e2e-mock-workflow.mjs      -> prints JSON, exit 1 on failure
//
// Never point this at a real project: it refuses anything but localhost.

const BASE = process.env.MOCK_BACKEND_URL ?? "http://localhost:54399";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.log(JSON.stringify({ ok: false, reason: "Local mock only." }));
  process.exit(1);
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });

async function signIn(email) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "mock-password-1" }) });
  if (!r.ok) throw new Error(`sign-in ${email}: ${r.status}`);
  const s = await r.json();
  return { token: s.access_token, id: s.user.id };
}
const auth = (t) => ({ authorization: `Bearer ${t}`, apikey: "mock-anon" });
async function upload(t, bucket, path) {
  const r = await fetch(`${BASE}/storage/v1/object/${bucket}/${path}`, { method: "POST", headers: { ...auth(t), "content-type": "image/png" }, body: PNG });
  if (!r.ok && r.status !== 409) throw new Error(`upload ${r.status}`);
}
async function rpc(t, fn, args = {}) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...auth(t), "content-type": "application/json" }, body: JSON.stringify(args) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${fn}: ${body?.message ?? r.status}`);
  return body;
}
const outbox = async () => (await (await fetch(`${BASE}/__mock/push-outbox`, { method: "POST" })).json()).pushes;

async function submit(citizen, draft) {
  const now = new Date().toISOString();
  const evidence = [];
  for (const slot of ["FRONT", "SIDE", "REAR"]) {
    const path = `${citizen.id}/${draft}/${slot}.png`;
    await upload(citizen.token, "report-evidence", path);
    evidence.push({ slot, capture_source: "CAMERA", storage_path: path, captured_at: now });
  }
  return rpc(citizen.token, "submit_report", {
    p_submission_id: draft, p_violation_type: "no-parking", p_location_address: "Mannerheimintie 50, Helsinki",
    p_observed_at: now, p_submitted_at: now, p_evidence: evidence, p_latitude: 60.17, p_longitude: 24.94, p_location_accuracy_m: 8,
    p_location_captured_at: now, p_plate_raw: "E2E-123", p_plate_normalized: "E2E123", p_plate_country: "FI",
  });
}

try {
  const citizen = await signIn("citizen@example.test");
  const officer = await signIn("officer@example.test");
  const supervisor = await signIn("supervisor@example.test");
  const stamp = Date.now().toString(36);
  const before = (await outbox()).length;

  // 1. Citizen submits; a retry returns the same report.
  const rep = await submit(citizen, `e2e-${stamp}-a`);
  const again = await submit(citizen, `e2e-${stamp}-a`);
  check("citizen submit is idempotent (same report on retry)", rep.created === true && again.created === false && again.report_id === rep.report_id, { rep, again });

  // 2. Supervisor assigns the NEW case to the officer (one push queued for the officer).
  const caseDetail = await rpc(supervisor.token, "admin_get_case", { p_case_id: rep.case_id });
  const assign = await rpc(supervisor.token, "admin_assign_case", { p_case_id: rep.case_id, p_officer_id: officer.id, p_expected_version: caseDetail.case.assignment_version });
  const assignRetry = await rpc(supervisor.token, "admin_assign_case", { p_case_id: rep.case_id, p_officer_id: officer.id, p_expected_version: caseDetail.case.assignment_version });
  check("supervisor assignment works and its retry is a no-op", assign.changed === true && assignRetry.changed === false, { assign, assignRetry });

  // 3. Officer: start route, inspection, 4 checks, 4 photos, CHARGE_ISSUED (and a retry).
  await rpc(officer.token, "accept_case", { p_case_id: rep.case_id });
  await rpc(officer.token, "start_inspection", { p_case_id: rep.case_id });
  for (const k of ["vehiclePresent", "plateMatches", "violationConfirmed", "restrictionVerified"]) {
    await rpc(officer.token, "set_inspection_check", { p_case_id: rep.case_id, p_check_key: k, p_answer: true });
  }
  for (const t of ["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"]) {
    const path = `${rep.case_id}/${t}.png`;
    await upload(officer.token, "officer-evidence", path);
    await rpc(officer.token, "add_officer_evidence", { p_case_id: rep.case_id, p_evidence_type: t, p_storage_path: path, p_captured_at: new Date().toISOString() });
  }
  const done = await rpc(officer.token, "complete_case", { p_case_id: rep.case_id, p_code: "CHARGE_ISSUED" });
  const doneRetry = await rpc(officer.token, "complete_case", { p_case_id: rep.case_id, p_code: "CHARGE_ISSUED" });
  check("officer completes with CHARGE_ISSUED; €5 credited once; retry changes nothing", done.changed === true && done.credited_cents === 500 && doneRetry.changed === false, { done, doneRetry });

  // 4. Citizen view.
  const mine = await rpc(citizen.token, "get_my_report", { p_public_number: Number(rep.public_report_number) });
  const r = mine.reports?.[0];
  check("citizen report is VERIFIED", r?.status === "VERIFIED", r?.status);
  const ledger = await rpc(citizen.token, "get_my_ledger");
  const forReport = (ledger ?? []).filter((l) => l.report_id === rep.report_id).map((l) => l.entry_type).sort();
  check("reward ledger for the report: pending then released, once", JSON.stringify(forReport) === JSON.stringify(["REWARD_PENDING", "REWARD_RELEASED"]), forReport);
  const notes = await rpc(citizen.token, "page_my_notifications", { p_before_ts: null, p_before_id: null, p_limit: 50 });
  const verified = (notes.notifications ?? []).filter((n) => n.report_id === rep.report_id && n.type === "REPORT_VERIFIED");
  check("exactly one 'Report verified' notification", verified.length === 1, verified.length);

  // 5. A second report closed as VEHICLE_MOVED: no citizen outcome notification or push.
  const rep2 = await submit(citizen, `e2e-${stamp}-b`);
  await rpc(officer.token, "accept_case", { p_case_id: rep2.case_id });
  await rpc(officer.token, "complete_case", { p_case_id: rep2.case_id, p_code: "VEHICLE_MOVED" });
  const mine2 = await rpc(citizen.token, "get_my_report", { p_public_number: Number(rep2.public_report_number) });
  const notes2 = await rpc(citizen.token, "page_my_notifications", { p_before_ts: null, p_before_id: null, p_limit: 50 });
  const outcome2 = (notes2.notifications ?? []).filter((n) => n.report_id === rep2.report_id && (n.type === "REPORT_VERIFIED" || n.type === "REPORT_REJECTED"));
  check("VEHICLE_MOVED: citizen status stays UNDER_REVIEW, no outcome notification", mine2.reports?.[0]?.status === "UNDER_REVIEW" && outcome2.length === 0, { status: mine2.reports?.[0]?.status, outcome2: outcome2.length });

  // 6. Push queue: exactly one officer assignment push and one citizen verified push from this run.
  const added = (await outbox()).slice(before);
  const summary = added.map((p) => `${p.type}->${p.to}`).sort();
  check(
    "push queue: one CASE_ASSIGNED (officer) + one REPORT_VERIFIED (citizen), nothing for VEHICLE_MOVED",
    JSON.stringify(summary) === JSON.stringify(["CASE_ASSIGNED->officer@example.test", "REPORT_VERIFIED->citizen@example.test"]),
    summary
  );
} catch (e) {
  check("workflow ran without an error", false, String(e.message ?? e));
}
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
