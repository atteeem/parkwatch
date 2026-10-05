// OPTIONAL real-cloud smoke test for a DEVELOPMENT Supabase project (T8.4).
// Not part of `npm test`. Runs only with explicit environment variables and
// uses only the public anon key + two TEST accounts (no service-role key, no
// admin access). Every record it creates is marked as a smoke test.
//
//   PARKWATCH_RUN_CLOUD_SMOKE=1 \
//   CLOUD_SMOKE_CONFIRM=development-project \
//   CLOUD_SMOKE_SUPABASE_URL=https://<dev-ref>.supabase.co \
//   CLOUD_SMOKE_ANON_KEY=<anon public key> \
//   CLOUD_SMOKE_CITIZEN_EMAIL=... CLOUD_SMOKE_CITIZEN_PASSWORD=... \
//   CLOUD_SMOKE_OFFICER_EMAIL=... CLOUD_SMOKE_OFFICER_PASSWORD=... \
//   npm run test:cloud-smoke
//
// Flow: citizen submits (3 private photos) -> officer accepts, inspects,
// uploads 4 private photos, issues CHARGE_ISSUED -> citizen sees VERIFIED,
// 5.00 available, one REPORT_VERIFIED notification. Plus security spot checks.
//
// Cleanup: the database keeps reports, ledger and audit rows append-only by
// design, so this script cannot (and must not) delete them. It creates ONE
// report per run; see docs/BACKEND_SETUP.md "Cloud smoke test data" for the
// manual cleanup SQL (run by the project owner in the SQL editor).

import { createClient } from "@supabase/supabase-js";

const env = process.env;
const REQUIRED = [
  "CLOUD_SMOKE_SUPABASE_URL",
  "CLOUD_SMOKE_ANON_KEY",
  "CLOUD_SMOKE_CITIZEN_EMAIL",
  "CLOUD_SMOKE_CITIZEN_PASSWORD",
  "CLOUD_SMOKE_OFFICER_EMAIL",
  "CLOUD_SMOKE_OFFICER_PASSWORD",
];
const missing = REQUIRED.filter((k) => !env[k]);
// 1) Explicit opt-in. Without it nothing runs (exit 0, so other scripts can call it safely).
if (env.PARKWATCH_RUN_CLOUD_SMOKE !== "1") {
  console.log(JSON.stringify({ ran: false, reason: "Opt-in required: set PARKWATCH_RUN_CLOUD_SMOKE=1 (development project and test accounts only)." }));
  process.exit(0);
}
// 2) Opted in but not configured: a clear failure, never a partial run.
if (env.CLOUD_SMOKE_CONFIRM !== "development-project" || missing.length) {
  const need = [...(env.CLOUD_SMOKE_CONFIRM !== "development-project" ? ["CLOUD_SMOKE_CONFIRM=development-project"] : []), ...missing];
  console.log(JSON.stringify({ ran: false, reason: `Missing configuration: ${need.join(", ")}. Never point this at production.` }));
  process.exit(1);
}

// Refuse anything that is not the public anon key.
const key = env.CLOUD_SMOKE_ANON_KEY;
const claims = (() => {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
})();
if (/^sb_secret_/.test(key) || claims?.role === "service_role") {
  console.log(JSON.stringify({ ran: false, reason: "Refusing a service-role/secret key. Use the anon (public) key." }));
  process.exit(1);
}

const URL_ = env.CLOUD_SMOKE_SUPABASE_URL.replace(/\/$/, "");
const MARK = `[ParkWatch cloud smoke test ${new Date().toISOString()}] Automated development test record - not a real violation.`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const results = [];
const check = (name, okv, detail) => results.push({ name, ok: !!okv, ...(detail !== undefined ? { detail } : {}) });

