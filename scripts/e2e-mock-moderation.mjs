// DEVELOPMENT/TEST ONLY: reporting moderation end to end over HTTP against the
// LOCAL mock backend (npm run mock:backend), through the same public API the
// app uses (real migrations in PGlite behind a PostgREST-shaped server).
//
//   citizen2 submits -> officer restricts (strike 1) -> citizen2 is refused
//   (submit and new evidence upload) -> citizen sees status without notes ->
//   supervisor lifts it -> citizen2 submits again; citizen cannot moderate.
//
//   node scripts/e2e-mock-moderation.mjs     -> prints JSON, exit 1 on failure
//
// Refuses anything but localhost.

const BASE = process.env.MOCK_BACKEND_URL ?? "http://localhost:54399";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.log(JSON.stringify({ ok: false, reason: "Local mock only." }));
  process.exit(1);
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const auth = (t) => ({ authorization: `Bearer ${t}`, apikey: "mock-anon" });

async function signIn(email) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "mock-password-1" }) });
  if (!r.ok) throw new Error(`sign-in ${email}: ${r.status}`);
  const s = await r.json();
  return { token: s.access_token, id: s.user.id };
}
async function upload(t, path) {
  const r = await fetch(`${BASE}/storage/v1/object/report-evidence/${path}`, { method: "POST", headers: { ...auth(t), "content-type": "image/png" }, body: PNG });
  return r.status;
}
async function rpc(t, fn, args = {}) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...auth(t), "content-type": "application/json" }, body: JSON.stringify(args) });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}
async function submit(c, draft) {
  const now = new Date().toISOString();
  const evidence = [];
  for (const slot of ["FRONT", "SIDE", "REAR"]) {
    const path = `${c.id}/${draft}/${slot}.png`;
    const st = await upload(c.token, path);
    if (st >= 400 && st !== 409) return { status: st, body: { message: `upload ${st}` } };
    evidence.push({ slot, capture_source: "CAMERA", storage_path: path, captured_at: now });
  }
  return rpc(c.token, "submit_report", {
    p_submission_id: draft, p_violation_type: "no-parking", p_location_address: "Mannerheimintie 50, Helsinki",
    p_observed_at: now, p_submitted_at: now, p_evidence: evidence, p_latitude: 60.17, p_longitude: 24.94, p_location_accuracy_m: 8,
    p_location_captured_at: now, p_plate_raw: "MOD-123", p_plate_normalized: "MOD123", p_plate_country: "FI",
  });
}
const rid = () => `mod-e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

try {
  const citizen = await signIn("citizen2@example.test");
  const other = await signIn("citizen@example.test");
  const officer = await signIn("officer@example.test");
  const supervisor = await signIn("supervisor@example.test");
  const stamp = Date.now().toString(36);

  const first = await submit(citizen, `mod-${stamp}-a`);
  check("normal citizen submits", first.status === 200 && first.body?.case_id, first);
  const caseId = first.body?.case_id;

  const byCitizen = await rpc(other.token, "restrict_reporter", { p_case_id: caseId, p_reason: "SPAM_INVALID", p_note: null, p_request_id: rid() });
  check("a citizen cannot restrict anyone (FORBIDDEN)", byCitizen.status >= 400 && /FORBIDDEN/.test(byCitizen.body?.message ?? ""), byCitizen);

  // Photos for a second report uploaded BEFORE the restriction (to try a direct submit afterwards).
  for (const slot of ["FRONT", "SIDE", "REAR"]) await upload(citizen.token, `${citizen.id}/mod-${stamp}-pre/${slot}.png`);

  // Repeatable on a long-running mock: compare with the starting state.
  const start = (await rpc(officer.token, "get_reporter_moderation", { p_case_id: caseId })).body ?? {};
  const s0 = start.strikes ?? 0;
  const h0 = (start.history ?? []).length;

  const req = rid();
  const r1 = await rpc(officer.token, "restrict_reporter", { p_case_id: caseId, p_reason: "FALSE_REPORT", p_note: "Pattern of false reports", p_request_id: req });
  const r1b = await rpc(officer.token, "restrict_reporter", { p_case_id: caseId, p_reason: "FALSE_REPORT", p_note: "Pattern of false reports", p_request_id: req });
  check("officer restricts: next strike (1 of 3 on a fresh account), 30 days; the retried request is a no-op", r1.body?.changed === true && r1.body?.strikes === s0 + 1 && r1.body?.status === "TEMPORARILY_RESTRICTED" && r1b.body?.changed === false && r1b.body?.strikes === s0 + 1, { r1: r1.body?.strikes, r1b: r1b.body });

  const blocked = await submit(citizen, `mod-${stamp}-b`);
  check("restricted citizen is refused (upload or submit)", blocked.status >= 400, blocked);
  const direct = await rpc(citizen.token, "submit_report", {
    p_submission_id: `mod-${stamp}-pre`, p_violation_type: "no-parking", p_location_address: "x", p_observed_at: new Date().toISOString(), p_submitted_at: new Date().toISOString(),
    p_evidence: ["FRONT", "SIDE", "REAR"].map((slot) => ({ slot, capture_source: "CAMERA", storage_path: `${citizen.id}/mod-${stamp}-pre/${slot}.png`, captured_at: new Date().toISOString() })),
  });
  check("no bypass: direct submit_report with photos uploaded before the restriction is refused with REPORTING_RESTRICTED", direct.status >= 400 && /REPORTING_RESTRICTED/.test(direct.body?.message ?? ""), direct);

  const mine = await rpc(citizen.token, "get_my_moderation");
  check("citizen status: restricted with its strike count, no notes or staff names", mine.body?.status === "TEMPORARILY_RESTRICTED" && mine.body?.strikes === s0 + 1 && !/Pattern of false|internal_note|actor|history/.test(JSON.stringify(mine.body)), mine.body);

  const staffView = await rpc(supervisor.token, "get_reporter_moderation", { p_case_id: caseId });
  const lift = await rpc(supervisor.token, "revoke_reporter_restriction", { p_case_id: caseId, p_action_id: staffView.body?.active_action_id, p_reason: "Reviewed: reports were valid", p_request_id: rid() });
  check("supervisor lifts the restriction: access back, strike kept, history has both", lift.body?.status === "ACTIVE" && lift.body?.strikes === s0 + 1 && lift.body?.history?.length === h0 + 2, lift.body);

  const again = await submit(citizen, `mod-${stamp}-c`);
  check("citizen submits again after the restriction is lifted", again.status === 200 && again.body?.report_id, again);
} catch (e) {
  check("moderation run completed without an error", false, String(e.message ?? e));
}
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
