#!/usr/bin/env node
// push-dispatch smoke test against the DEVELOPMENT project (explicit opt-in;
// only after the T9.2 migrations and the push-dispatch function were deployed
// with approval). It triggers ONE dispatch run and prints the counts the
// function returns. Real pushes are sent ONLY to devices that registered
// through the app (test accounts on test phones).
//
//   PARKWATCH_RUN_PUSH_QA=1 node scripts/push-dispatch-smoke.mjs
//
// Reads EXPO_PUBLIC_SUPABASE_URL from .env and PUSH_DISPATCH_SECRET from the
// git-ignored supabase/functions/.env. Prints no secrets, tokens or ids.

import { existsSync, readFileSync } from "node:fs";

const DEV_HOST = "gmwssplqtjbrpvlvbjcs.supabase.co";
const readEnv = (f) =>
  existsSync(f)
    ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
    : {};
const env = { ...readEnv(".env"), ...readEnv("supabase/functions/.env"), ...process.env };
const out = (o) => console.log(JSON.stringify(o));

if (env.PARKWATCH_RUN_PUSH_QA !== "1") {
  out({ ran: false, reason: "Opt-in required: PARKWATCH_RUN_PUSH_QA=1 (development project only; sends real pushes to registered test devices)." });
  process.exit(0);
}
const url = (env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
if (!url || new URL(url).host !== DEV_HOST) {
  out({ ran: false, reason: `Refusing: not the development project (${DEV_HOST}).` });
  process.exit(1);
}
const secret = env.PUSH_DISPATCH_SECRET ?? "";
if (secret.length < 32) {
  out({ ran: false, reason: "PUSH_DISPATCH_SECRET missing or too short in supabase/functions/.env." });
  process.exit(1);
}

const res = await fetch(`${url}/functions/v1/push-dispatch`, { method: "POST", headers: { "x-parkwatch-dispatch-secret": secret } });
const unauth = await fetch(`${url}/functions/v1/push-dispatch`, { method: "POST" });
const body = await res.json().catch(() => null);
out({
  status: res.status,
  without_secret_status: unauth.status,
  // Counts and short codes only.
  summary: body && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([k]) => ["claimed", "messages", "sent", "retrying", "failed", "noDevice", "receiptsChecked", "errors", "error"].includes(k))) : null,
});
process.exit(res.ok ? 0 : 1);