async function session(email, password) {
  const client = createClient(URL_, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for a test account (${error?.message ?? "no user"})`);
  return { client, id: data.user.id };
}
const rpc = async (c, fn, args = {}) => {
  const { data, error } = await c.client.rpc(fn, args);
  return error ? { error: String(error.message).split(":")[0], raw: error.code } : { data };
};

try {
  const citizen = await session(env.CLOUD_SMOKE_CITIZEN_EMAIL, env.CLOUD_SMOKE_CITIZEN_PASSWORD);
  const officer = await session(env.CLOUD_SMOKE_OFFICER_EMAIL, env.CLOUD_SMOKE_OFFICER_PASSWORD);
  const sub = `smoke-${Date.now().toString(36)}`;

  // --- citizen submit (private uploads) ---
  const now = new Date().toISOString();
  const evidence = [];
  for (const slot of ["FRONT", "SIDE", "REAR"]) {
    const path = `${citizen.id}/${sub}/${sub}-${slot}.png`;
    const { error } = await citizen.client.storage.from("report-evidence").upload(path, PNG, { contentType: "image/png", upsert: false });
    check(`citizen uploads ${slot} photo to the private bucket`, !error, error?.message);
    evidence.push({ slot, capture_source: "CAMERA", storage_path: path, captured_at: now });
  }
  const submitted = await rpc(citizen, "submit_report", {
    p_submission_id: sub, p_violation_type: "no-parking", p_location_address: "Cloud smoke test (development)",
    p_observed_at: now, p_submitted_at: now, p_evidence: evidence, p_notes: MARK,
    p_latitude: 60.1699, p_longitude: 24.9384, p_location_accuracy_m: 10, p_location_captured_at: now,
    p_plate_raw: "SMK-001", p_plate_normalized: "SMK001", p_plate_country: "FI", p_vehicle_source: "MOCK_DETECTED",
  });
  check("submit_report creates a report", submitted.data?.created === true, submitted.error ?? submitted.data);
  const reportNumber = Number(submitted.data?.public_report_number);
  const retry = await rpc(citizen, "submit_report", {
    p_submission_id: sub, p_violation_type: "no-parking", p_location_address: "Cloud smoke test (development)",
    p_observed_at: now, p_submitted_at: now, p_evidence: evidence, p_notes: MARK,
  });
  check("retrying the same submission returns the same report", retry.data?.created === false && Number(retry.data?.public_report_number) === reportNumber, retry.error ?? retry.data);

  const mine = await rpc(citizen, "get_my_report", { p_public_number: reportNumber });
  const report = mine.data?.reports?.[0];
  check("the report is owned by the citizen and Under Review", report?.citizen_id === citizen.id && report?.status === "UNDER_REVIEW", report && { owner: report.citizen_id === citizen.id, status: report.status });
  const ledger1 = (await rpc(citizen, "get_my_ledger")).data ?? [];
  check("a pending 5.00 reward exists", ledger1.some((l) => l.report_id === report?.id && l.entry_type === "REWARD_PENDING" && l.amount_cents === 500));
  const signed = await citizen.client.storage.from("report-evidence").createSignedUrls([evidence[0].storage_path], 60);
  check("the citizen can get a signed URL for their photo", !signed.error && !!signed.data?.[0]?.signedUrl);
  const pub = await fetch(`${URL_}/storage/v1/object/public/report-evidence/${evidence[0].storage_path}`);
  check("the photo is NOT reachable through a public URL", pub.status >= 400, pub.status);

  // --- security spot checks as the citizen ---
  const anyCases = await citizen.client.from("officer_cases").select("id").limit(1);
  check("a citizen sees no officer cases", !anyCases.error ? anyCases.data.length === 0 : true, anyCases.error?.message);
  const direct = await citizen.client.from("reports").insert({ citizen_id: citizen.id, source_draft_id: `${sub}-direct`, jurisdiction_id: "x", violation_type: "x", location_address: "x", observed_at: now, submitted_at: now });
  check("a citizen cannot insert reports directly", !!direct.error, direct.error?.code);

  // --- officer flow ---
  let caseId = null;
  for (let offset = 0; offset < 500 && !caseId; offset += 50) {
    const page = await rpc(officer, "page_officer_queue", { p_filter: "new", p_offset: offset, p_limit: 50 });
    caseId = page.data?.cases?.find((c) => c.report_id === report?.id)?.id ?? null;
    if (page.data?.next_offset == null) break;
  }
  check("the officer sees the new case in the queue", !!caseId);
  const citizenAccept = await rpc(citizen, "accept_case", { p_case_id: caseId });
  check("a citizen cannot accept a case", citizenAccept.error === "FORBIDDEN", citizenAccept.error);
  check("officer accepts", (await rpc(officer, "accept_case", { p_case_id: caseId })).data?.changed === true);
  const early = await rpc(officer, "complete_case", { p_case_id: caseId, p_code: "CHARGE_ISSUED" });
  check("a charge before the inspection is refused", early.error === "INVALID_TRANSITION", early.error);
  check("officer starts the inspection", !!(await rpc(officer, "start_inspection", { p_case_id: caseId })).data);
  for (const k of ["vehiclePresent", "violationConfirmed", "restrictionVerified"]) await rpc(officer, "set_inspection_check", { p_case_id: caseId, p_check_key: k, p_answer: true });
  await rpc(officer, "confirm_plate_by_scan", { p_case_id: caseId });
  for (const t of ["VEHICLE_OVERVIEW", "LICENSE_PLATE", "PARKING_SIGN", "VIOLATION_CONTEXT"]) {
    const path = `${caseId}/${t}-smoke.png`;
    const up = await officer.client.storage.from("officer-evidence").upload(path, PNG, { contentType: "image/png", upsert: false });
    const add = await rpc(officer, "add_officer_evidence", { p_case_id: caseId, p_evidence_type: t, p_storage_path: path, p_captured_at: new Date().toISOString() });
    check(`officer photo ${t} uploaded privately and attached`, !up.error && !add.error, up.error?.message ?? add.error);
  }
  const done = await rpc(officer, "complete_case", { p_case_id: caseId, p_code: "CHARGE_ISSUED", p_notes: MARK });
  check("CHARGE_ISSUED completes the case", done.data?.changed === true && done.data?.credited_cents === 500, done.error ?? done.data);
  const again = await rpc(officer, "complete_case", { p_case_id: caseId, p_code: "CHARGE_ISSUED" });
  check("repeating the outcome changes nothing", again.data?.changed === false, again.error ?? again.data);
  const detail = (await rpc(officer, "get_case_detail", { p_case_id: caseId })).data;
  check("the charge is 60.00, set by the server", detail?.outcomes?.[0]?.parking_charge_amount_cents === 6000, detail?.outcomes?.[0]?.parking_charge_amount_cents);

  // --- citizen consequences ---
  const after = (await rpc(citizen, "get_my_report", { p_public_number: reportNumber })).data?.reports?.[0];
  check("the citizen's report is VERIFIED", after?.status === "VERIFIED", after?.status);
  const ledger2 = (await rpc(citizen, "get_my_ledger")).data ?? [];
  check("the 5.00 reward was released exactly once", ledger2.filter((l) => l.report_id === report?.id && l.entry_type === "REWARD_RELEASED").length === 1);
  const notes = (await rpc(citizen, "page_my_notifications", { p_limit: 50 })).data?.notifications ?? [];
  check("exactly one REPORT_VERIFIED notification", notes.filter((n) => n.report_id === report?.id && n.type === "REPORT_VERIFIED").length === 1);

  const failed = results.filter((r) => !r.ok);
  // Nothing is deleted automatically (append-only history; no admin access here).
  // These are exactly the records this run created, for manual cleanup by the project owner.
  const manualCleanup = {
    note: "Created by this run only. Append-only rows cannot be deleted by clients; see docs/BACKEND_SETUP.md (Smoke test data).",
    reportNumber,
    submissionId: sub,
    caseId,
    storageObjects: [
      ...evidence.map((e) => `report-evidence/${e.storage_path}`),
      ...(caseId ? ["VEHICLE_OVERVIEW", "LICENSE_PLATE", "PARKING_SIGN", "VIOLATION_CONTEXT"].map((t) => `officer-evidence/${caseId}/${t}-smoke.png`) : []),
    ],
  };
  console.log(JSON.stringify({ ran: true, project: new URL(URL_).host, total: results.length, failed: failed.length, results, manualCleanup }, null, 2));
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.log(JSON.stringify({ ran: true, error: String(e?.message ?? e), results }, null, 2));
  process.exit(1);
}
