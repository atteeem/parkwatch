// DEVELOPMENT/TEST ONLY: performs the CAMERA steps of a walkthrough against the
// local mock backend, for browsers without a camera (e.g. the web preview).
// It uses the same public API as the app (password sign-in, private storage
// upload, server functions) as a normal signed-in user - no admin access.
//
//   node scripts/mock-camera-steps.mjs submit [draftId]           citizen@example.test submits a report with 3 photos
//   node scripts/mock-camera-steps.mjs officer-photos <reportNo>  officer@example.test adds the 4 officer photos
//   node scripts/mock-camera-steps.mjs pilot-data                 T9.0 console QA: 5 reports through the real workflow
//                                                                 (charge issued, rejected, vehicle moved, in progress, new)
//
// Everything else (accept, checks, outcome, notifications, wallet) is done in the app.

const BASE = process.env.MOCK_BACKEND_URL ?? "http://localhost:54399";
// A valid 1x1 PNG so the app can display the (signed) photo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function signIn(email) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "mock-password-1" }) });
  if (!r.ok) throw new Error(`sign-in failed: ${r.status}`);
  const s = await r.json();
  return { token: s.access_token, id: s.user.id };
}
const auth = (t) => ({ authorization: `Bearer ${t}`, apikey: "mock-anon" });
async function upload(t, bucket, path) {
  const r = await fetch(`${BASE}/storage/v1/object/${bucket}/${path}`, { method: "POST", headers: { ...auth(t), "content-type": "image/png" }, body: PNG });
  if (!r.ok && r.status !== 409) throw new Error(`upload failed: ${r.status} ${await r.text()}`);
}
async function rpc(t, fn, args) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...auth(t), "content-type": "application/json" }, body: JSON.stringify(args) });
  const body = await r.json();
  if (!r.ok) throw new Error(`${fn}: ${body.message}`);
  return body;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "submit") {
  const me = await signIn("citizen@example.test");
  const draft = arg ?? `draft-walk-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const evidence = [];
  for (const slot of ["FRONT", "SIDE", "REAR"]) {
    const path = `${me.id}/${draft}/${draft}-${slot}.png`;
    await upload(me.token, "report-evidence", path);
    evidence.push({ slot, capture_source: "CAMERA", storage_path: path, captured_at: now });
  }
  const r = await rpc(me.token, "submit_report", {
    p_submission_id: draft, p_violation_type: "no-parking", p_location_address: "Mannerheimintie 45, Helsinki",
    p_observed_at: now, p_submitted_at: now, p_evidence: evidence, p_notes: "Walkthrough report",
    p_latitude: 60.1699, p_longitude: 24.9384, p_location_accuracy_m: 8, p_location_captured_at: now,
    p_plate_raw: "WLK-101", p_plate_normalized: "WLK101", p_plate_country: "FI", p_vehicle_make: "Toyota", p_vehicle_model: "Corolla", p_vehicle_color: "Silver", p_vehicle_source: "MOCK_DETECTED",
  });
  console.log(JSON.stringify({ reportNumber: r.public_report_number, created: r.created }));
} else if (cmd === "officer-photos" && arg) {
  const me = await signIn("officer@example.test");
  const snap = await rpc(me.token, "get_core_snapshot", {});
  const report = snap.reports.find((r) => String(r.public_report_number) === String(arg));
  const c = report && snap.cases.find((x) => x.report_id === report.id);
  if (!c) throw new Error("case not visible to officer@example.test");
  for (const type of ["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"]) {
    const path = `${c.id}/${type}-walk.png`;
    await upload(me.token, "officer-evidence", path);
    await rpc(me.token, "add_officer_evidence", { p_case_id: c.id, p_evidence_type: type, p_storage_path: path, p_captured_at: new Date().toISOString() });
  }
  console.log(JSON.stringify({ caseId: c.id, photos: 4 }));
} else if (cmd === "pilot-data") {
  // Same public API as the apps: the citizen submits, the officer works each case
  // with server functions. Nothing here bypasses Row Level Security.
  const citizen = await signIn("citizen@example.test");
  const officer = await signIn("officer@example.test");
  const plates = [["PLT-201", "no-parking"], ["PLT-202", "disabled"], ["PLT-203", "no-parking"], ["PLT-204", "fire-lane"], ["PLT-205", "no-parking"]];
  const made = [];
  for (const [i, [plate, violation]] of plates.entries()) {
    const draft = `draft-pilot-${Date.now().toString(36)}-${i}`;
    const now = new Date().toISOString();
    const evidence = [];
    for (const slot of ["FRONT", "SIDE", "REAR"]) {
      const path = `${citizen.id}/${draft}/${draft}-${slot}.png`;
      await upload(citizen.token, "report-evidence", path);
      evidence.push({ slot, capture_source: "CAMERA", storage_path: path, captured_at: now });
    }
    const r = await rpc(citizen.token, "submit_report", {
      p_submission_id: draft, p_violation_type: violation, p_location_address: `Mannerheimintie ${40 + i}, Helsinki`,
      p_observed_at: now, p_submitted_at: now, p_evidence: evidence, p_notes: i === 0 ? "Blocking the bike lane" : "",
      p_latitude: 60.1699 + i * 0.001, p_longitude: 24.9384, p_location_accuracy_m: i === 1 ? null : 8, p_location_captured_at: i === 1 ? null : now,
      p_location_source: i === 1 ? "MAP_SELECTED" : "GPS",
      p_plate_raw: plate, p_plate_normalized: plate.replace("-", ""), p_plate_country: "FI", p_vehicle_source: "MOCK_DETECTED",
    });
    made.push({ number: r.public_report_number, caseId: r.case_id });
  }
  const work = async (caseId, outcome) => {
    await rpc(officer.token, "accept_case", { p_case_id: caseId });
    if (!outcome) return;
    await rpc(officer.token, "start_en_route", { p_case_id: caseId });
    await rpc(officer.token, "start_inspection", { p_case_id: caseId });
    for (const key of ["vehiclePresent", "plateMatches", "violationConfirmed", "restrictionVerified"]) {
      await rpc(officer.token, "set_inspection_check", { p_case_id: caseId, p_check_key: key, p_answer: true });
    }
    for (const type of ["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"]) {
      const path = `${caseId}/${type}-pilot.png`;
      await upload(officer.token, "officer-evidence", path);
      await rpc(officer.token, "add_officer_evidence", { p_case_id: caseId, p_evidence_type: type, p_storage_path: path, p_captured_at: new Date().toISOString() });
    }
    await rpc(officer.token, "complete_case", { p_case_id: caseId, p_code: outcome, p_notes: outcome === "CHARGE_ISSUED" ? "Parking charge issued on site" : "" });
  };
  await work(made[0].caseId, "CHARGE_ISSUED");
  await work(made[1].caseId, "REPORT_REJECTED");
  await work(made[2].caseId, "VEHICLE_MOVED");
  await work(made[3].caseId, null); // accepted, in progress
  // made[4] stays NEW
  console.log(JSON.stringify(made.map((m) => m.number)));
} else {
  console.log("usage: submit [draftId] | officer-photos <reportNumber> | pilot-data");
  process.exit(1);
}
