// T8.7 scenarios for scripts/verify-migrations.mjs, executed against the REAL
// migrations under real database roles:
//   * report location provenance (GPS vs point picked on the map; no raw reporter GPS stored)
//   * officer evidence types VEHICLE_FRONT / VEHICLE_REAR (rename keeps rows)
//   * officer monthly statistics (server-side, own outcomes only)
//   * profile pictures (private bucket, own folder only, path-only column)

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function runT87(ctx) {
  const { db, q, as, anon, ok, fails, denied, U } = ctx;
  const OFF2 = "00000000-0000-4000-8000-0000000000c2"; // second officer of the same organization (created in T8.3)
  const call = (fn, ...args) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args);
  const upload = (bucket, name) => q(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())`, [bucket, name]);
  const ev = (citizen, sub) =>
    JSON.stringify(["FRONT", "SIDE", "REAR"].map((slot) => ({ slot, capture_source: "CAMERA", storage_path: `${citizen}/${sub}/${slot}.jpg`, captured_at: new Date().toISOString() })));
  const prepare = async (citizen, sub) => {
    await as(citizen, async () => {
      for (const s of ["FRONT", "SIDE", "REAR"]) await upload("report-evidence", `${citizen}/${sub}/${s}.jpg`);
    });
  };
  // Named arguments, as the app sends them.
  const submitNamed = (sub, extra) =>
    q(
      `select public.submit_report(p_submission_id => $1, p_violation_type => 'no-parking', p_location_address => 'Kaivokatu 1, Helsinki',
        p_observed_at => now(), p_submitted_at => now(), p_evidence => $2::jsonb, ${extra}) as r`,
      [sub, ev(U.citizenA, sub)]
    );
  const row = async (reportId) => (await q(`select * from public.reports where id = $1`, [reportId])).rows[0];

  // ===================================================================
  // Location provenance
  await ok("T8.7: a GPS point is stored with its accuracy, time and source GPS", async () => {
    await prepare(U.citizenA, "t87-gps");
    const r = (await as(U.citizenA, () =>
      submitNamed("t87-gps", `p_latitude => 60.17, p_longitude => 24.94, p_location_accuracy_m => 7, p_location_captured_at => now(), p_location_source => 'GPS'`)
    )).rows[0].r;
    const x = await row(r.report_id);
    if (x.location_source !== "GPS" || x.location_accuracy_m !== 7 || !x.location_captured_at) throw new Error(JSON.stringify(x));
  });
  await ok("T8.7: a point picked on the map is stored as MAP_SELECTED without accuracy/time", async () => {
    await prepare(U.citizenA, "t87-map");
    const r = (await as(U.citizenA, () => submitNamed("t87-map", `p_latitude => 60.1712, p_longitude => 24.9411, p_location_source => 'MAP_SELECTED'`))).rows[0].r;
    const x = await row(r.report_id);
    if (x.location_source !== "MAP_SELECTED" || x.latitude !== 60.1712 || x.location_accuracy_m !== null || x.location_captured_at !== null) throw new Error(JSON.stringify(x));
  });
  await ok("T8.7: data minimization - no column or submit_report parameter stores the raw reporter GPS", async () => {
    const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'reports' and column_name like 'device%'`)).rows;
    if (cols.length) throw new Error(JSON.stringify(cols));
    const args = (await q(`select pg_get_function_arguments(p.oid) a from pg_proc p where p.proname = 'submit_report'`)).rows.map((x) => x.a).join(" ");
    if (/device/.test(args)) throw new Error(args);
  });
  await fails(
    "T8.7: submit_report rejects a raw device fix argument",
    async () => {
      await prepare(U.citizenA, "t87-dev");
      await as(U.citizenA, () => submitNamed("t87-dev", `p_latitude => 60.17, p_longitude => 24.94, p_location_source => 'MAP_SELECTED', p_device_latitude => 60.17`));
    },
    /does not exist/
  );
  await fails(
    "T8.7: a map-picked point cannot carry GPS accuracy/time (it would pose as a GPS fix)",
    async () => {
      await prepare(U.citizenA, "t87-fake");
      await as(U.citizenA, () => submitNamed("t87-fake", `p_latitude => 60.17, p_longitude => 24.94, p_location_accuracy_m => 5, p_location_captured_at => now(), p_location_source => 'MAP_SELECTED'`));
    },
    /reports_map_point_not_gps/
  );
  await fails(
    "T8.7: an unknown location source is rejected",
    async () => {
      await prepare(U.citizenA, "t87-bad");
      await as(U.citizenA, () => submitNamed("t87-bad", `p_latitude => 60.17, p_longitude => 24.94, p_location_source => 'TYPED'`));
    },
    /check constraint/
  );
  await ok("T8.7: an older client (no source) still submits; its point counts as GPS", async () => {
    await prepare(U.citizenA, "t87-old");
    const r = (await as(U.citizenA, () => submitNamed("t87-old", `p_latitude => 60.17, p_longitude => 24.94, p_location_accuracy_m => 9, p_location_captured_at => now()`))).rows[0].r;
    const x = await row(r.report_id);
    if (x.location_source !== "GPS") throw new Error(JSON.stringify(x));
  });
  await ok("T8.7: an address-only report has no point and no source", async () => {
    await prepare(U.citizenA, "t87-addr");
    const r = (await as(U.citizenA, () => submitNamed("t87-addr", `p_notes => ''`))).rows[0].r;
    const x = await row(r.report_id);
    if (x.latitude !== null || x.location_source !== null) throw new Error(JSON.stringify(x));
  });
  await ok("T8.7: the old submit_report signature is gone (no ambiguous overload)", async () => {
    const n = Number((await q(`select count(*) n from pg_proc where proname = 'submit_report'`)).rows[0].n);
    if (n !== 1) throw new Error(`overloads=${n}`);
  });
  await denied("T8.7: anonymous users still cannot submit reports", () => anon(() => submitNamed("t87-anon", `p_notes => ''`)));
  await fails(
    "T8.7: citizens still cannot insert reports directly (new columns included)",
    () => as(U.citizenA, () => q(`insert into public.reports (citizen_id, source_draft_id, jurisdiction_id, violation_type, location_address, observed_at, submitted_at, location_source)
      values ('${U.citizenA}', 'direct-t87', 'helsinki-demo', 'no-parking', 'X', now(), now(), 'GPS')`)),
    /permission denied/
  );

  // ===================================================================
  // Officer evidence types
  await ok("T8.7: officer evidence types are VEHICLE_FRONT, LICENSE_PLATE, PARKING_SIGN, VEHICLE_REAR", async () => {
    const labels = (await q(`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'officer_evidence_type' order by enumsortorder`)).rows.map((r) => r.enumlabel);
    if (JSON.stringify(labels) !== JSON.stringify(["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"])) throw new Error(JSON.stringify(labels));
  });
  await fails("T8.7: the old label VEHICLE_OVERVIEW no longer exists", () => q(`select 'VEHICLE_OVERVIEW'::public.officer_evidence_type`), /invalid input value/);
  await ok("T8.7: every stored officer photo uses the new labels", async () => {
    const bad = (await q(`select evidence_type::text t from public.officer_evidence where evidence_type::text not in ('VEHICLE_FRONT', 'LICENSE_PLATE', 'PARKING_SIGN', 'VEHICLE_REAR')`)).rows;
    if (bad.length) throw new Error(JSON.stringify(bad));
    return `${(await q(`select count(*) n from public.officer_evidence`)).rows[0].n} rows`;
  });

  // ===================================================================
  // Monthly statistics
  const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const expected = async (officer) =>
    (await q(
      `select count(*)::int completed,
              count(*) filter (where code = 'CHARGE_ISSUED')::int issued,
              count(*) filter (where code = 'REPORT_REJECTED')::int rejected,
              count(*) filter (where code in ('VEHICLE_MOVED','VALID_PERMIT','DUPLICATE','OTHER'))::int no_charge
       from public.enforcement_outcomes where decided_by = $1 and decided_at >= $2 and decided_at < $3`,
      [officer, from, to]
    )).rows[0];
  const stats = async (officer, tz = "Europe/Helsinki") => (await as(officer, () => call("get_officer_monthly_stats", from, to, tz))).rows[0].r;
  await ok("T8.7: monthly stats = exactly the outcomes this officer decided (server-side)", async () => {
    const want = await expected(U.officer);
    const got = await stats(U.officer);
    for (const k of ["completed", "issued", "rejected", "no_charge"]) if (Number(got[k]) !== want[k]) throw new Error(`${k}: got ${got[k]}, want ${want[k]}`);
    if (want.completed === 0) throw new Error("scenario has no decided cases to count");
    const daySum = got.days.reduce((s, d) => s + Number(d.completed), 0);
    if (daySum !== want.completed) throw new Error(`days sum ${daySum} != ${want.completed}`);
    return JSON.stringify(want);
  });
  await ok("T8.7: another officer's statistics never include the first officer's decisions", async () => {
    const want = await expected(OFF2);
    const got = await stats(OFF2);
    if (Number(got.completed) !== want.completed) throw new Error(`got ${got.completed}, want ${want.completed}`);
  });
  await fails("T8.7: a citizen gets no officer statistics", () => stats(U.citizenA), /FORBIDDEN/);
  await denied("T8.7: anonymous users cannot call the statistics function", () => anon(() => call("get_officer_monthly_stats", from, to, "UTC")));
  await fails("T8.7: an invalid period is refused", () => as(U.officer, () => call("get_officer_monthly_stats", to, from, "UTC")), /INVALID_INPUT/);
  await ok("T8.7: an unknown time zone falls back to UTC instead of failing", async () => {
    const got = await stats(U.officer, "Not/AZone");
    if (got.time_zone !== "UTC") throw new Error(JSON.stringify(got.time_zone));
  });

  // ===================================================================
  // Profile pictures
  const A = U.citizenA;
  const B = U.citizenB;
  const pathA = `${A}/pic-1.jpg`;
  await ok("T8.7: the profile-avatars bucket exists and is private", async () => {
    const r = (await q(`select public, file_size_limit from storage.buckets where id = 'profile-avatars'`)).rows[0];
    if (!r || r.public !== false) throw new Error(JSON.stringify(r));
  });
  await ok("T8.7: a user can upload into their own avatar folder", () => as(A, () => upload("profile-avatars", pathA)));
  await fails("T8.7: a user cannot upload into someone else's avatar folder", () => as(B, () => upload("profile-avatars", `${A}/evil.jpg`)), /row-level security/);
  await denied("T8.7: another user cannot read someone's avatar object", () => as(B, () => q(`select name from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [pathA])));
  await denied("T8.7: anonymous users cannot read avatar objects", () => anon(() => q(`select name from storage.objects where bucket_id = 'profile-avatars'`)));
  await denied("T8.7: an officer cannot read a citizen's avatar object", () => as(U.officer, () => q(`select name from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [pathA])));
  await fails("T8.7: the avatar path column is not directly writable by clients", () => as(A, () => q(`update public.profiles set avatar_storage_path = $1 where id = $2`, [pathA, A])), /permission denied/);
  await fails("T8.7: set_my_avatar refuses another user's folder", () => as(B, () => call("set_my_avatar", pathA)), /FORBIDDEN/);
  await fails("T8.7: set_my_avatar refuses an object that was not uploaded", () => as(A, () => call("set_my_avatar", `${A}/missing.jpg`)), /EVIDENCE_NOT_UPLOADED/);
  await fails("T8.7: set_my_avatar refuses a non-image / odd path", () => as(A, () => call("set_my_avatar", `${A}/../x.exe`)), /FORBIDDEN/);
  await ok("T8.7: set_my_avatar stores only the path and returns the previous one", async () => {
    const r1 = (await as(A, () => call("set_my_avatar", pathA))).rows[0].r;
    if (r1.previous_path !== null || r1.path !== pathA) throw new Error(JSON.stringify(r1));
    await as(A, () => upload("profile-avatars", `${A}/pic-2.jpg`));
    const r2 = (await as(A, () => call("set_my_avatar", `${A}/pic-2.jpg`))).rows[0].r;
    if (r2.previous_path !== pathA) throw new Error(JSON.stringify(r2));
    const stored = (await as(A, () => q(`select avatar_storage_path p, role from public.profiles where id = $1`, [A]))).rows[0];
    if (stored.p !== `${A}/pic-2.jpg` || stored.role !== "CITIZEN") throw new Error(JSON.stringify(stored));
  });
  await ok("T8.7: the owner can delete the replaced object", async () => {
    await as(A, () => q(`delete from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [pathA]));
    const n = Number((await q(`select count(*) n from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [pathA])).rows[0].n);
    if (n !== 0) throw new Error(`still ${n}`);
  });
  await ok("T8.7: another user cannot delete someone's avatar object", async () => {
    await as(B, () => q(`delete from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [`${A}/pic-2.jpg`]));
    const n = Number((await q(`select count(*) n from storage.objects where bucket_id = 'profile-avatars' and name = $1`, [`${A}/pic-2.jpg`])).rows[0].n);
    if (n !== 1) throw new Error("deleted by another user");
  });
  await ok("T8.7: removing the avatar clears the path", async () => {
    const r = (await as(A, () => call("set_my_avatar", null))).rows[0].r;
    const stored = (await q(`select avatar_storage_path p from public.profiles where id = $1`, [A])).rows[0].p;
    if (r.previous_path !== `${A}/pic-2.jpg` || stored !== null) throw new Error(JSON.stringify({ r, stored }));
  });
  await denied("T8.7: anonymous users cannot call set_my_avatar", () => anon(() => call("set_my_avatar", null)));
  await fails("T8.7: the profile cannot point outside its own folder even as superuser", () => q(`update public.profiles set avatar_storage_path = $1 where id = $2`, [`${B}/x.jpg`, A]), /profiles_avatar_in_own_folder/);
}

/**
 * The enum rename keeps existing rows: apply every migration BEFORE T8.7,
 * store values with the old labels, then apply the rename and read them back.
 */
export async function runT87EnumRename(ctx, { migrationsDir, setupSql }) {
  const { ok } = ctx;
  await ok("T8.7: renaming VEHICLE_OVERVIEW/VIOLATION_CONTEXT keeps existing officer photos (old rows read back as FRONT/REAR)", async () => {
    const db = new PGlite();
    await db.exec(setupSql);
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    const rename = "20261010000002_officer_evidence_front_rear.sql";
    for (const f of files.filter((f) => f < rename)) await db.exec(readFileSync(join(migrationsDir, f), "utf8"));
    await db.exec(`create table public.t87_probe (id int primary key, t public.officer_evidence_type not null);
      insert into public.t87_probe values (1, 'VEHICLE_OVERVIEW'), (2, 'LICENSE_PLATE'), (3, 'PARKING_SIGN'), (4, 'VIOLATION_CONTEXT');`);
    await db.exec(readFileSync(join(migrationsDir, rename), "utf8"));
    const got = (await db.query(`select t::text t from public.t87_probe order by id`)).rows.map((r) => r.t);
    await db.close();
    if (JSON.stringify(got) !== JSON.stringify(["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"])) throw new Error(JSON.stringify(got));
  });
}
