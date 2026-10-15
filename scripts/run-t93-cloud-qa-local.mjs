// Dry run of scripts/sql/t93-cloud-qa.sql on PGlite (real migrations, same
// fixture ids as the development project). Checks the QA script itself before
// it is run against the real database. Prints the T93QA_RESULT summary.
//
//   node scripts/run-t93-cloud-qa-local.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStubDatabase } from "./lib/stubSupabaseDb.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { db } = await createStubDatabase();
const F = {
  citA: "995673e9-ca33-4d8e-9ae8-ce5b2510ee65",
  citB: "b5866d93-2c1b-4eb4-b6d1-ebb7a15bdbbe",
  offA1: "3ad86131-a63e-460b-aa54-5d9a9db0c05c",
  supA: "a3baee62-5f3c-47c7-a3a8-157ea5316bd1",
};
await db.exec(`
  insert into auth.users (id) values ('${F.citA}'), ('${F.citB}'), ('${F.offA1}'), ('${F.supA}');
  with o as (insert into public.organizations (name) values ('Dev org A') returning id)
  insert into public.jurisdictions (id, organization_id, name) select 'helsinki-demo', id, 'Helsinki' from o;
  update public.app_settings set default_jurisdiction_id = 'helsinki-demo';
  update public.profiles set role = 'OFFICER', display_name = 'Officer One' where id = '${F.offA1}';
  update public.profiles set role = 'SUPERVISOR', display_name = 'Supervisor' where id = '${F.supA}';
  insert into public.organization_members (organization_id, user_id, member_role)
    select j.organization_id, u, r::public.org_member_role from public.jurisdictions j,
    (values ('${F.offA1}'::uuid, 'OFFICER'), ('${F.supA}'::uuid, 'SUPERVISOR')) v(u, r);
`);
const count = `select (select count(*) from public.reports) + (select count(*) from public.notifications) + (select count(*) from public.push_devices) + (select count(*) from public.profiles) n`;
const before = (await db.query(count)).rows[0].n;
let summary;
try {
  await db.exec(readFileSync(join(root, "scripts/sql/t93-cloud-qa.sql"), "utf8"));
  summary = { error: "the QA script did not end with T93QA_RESULT" };
} catch (e) {
  const m = /T93QA_RESULT (\{.*\})/s.exec(String(e.message));
  summary = m ? JSON.parse(m[1]) : { error: String(e.message).slice(0, 500) };
}
const after = (await db.query(count)).rows[0].n;
console.log(JSON.stringify({ total: summary.total, failed: summary.failed, failures: summary.failures, error: summary.error, rolled_back: Number(before) === Number(after) }, null, 1));
