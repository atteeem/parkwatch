#!/usr/bin/env node
// recognize-plate smoke test against the DEVELOPMENT project (explicit opt-in).
//
//   PARKWATCH_RUN_PLATE_FUNCTION=1 node scripts/recognize-plate-smoke.mjs <plate-image.jpg> [--expect NNC685]
//   PARKWATCH_RUN_PLATE_FUNCTION=1 node scripts/recognize-plate-smoke.mjs --check-report <public report number>
//
// Reads the public URL/key from .env and the TEST citizen/officer credentials
// from the git-ignored .env.cloudqa.local (CLOUDQA_CITIZEN_A_*, CLOUDQA_OFFICER_A_*).
// Prints no passwords, tokens or keys. The image is sent once to the function
// (which sends it to the provider) and is not stored anywhere by ParkWatch.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DEV_HOST = "gmwssplqtjbrpvlvbjcs.supabase.co";
const readEnv = (f) =>
  existsSync(f)
    ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
    : {};
const env = { ...readEnv(".env"), ...readEnv(".env.cloudqa.local"), ...process.env };
const out = (o) => console.log(JSON.stringify(o));

if (env.PARKWATCH_RUN_PLATE_FUNCTION !== "1") {
  out({ ran: false, reason: "Opt-in required: PARKWATCH_RUN_PLATE_FUNCTION=1 (development project only)." });
  process.exit(0);
}
const url = (env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (!url || new URL(url).host !== DEV_HOST) {
  out({ ran: false, reason: `Refusing: not the development project (${DEV_HOST}).` });
  process.exit(1);
}
if (!key || key.startsWith("sb_secret_")) {
  out({ ran: false, reason: "Refusing: needs the public (anon/publishable) key." });
  process.exit(1);
}
const fnUrl = `${url}/functions/v1/recognize-plate`;
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function signIn(who) {
  const c = client();
  const email = env[`CLOUDQA_${who}_EMAIL`];
  const password = env[`CLOUDQA_${who}_PASSWORD`];
  if (!email || !password) throw new Error(`Missing CLOUDQA_${who}_EMAIL / _PASSWORD in .env.cloudqa.local`);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${who} (${error.message})`);
  return c;
}
const mask = (p) => (p ? `${p.slice(0, 2)}${"*".repeat(Math.max(0, p.length - 2))}` : p);

const args = process.argv.slice(2);
try {
  if (args[0] === "--check-report") {
    const n = Number(args[1]);
    const citizen = await signIn("CITIZEN_A");
    const { data: rep, error } = await citizen.rpc("get_my_report", { p_public_number: n });
    if (error) throw new Error(`get_my_report: ${error.message}`);
    const r = rep?.reports?.[0];
    if (!r) throw new Error("report not found for Citizen A");
    const evidence = rep.report_evidence ?? [];
    const officer = await signIn("OFFICER_A");
    let caseId = null;
    for (let o = 0; o < 2000 && !caseId; o += 50) {
      const { data: page } = await officer.rpc("page_officer_queue", { p_filter: "all", p_lat: null, p_lng: null, p_offset: o, p_limit: 50 });
      caseId = page?.cases?.find((c) => c.report_id === r.id)?.id ?? null;
      if (page?.next_offset == null) break;
    }
    const { data: detail } = caseId ? await officer.rpc("get_case_detail", { p_case_id: caseId }) : { data: null };
    const officerPlate = detail?.reports?.[0]?.plate_raw ?? null;
    const { data: notes } = await citizen.rpc("page_my_notifications", { p_before_ts: null, p_before_id: null, p_limit: 50 }).catch(() => ({ data: null }));
    const { data: ledger } = await citizen.rpc("get_my_ledger").catch(() => ({ data: null }));
    out({
      report: n,
      plate_raw: r.plate_raw,
      plate_normalized: r.plate_normalized,
      plate_country: r.plate_country,
      vehicle_source: r.vehicle_source,
      vehicle_make: r.vehicle_make,
      evidence_slots: evidence.map((e) => e.slot).sort(),
      evidence_count: evidence.length,
      officer_sees_case: !!caseId,
      officer_plate_matches: officerPlate === r.plate_raw,
      reward_entries_for_report: Array.isArray(ledger) ? ledger.filter((l) => l.report_id === r.id).map((l) => l.entry_type) : null,
      notifications_for_report: notes?.notifications ? notes.notifications.filter((x) => x.report_id === r.id).map((x) => x.type) : null,
    });
  } else {
    const image = args[0];
    if (!image || !existsSync(image)) throw new Error("Pass the path of a consented test plate image (JPEG/PNG).");
    const bytes = readFileSync(image);
    const mimeType = /\.png$/i.test(image) ? "image/png" : "image/jpeg";
    const body = JSON.stringify({ image: bytes.toString("base64"), mimeType });
    const results = {};
    // 1) no Authorization at all
    let res = await fetch(fnUrl, { method: "POST", headers: { "Content-Type": "application/json", apikey: key }, body });
    results.anonymous_no_auth = res.status;
    // 2) the public key as the bearer (not a user session)
    res = await fetch(fnUrl, { method: "POST", headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` }, body });
    results.anonymous_public_key = res.status;
    // 3) signed-in test citizen through supabase-js (as the app does)
    const citizen = await signIn("CITIZEN_A");
    const started = Date.now();
    const { data, error } = await citizen.functions.invoke("recognize-plate", { body: { image: bytes.toString("base64"), mimeType } });
    results.citizen_ms = Date.now() - started;
    if (error) {
      results.citizen_status = error.context?.status ?? error.name;
    } else {
      const tier = data.confidence == null ? "none" : data.confidence >= 0.85 ? "high" : data.confidence >= 0.6 ? "medium" : "low";
      results.citizen_status = 200;
      results.plate = args.includes("--unmasked") ? data.plate : mask(data.plate);
      results.normalized_matches_expected = args.includes("--expect") ? data.normalized === args[args.indexOf("--expect") + 1]?.toUpperCase() : undefined;
      results.country = data.country;
      results.confidence_tier = tier;
      results.candidates = data.candidates?.length ?? 0;
      results.provider = data.provider;
      results.response_keys = Object.keys(data).sort();
    }
    out(results);
  }
} catch (e) {
  out({ ran: true, error: String(e.message ?? e) });
  process.exit(1);
}
