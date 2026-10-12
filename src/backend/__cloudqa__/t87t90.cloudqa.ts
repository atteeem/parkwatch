/**
 * @jest-environment node
 */
// T8.7 + T9.0 REAL-CLOUD QA — location provenance, officer monthly statistics,
// profile avatars and the operations console against a REAL Supabase DEVELOPMENT
// project. Same opt-in and configuration as realCloud.cloudqa.ts:
//   PARKWATCH_RUN_CLOUD_QA=1 npm run test:cloud-qa
// plus, for the console part, a development staff account (server-set
// SUPERVISOR/ADMIN profile role + active SUPERVISOR/ADMIN membership in the
// organization of the test officers):
//   CLOUDQA_SUPERVISOR_EMAIL, CLOUDQA_SUPERVISOR_PASSWORD
// Without them the console part is skipped (reported as not run). Passwords are
// never printed or written. Results (ids/counts only) go to
// `cloud-qa-t87-t90-results.local.json` (git-ignored).
import * as fs from "fs";
import * as path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createCoreOperations, CoreOperations, PageBundle } from "../operations/coreOperations";
import { createEvidenceStorage, EVIDENCE_BUCKETS, ReadLocalFile } from "../storage/evidenceStorage";
import { createCoreBackendStore, CoreBackendStore } from "../core/coreBackendStore";
import { AVATAR_BUCKET, avatarPath, createAvatarRepository, removeAvatar, replaceAvatar } from "../storage/avatarStorage";
import { createAdminOperations } from "../admin/adminOperations";
import { AdminApi } from "../../admin/adminTypes";
import { completeDraft } from "../../domain/__tests__/fixtures";
import { ReportDraft } from "../../domain";
import { nodeFetch } from "../__tests__/helpers/nodeFetch";

const ROOT = path.resolve(__dirname, "../../..");
const RUN = process.env.PARKWATCH_RUN_CLOUD_QA === "1";

function readEnvFile(file: string): Record<string, string> {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
  );
}
const env = { ...readEnvFile(".env"), ...readEnvFile(".env.cloudqa.local"), ...process.env } as Record<string, string | undefined>;
const URL_ = (env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const ACCOUNTS = {
  citizenA: { email: env.CLOUDQA_CITIZEN_A_EMAIL ?? "CitizenA@gmail.com", password: env.CLOUDQA_CITIZEN_A_PASSWORD, role: "citizen" as const },
  citizenB: { email: env.CLOUDQA_CITIZEN_B_EMAIL ?? "CitizenB@gmail.com", password: env.CLOUDQA_CITIZEN_B_PASSWORD, role: "citizen" as const },
  officerA: { email: env.CLOUDQA_OFFICER_A_EMAIL ?? "OfficerA@gmail.com", password: env.CLOUDQA_OFFICER_A_PASSWORD, role: "officer" as const },
  officerB: { email: env.CLOUDQA_OFFICER_B_EMAIL ?? "OfficerB@gmail.com", password: env.CLOUDQA_OFFICER_B_PASSWORD, role: "officer" as const },
};
type AccountKey = keyof typeof ACCOUNTS;
const SUPERVISOR = { email: env.CLOUDQA_SUPERVISOR_EMAIL, password: env.CLOUDQA_SUPERVISOR_PASSWORD };
const HAS_SUPERVISOR = !!(SUPERVISOR.email && SUPERVISOR.password);
// Revocation check: deactivate the supervisor's membership (admin tooling), then run
// with CLOUDQA_SUPERVISOR_STATE=inactive. Reactivate afterwards.
const SUPERVISOR_INACTIVE = env.CLOUDQA_SUPERVISOR_STATE === "inactive";

const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14);
const MARK = `[ParkWatch cloud QA T8.7/T9 ${RUN_ID}] Automated development test record - not a real violation.`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64"
);
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const readPng: ReadLocalFile = async () => buf(PNG);
const TZ = "UTC";
const results: Record<string, unknown> = { runId: RUN_ID, project: URL_ ? new URL(URL_).host : null, supervisorConfigured: HAS_SUPERVISOR };
const AUDIT_KEYS = ["code", "entry", "amount_cents", "charge_cents", "check", "answer", "via", "type", "from", "to", "outcome"];

type Session = { key: string; client: SupabaseClient; userId: string; ops: CoreOperations; store: CoreBackendStore };

function client(): SupabaseClient {
  return createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: nodeFetch } });
}

async function signIn(key: AccountKey): Promise<Session> {
  const a = ACCOUNTS[key];
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email: a.email, password: a.password ?? "" });
  if (error || !data.user) throw new Error(`Sign-in failed for ${key}: ${error?.message ?? "no session"}`);
  const ops = createCoreOperations(c);
  const store = createCoreBackendStore({ userId: data.user.id, role: a.role, ops, storage: createEvidenceStorage(c, readPng), minFocusRefreshMs: 0, pageSize: 25, onUnauthenticated: () => {} });
  return { key, client: c, userId: data.user.id, ops, store };
}

const consoleFor = (c: SupabaseClient, onForbidden?: () => void): AdminApi => createAdminOperations(c, createEvidenceStorage(c, readPng), { timeZone: () => TZ, onForbidden });

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }, what = ""): T => {
  if (!r.ok) throw new Error(`unexpected ${r.error.code} ${what}`);
  return r.value;
};

function qaDraft(name: string, source: "GPS" | "MAP_SELECTED"): ReportDraft {
  const d = completeDraft(`cqa9-${RUN_ID}-${name}`);
  const now = new Date().toISOString();
  for (const slot of ["FRONT", "SIDE", "REAR"] as const) d.photos[slot] = { ...d.photos[slot]!, uri: `file:///${slot.toLowerCase()}.png`, capturedAt: now };
  // A map-picked draft still carries the device's accuracy/time locally: the app must not send them.
  const coordinates = source === "GPS" ? { latitude: 60.1699, longitude: 24.9384, accuracyMeters: 7, capturedAt: now } : { latitude: 60.17123, longitude: 24.94111, accuracyMeters: 25, capturedAt: now };
  return {
    ...d,
    notes: MARK,
    location: { address: `Cloud QA T8.7/T9 ${source} (development)`, coordinates, coordinatesSource: source, deviceFix: { latitude: 60.1, longitude: 24.9 } } as ReportDraft["location"],
  };
}

async function findCase(officer: Session, reportUuid: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const page = unwrap(await officer.ops.pageOfficerQueue("all", null, offset, 50));
    ids.push(...(page.cases ?? []).filter((c) => c.report_id === reportUuid).map((c) => c.id));
    if (page.next_offset == null) break;
  }
  return ids;
}

async function submit(citizen: Session, officer: Session, name: string, source: "GPS" | "MAP_SELECTED" = "GPS") {
  const draft = qaDraft(name, source);
  const r = unwrap(await citizen.store.submitReport(draft), `submit ${name}`);
  expect(r.created).toBe(true);
  const rep = unwrap(await citizen.ops.getMyReport(Number(r.reportId)));
  const row = rep.reports![0];
  const cases = await findCase(officer, row.id);
  expect(cases).toHaveLength(1);
  return { draft, publicNumber: Number(r.reportId), reportUuid: row.id, caseId: cases[0], row, evidence: rep.report_evidence ?? [] };
}
type Submitted = Awaited<ReturnType<typeof submit>>;

const ledgerOf = async (s: Session, reportUuid: string) => unwrap(await s.ops.getMyLedger()).filter((l) => l.report_id === reportUuid).map((l) => l.entry_type).sort();
const notifsOf = async (s: Session, reportUuid: string) => {
  const out: string[] = [];
  let cursor: { ts: string; id: string } | null = null;
  for (let i = 0; i < 20; i++) {
    const p: PageBundle = unwrap(await s.ops.pageMyNotifications(cursor, 50));
    out.push(...(p.notifications ?? []).filter((n) => n.report_id === reportUuid).map((n) => n.type));
    if (!p.next_cursor) break;
    cursor = p.next_cursor;
  }
  return out.sort();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const monthRangeUtc = () => {
  const n = new Date();
  return { from: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString(), to: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString() };
};
type Stats = { completed: number; issued: number; rejected: number; no_charge: number; days: { day: string; completed: number; issued: number; rejected: number; no_charge: number }[] };
const statsOf = async (s: Session): Promise<Stats> => {
  const { from, to } = monthRangeUtc();
  return unwrap(await s.ops.getOfficerMonthlyStats(from, to, TZ)) as unknown as Stats;
};
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (s: Stats) => s.days.find((d) => d.day === today()) ?? { completed: 0, issued: 0, rejected: 0, no_charge: 0 };

const d = RUN ? describe : describe.skip;

d("REAL Supabase development project — T8.7 + T9.0 cloud QA", () => {
  const S = {} as Record<AccountKey, Session>;
  let gps: Submitted;
  let mapped: Submitted;
  let charge: Submitted;
  let reject: Submitted;
  let moved: Submitted;
  let statsBefore: { a: Stats; b: Stats };

  beforeAll(async () => {
    const missing = [!URL_ && "EXPO_PUBLIC_SUPABASE_URL", !KEY && "EXPO_PUBLIC_SUPABASE_ANON_KEY", ...Object.entries(ACCOUNTS).filter(([, a]) => !a.password).map(([k]) => k)].filter(Boolean);
    if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
    if (/^sb_secret_/.test(KEY)) throw new Error("Refusing a secret key: use the anon/publishable key");
    for (const k of Object.keys(ACCOUNTS) as AccountKey[]) S[k] = await signIn(k);
    statsBefore = { a: await statsOf(S.officerA), b: await statsOf(S.officerB) };
  }, 60_000);

  afterAll(() => {
    fs.writeFileSync(path.join(ROOT, "cloud-qa-t87-t90-results.local.json"), JSON.stringify(results, null, 2));
  });

  describe("T8.7 report location provenance", () => {
    it("GPS report: stored once with source GPS, accuracy and capture time; private evidence; one pending reward, case and notification", async () => {
      gps = await submit(S.citizenA, S.officerA, "gps", "GPS");
      expect(gps.row).toMatchObject({ location_source: "GPS", location_accuracy_m: 7 });
      expect(gps.row.location_captured_at).toBeTruthy();
      expect(gps.evidence).toHaveLength(3);
      for (const e of gps.evidence) expect(e.storage_path.startsWith(`${S.citizenA.userId}/`)).toBe(true);
      expect(await ledgerOf(S.citizenA, gps.reportUuid)).toEqual(["REWARD_PENDING"]);
      expect(await notifsOf(S.citizenA, gps.reportUuid)).toEqual(["REPORT_UNDER_REVIEW"]);
      const pub = await nodeFetch(`${URL_}/storage/v1/object/public/report-evidence/${gps.evidence[0].storage_path}`);
      expect(pub.status).toBeGreaterThanOrEqual(400);
      results.gpsReport = { publicNumber: gps.publicNumber, caseId: gps.caseId };
    });

    it("retrying the same GPS submission returns the same report: no duplicate case, reward or notification", async () => {
      const again = unwrap(await S.citizenA.store.submitReport(gps.draft));
      expect(again).toMatchObject({ created: false });
      expect(Number(again.reportId)).toBe(gps.publicNumber);
      expect(await findCase(S.officerA, gps.reportUuid)).toEqual([gps.caseId]);
      expect(await ledgerOf(S.citizenA, gps.reportUuid)).toEqual(["REWARD_PENDING"]);
      expect(await notifsOf(S.citizenA, gps.reportUuid)).toEqual(["REPORT_UNDER_REVIEW"]);
    });

    it("MAP_SELECTED report: corrected point stored, accuracy/time null, no raw device fix stored", async () => {
      mapped = await submit(S.citizenA, S.officerA, "map", "MAP_SELECTED");
      expect(mapped.row).toMatchObject({ location_source: "MAP_SELECTED", latitude: 60.17123, longitude: 24.94111, location_accuracy_m: null, location_captured_at: null });
      const { data, error } = await S.citizenA.client.from("reports").select("*").eq("id", mapped.reportUuid).single();
      expect(error).toBeNull();
      expect(Object.keys(data!).filter((k) => /^device_|original/i.test(k))).toEqual([]);
      expect(JSON.stringify(data)).not.toContain("60.1,");
      results.mapReport = { publicNumber: mapped.publicNumber, caseId: mapped.caseId };
    });

    it("submit_report no longer accepts a raw device fix argument", async () => {
      const { error } = await S.citizenA.client.rpc("submit_report", { p_submission_id: `cqa9-${RUN_ID}-dev`, p_device_latitude: 60.1, p_device_longitude: 24.9 });
      expect(error).toBeTruthy();
    });

    it("Citizen B cannot read Citizen A's report, evidence, ledger or notifications", async () => {
      const b = S.citizenB;
      expect(unwrap(await b.ops.getMyReport(gps.publicNumber)).reports).toEqual([]);
      expect((await b.client.from("reports").select("id").eq("id", gps.reportUuid)).data).toEqual([]);
      expect((await b.client.from("report_evidence").select("id").eq("report_id", gps.reportUuid)).data).toEqual([]);
      expect((await b.client.from("reward_ledger").select("id").eq("report_id", gps.reportUuid)).data).toEqual([]);
      expect((await b.client.from("notifications").select("id").eq("report_id", gps.reportUuid)).data).toEqual([]);
      expect(await createEvidenceStorage(b.client).sign(EVIDENCE_BUCKETS.citizen, gps.evidence.map((e) => e.storage_path))).toEqual({});
    });
  });

  describe("officer workflow, T8.7 evidence labels and outcomes", () => {
    it("CHARGE_ISSUED: lifecycle, ownership, 4 checks + 4 private photos (FRONT/PLATE/SIGN/REAR) with retake, then outcome", async () => {
      charge = gps;
      const o = S.officerA;
      unwrap(await o.store.acceptCase(charge.caseId));
      expect(await S.officerB.ops.acceptCase(charge.caseId)).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
      expect(await S.officerB.ops.startInspection(charge.caseId)).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
      unwrap(await o.store.startInspection(charge.caseId));
      expect(await o.store.completeCase(charge.caseId, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "INSPECTION_NOT_READY" } });
      for (const k of ["vehiclePresent", "violationConfirmed", "restrictionVerified"] as const) unwrap(await o.store.setChecklistItem(charge.caseId, k, true));
      unwrap(await o.store.confirmPlateBySimulatedScan(charge.caseId));
      const types = ["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"] as const;
      for (const t of types.slice(0, 3)) unwrap(await o.store.setOfficerPhoto(charge.caseId, t, `file:///${t.toLowerCase()}.png`), t);
      // 3 of 4 photos: still not ready
      expect(await o.store.completeCase(charge.caseId, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "INSPECTION_NOT_READY" } });
      unwrap(await o.store.setOfficerPhoto(charge.caseId, "VEHICLE_REAR", "file:///vehicle_rear.png"));
      const before = unwrap(await o.ops.getCaseDetail(charge.caseId)).officer_evidence!.find((e) => e.evidence_type === "VEHICLE_FRONT")!.storage_path;
      unwrap(await o.store.setOfficerPhoto(charge.caseId, "VEHICLE_FRONT", "file:///retake.png"));
      const det = unwrap(await o.ops.getCaseDetail(charge.caseId));
      expect(det.officer_evidence!.map((e) => e.evidence_type).sort()).toEqual([...types].sort());
      expect(det.officer_evidence!.find((e) => e.evidence_type === "VEHICLE_FRONT")!.storage_path).not.toBe(before);
      for (const e of det.officer_evidence!) {
        const pub = await nodeFetch(`${URL_}/storage/v1/object/public/officer-evidence/${e.storage_path}`);
        expect(pub.status).toBeGreaterThanOrEqual(400);
      }
      expect(unwrap(await o.store.completeCase(charge.caseId, "CHARGE_ISSUED", MARK))).toEqual({ changed: true });
      const done = unwrap(await o.ops.getCaseDetail(charge.caseId));
      expect(done.cases![0]).toMatchObject({ status: "COMPLETED", assigned_officer_id: o.userId });
      expect(done.outcomes).toHaveLength(1);
      expect(done.outcomes![0]).toMatchObject({ code: "CHARGE_ISSUED", parking_charge_amount_cents: 6000 });
      // retry: same answer, nothing duplicated; a different outcome is refused
      expect(unwrap(await o.store.completeCase(charge.caseId, "CHARGE_ISSUED"))).toEqual({ changed: false });
      expect(await o.store.completeCase(charge.caseId, "REPORT_REJECTED")).toMatchObject({ ok: false, error: { code: "ALREADY_COMPLETED" } });
      expect(unwrap(await o.ops.getCaseDetail(charge.caseId)).outcomes).toHaveLength(1);
      expect(unwrap(await S.citizenA.ops.getMyReport(charge.publicNumber)).reports![0].status).toBe("VERIFIED");
      expect(await ledgerOf(S.citizenA, charge.reportUuid)).toEqual(["REWARD_PENDING", "REWARD_RELEASED"]);
      expect(await notifsOf(S.citizenA, charge.reportUuid)).toEqual(["REPORT_UNDER_REVIEW", "REPORT_VERIFIED"]);
      expect((await notifsOf(o, charge.reportUuid)).filter((t) => t === "PARKING_CHARGE_ISSUED")).toHaveLength(1);
      results.charge = { publicNumber: charge.publicNumber, caseId: charge.caseId };
    }, 120_000);

    it("REPORT_REJECTED: report REJECTED, reward voided, one rejection notification", async () => {
      reject = mapped;
      unwrap(await S.officerA.store.acceptCase(reject.caseId));
      unwrap(await S.officerA.store.completeCase(reject.caseId, "REPORT_REJECTED"));
      expect(unwrap(await S.officerA.store.completeCase(reject.caseId, "REPORT_REJECTED"))).toEqual({ changed: false });
      expect(unwrap(await S.citizenA.ops.getMyReport(reject.publicNumber)).reports![0].status).toBe("REJECTED");
      expect(await ledgerOf(S.citizenA, reject.reportUuid)).toEqual(["REWARD_PENDING", "REWARD_VOIDED"]);
      expect(await notifsOf(S.citizenA, reject.reportUuid)).toEqual(["REPORT_REJECTED", "REPORT_UNDER_REVIEW"]);
      results.reject = { publicNumber: reject.publicNumber, caseId: reject.caseId };
    });

    it("VEHICLE_MOVED: case COMPLETED, citizen status unchanged, reward voided, no citizen outcome notification", async () => {
      moved = await submit(S.citizenA, S.officerA, "moved", "GPS");
      unwrap(await S.officerA.store.acceptCase(moved.caseId));
      unwrap(await S.officerA.store.completeCase(moved.caseId, "VEHICLE_MOVED"));
      expect(unwrap(await S.officerA.ops.getCaseDetail(moved.caseId)).cases![0].status).toBe("COMPLETED");
      const rep = unwrap(await S.citizenA.ops.getMyReport(moved.publicNumber)).reports![0];
      expect(rep).toMatchObject({ status: "UNDER_REVIEW", resolved_at: null });
      expect(await ledgerOf(S.citizenA, moved.reportUuid)).toEqual(["REWARD_PENDING", "REWARD_VOIDED"]);
      expect(await notifsOf(S.citizenA, moved.reportUuid)).toEqual(["REPORT_UNDER_REVIEW"]);
      results.moved = { publicNumber: moved.publicNumber, caseId: moved.caseId };
    });
  });

  describe("T8.7 officer monthly statistics", () => {
    it("Officer A's month and today grow by exactly this run's decisions (1 charge, 1 rejected, 1 no-charge)", async () => {
      const after = await statsOf(S.officerA);
      const b = statsBefore.a;
      expect({ completed: after.completed - b.completed, issued: after.issued - b.issued, rejected: after.rejected - b.rejected, noCharge: after.no_charge - b.no_charge }).toEqual({ completed: 3, issued: 1, rejected: 1, noCharge: 1 });
      const dt = dayOf(after);
      const db = dayOf(b);
      expect({ completed: dt.completed - db.completed, issued: dt.issued - db.issued, rejected: dt.rejected - db.rejected, noCharge: dt.no_charge - db.no_charge }).toEqual({ completed: 3, issued: 1, rejected: 1, noCharge: 1 });
      const sum = after.days.reduce((n, x) => n + x.completed, 0);
      expect(sum).toBe(after.completed);
      results.officerAStats = { completed: after.completed, issued: after.issued, rejected: after.rejected, noCharge: after.no_charge, days: after.days.length };
    });

    it("Officer B's statistics do not include Officer A's decisions; citizens get none", async () => {
      const after = await statsOf(S.officerB);
      expect(after.completed).toBe(statsBefore.b.completed);
      const c = await S.citizenA.ops.getOfficerMonthlyStats(monthRangeUtc().from, monthRangeUtc().to, TZ);
      const zero = c.ok && (c.value as unknown as Stats).completed === 0;
      expect(!c.ok || zero).toBe(true);
      results.citizenStats = c.ok ? "zero" : c.error.code;
    });
  });

  describe("T8.7 profile avatars", () => {
    it("upload, set, private signed URL, replace (old object removed), owner-only access, remove", async () => {
      const a = S.citizenA;
      const repo = createAvatarRepository(a.client);
      const first = unwrap(await replaceAvatar(repo, a.userId, `cqa9-${RUN_ID}-1`, buf(JPEG)));
      expect(unwrap(await repo.getMyAvatarPath(a.userId))).toBe(first.path);
      expect(first.url).toMatch(/\/storage\/v1\/object\/sign\/profile-avatars\//);
      expect((await nodeFetch(first.url)).status).toBe(200);
      expect((await nodeFetch(`${URL_}/storage/v1/object/public/${AVATAR_BUCKET}/${first.path}`)).status).toBeGreaterThanOrEqual(400);
      // other users: cannot read, upload into, or point their profile at A's folder
      const b = S.citizenB.client;
      expect((await b.storage.from(AVATAR_BUCKET).createSignedUrl(first.path, 60)).error).toBeTruthy();
      expect((await b.storage.from(AVATAR_BUCKET).upload(avatarPath(a.userId, `cqa9-${RUN_ID}-x`), JPEG, { contentType: "image/jpeg" })).error).toBeTruthy();
      expect((await b.rpc("set_my_avatar", { p_path: first.path })).error).toBeTruthy();
      expect((await S.officerA.client.storage.from(AVATAR_BUCKET).createSignedUrl(first.path, 60)).error).toBeTruthy();
      // column is not directly writable
      await a.client.from("profiles").update({ avatar_storage_path: `${a.userId}/forged.jpg` }).eq("id", a.userId);
      expect(unwrap(await repo.getMyAvatarPath(a.userId))).toBe(first.path);
      // replace: the old object is deleted
      const second = unwrap(await replaceAvatar(repo, a.userId, `cqa9-${RUN_ID}-2`, buf(JPEG)));
      expect(unwrap(await repo.getMyAvatarPath(a.userId))).toBe(second.path);
      expect((await a.client.storage.from(AVATAR_BUCKET).createSignedUrl(first.path, 60)).error).toBeTruthy();
      // signed URL expiry: a short URL stops working; a fresh one works
      const short = await a.client.storage.from(AVATAR_BUCKET).createSignedUrl(second.path, 1);
      await sleep(3500);
      expect((await nodeFetch(short.data!.signedUrl)).status).toBeGreaterThanOrEqual(400);
      expect((await nodeFetch(unwrap(await repo.signedUrl(second.path)))).status).toBe(200);
      // remove: profile cleared (the app falls back to initials), object deleted
      unwrap(await removeAvatar(repo));
      expect(unwrap(await repo.getMyAvatarPath(a.userId))).toBeNull();
      expect((await a.client.storage.from(AVATAR_BUCKET).createSignedUrl(second.path, 60)).error).toBeTruthy();
    }, 60_000);
  });

  describe("T9.0 console access boundary (citizen / officer / anonymous)", () => {
    const calls = (api: AdminApi, caseId: string, n: number) => [
      api.whoami(),
      api.overview(),
      api.pageReports({}, 0),
      api.getReport(n),
      api.pageCases({}, 0),
      api.getCase(caseId),
      api.listOfficers(),
      api.pageRewards({}, 0),
      api.pageAudit({}, 0),
    ];

    it("citizen and officer are refused (FORBIDDEN) by every console function; the refusal triggers an access re-check", async () => {
      for (const k of ["citizenA", "officerA"] as const) {
        const onForbidden = jest.fn();
        const rs = await Promise.all(calls(consoleFor(S[k].client, onForbidden), charge.caseId, charge.publicNumber));
        for (const r of rs) expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
        expect(onForbidden).toHaveBeenCalled();
      }
    });

    it("anonymous callers cannot execute console functions", async () => {
      const rs = await Promise.all(calls(consoleFor(client()), charge.caseId, charge.publicNumber));
      for (const r of rs) expect(r.ok).toBe(false);
      results.anonConsoleErrors = [...new Set(rs.map((r) => (r.ok ? "ok" : r.error.code)))];
    });

    it("internal T9 helpers are not executable by clients", async () => {
      const helpers: [string, Record<string, unknown>][] = [
        ["pw_console_org_ids", {}],
        ["pw_console_jurisdiction_ids", {}],
        ["pw_require_console", {}],
        ["pw_citizen_ref", { p_citizen: S.citizenA.userId }],
        ["pw_report_reward_state", { p_report: charge.reportUuid }],
        ["pw_report_audit", { p_report: charge.reportUuid }],
        ["pw_console_audit_metadata", { p_metadata: { case_id: "x" } }],
      ];
      for (const s of [S.citizenA, S.officerA]) {
        for (const [fn, args] of helpers) {
          const { error } = await s.client.rpc(fn, args);
          expect([fn, !!error]).toEqual([fn, true]);
        }
      }
    });

    it("can_console_read_evidence_object gives citizens and officers no console access", async () => {
      const off = unwrap(await S.officerA.ops.getCaseDetail(charge.caseId)).officer_evidence![0].storage_path;
      for (const s of [S.citizenA, S.citizenB, S.officerA]) {
        const r1 = await s.client.rpc("can_console_read_evidence_object", { p_bucket: "officer-evidence", object_name: off });
        const r2 = await s.client.rpc("can_console_read_evidence_object", { p_bucket: "report-evidence", object_name: charge.evidence[0].storage_path });
        expect([s.key, r1.data ?? false, r2.data ?? false]).toEqual([s.key, false, false]);
      }
      expect(await createEvidenceStorage(S.citizenA.client).sign(EVIDENCE_BUCKETS.officer, [off])).toEqual({});
      expect(await createEvidenceStorage(S.citizenB.client).sign(EVIDENCE_BUCKETS.citizen, [charge.evidence[0].storage_path])).toEqual({});
    });
  });

  (HAS_SUPERVISOR && SUPERVISOR_INACTIVE ? describe : describe.skip)("T9.0 console: deactivated supervisor membership (revocation)", () => {
    it("every console call is FORBIDDEN, triggers an access re-check, and the session stays valid", async () => {
      const c = client();
      const { data, error } = await c.auth.signInWithPassword({ email: SUPERVISOR.email!, password: SUPERVISOR.password! });
      if (error || !data.user) throw new Error(`Sign-in failed for the supervisor: ${error?.message ?? "no session"}`);
      const onForbidden = jest.fn();
      const api = consoleFor(c, onForbidden);
      const rs = await Promise.all([api.whoami(), api.overview(), api.pageReports({}, 0), api.listOfficers(), api.pageAudit({}, 0), api.getCase(charge.caseId), api.getReport(charge.publicNumber)]);
      for (const r of rs) expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(onForbidden).toHaveBeenCalled();
      expect((await c.auth.getUser()).data.user?.id).toBe(data.user.id);
      const off = unwrap(await S.officerA.ops.getCaseDetail(charge.caseId)).officer_evidence![0].storage_path;
      expect(await createEvidenceStorage(c).sign(EVIDENCE_BUCKETS.officer, [off])).toEqual({});
      results.supervisorRevocation = "FORBIDDEN, session valid";
    });
  });

  (HAS_SUPERVISOR && !SUPERVISOR_INACTIVE ? describe : describe.skip)("T9.0 operations console as the development supervisor", () => {
    let sup: { client: SupabaseClient; userId: string; api: AdminApi };

    beforeAll(async () => {
      const c = client();
      const { data, error } = await c.auth.signInWithPassword({ email: SUPERVISOR.email!, password: SUPERVISOR.password! });
      if (error || !data.user) throw new Error(`Sign-in failed for the supervisor: ${error?.message ?? "no session"}`);
      sup = { client: c, userId: data.user.id, api: consoleFor(c) };
    });

    it("whoami: server role SUPERVISOR/ADMIN with at least one active console organization", async () => {
      const me = unwrap(await sup.api.whoami());
      expect(["SUPERVISOR", "ADMIN"]).toContain(me.role);
      expect(me.organizations.length).toBeGreaterThan(0);
      const { data } = await sup.client.from("profiles").select("role").eq("id", sup.userId).single();
      expect(data?.role).toBe(me.role);
      results.supervisor = { role: me.role, organizations: me.organizations.map((o) => ({ name: o.name, memberRole: o.memberRole })) };
    });

    it("overview: counts include this run; no revenue/collected metric", async () => {
      const ov = unwrap(await sup.api.overview());
      expect(ov.completedToday).toBeGreaterThanOrEqual(3);
      expect(ov.chargesToday).toBeGreaterThanOrEqual(1);
      expect(ov.rejectedToday).toBeGreaterThanOrEqual(1);
      expect(ov.noChargeToday).toBeGreaterThanOrEqual(1);
      expect(Object.keys(ov).filter((k) => /revenue|collected|paid/i.test(k))).toEqual([]);
      expect(ov.rewardsAvailableCents).toBe(ov.rewardsAvailableCount * 500);
      expect(ov.rewardsPendingCents).toBe(ov.rewardsPendingCount * 500);
      results.overview = ov;
    });

    it("reports: search, status filter and paging without duplicates", async () => {
      const found = unwrap(await sup.api.pageReports({ search: String(charge.publicNumber) }, 0));
      expect(found.rows.map((r) => r.publicNumber)).toContain(charge.publicNumber);
      const verified = unwrap(await sup.api.pageReports({ status: "VERIFIED" }, 0));
      expect(verified.rows.every((r) => r.status === "VERIFIED")).toBe(true);
      expect(verified.rows.length).toBeGreaterThan(0);
      const p1 = unwrap(await sup.api.pageReports({}, 0));
      const ids = p1.rows.map((r) => r.id);
      if (p1.nextOffset != null) {
        const p2 = unwrap(await sup.api.pageReports({}, p1.nextOffset));
        ids.push(...p2.rows.map((r) => r.id));
      }
      expect(new Set(ids).size).toBe(ids.length);
      results.reportsTotal = p1.total;
    });

    it("report detail: GPS provenance, signed citizen evidence, reward AVAILABLE once, OUTCOME_RECORDED with €60 charge", async () => {
      const r = unwrap(await sup.api.getReport(charge.publicNumber))!;
      expect(r).toBeTruthy();
      expect(r).toMatchObject({ status: "VERIFIED", locationSource: "GPS", rewardState: "AVAILABLE" });
      expect(r.ledger.map((l) => l.entryType).sort()).toEqual(["REWARD_PENDING", "REWARD_RELEASED"]);
      expect(r.evidence.length).toBe(3);
      expect(r.evidence[0].uri).toMatch(/\/storage\/v1\/object\/sign\/report-evidence\//);
      expect((await nodeFetch(r.evidence[0].uri)).status).toBe(200);
      expect(r.citizenRef).toMatch(/^C-/);
      const out = r.audit.filter((a) => a.eventType === "OUTCOME_RECORDED");
      expect(out).toHaveLength(1);
      expect(out[0].metadata).toMatchObject({ charge_cents: 6000 });
      const map = unwrap(await sup.api.getReport(mapped.publicNumber))!;
      expect(map).toMatchObject({ locationSource: "MAP_SELECTED", status: "REJECTED", rewardState: "VOIDED" });
      expect(map.accuracyMeters).toBeUndefined();
    });

    it("case detail: 4 officer photos (signed), 4 checks, outcome; €60 only for CHARGE_ISSUED", async () => {
      const c = unwrap(await sup.api.getCase(charge.caseId))!;
      expect(c).toMatchObject({ status: "COMPLETED", outcome: { code: "CHARGE_ISSUED", parkingChargeCents: 6000 } });
      expect(c.officerEvidence).toHaveLength(4);
      for (const e of c.officerEvidence) expect((await nodeFetch(e.uri)).status).toBe(200);
      expect((await nodeFetch(c.citizenEvidence[0].uri)).status).toBe(200);
      expect(c.inspection!.checks.filter((x) => x.answer === true)).toHaveLength(4);
      for (const k of ["assignedAt", "enRouteAt", "inspectionStartedAt", "completedAt"] as const) expect(c.timeline[k]).toBeTruthy();
      results.chargeTimeline = Object.fromEntries(Object.entries(c.timeline).map(([k, v]) => [k, !!v]));
      for (const x of [reject, moved]) {
        const o = unwrap(await sup.api.getCase(x.caseId))!;
        expect(o.outcome?.code).toBe(x === reject ? "REPORT_REJECTED" : "VEHICLE_MOVED");
        expect(o.outcome?.parkingChargeCents).toBeUndefined();
      }
    });

    it("cases list: status and outcome filters", async () => {
      const issued = unwrap(await sup.api.pageCases({ outcome: "CHARGE_ISSUED", search: String(charge.publicNumber) }, 0));
      expect(issued.rows.map((r) => r.id)).toContain(charge.caseId);
      const completed = unwrap(await sup.api.pageCases({ status: "COMPLETED" }, 0));
      expect(completed.rows.every((r) => r.status === "COMPLETED")).toBe(true);
      const none = unwrap(await sup.api.pageCases({ outcome: "CHARGE_ISSUED", search: String(moved.publicNumber) }, 0));
      expect(none.rows).toEqual([]);
    });

    it("officers: Officer A listed as an active member of the console's organizations; no location data", async () => {
      const me = unwrap(await sup.api.whoami());
      const list = unwrap(await sup.api.listOfficers());
      const a = list.find((o) => o.userId === S.officerA.userId);
      expect(a).toMatchObject({ active: true, memberRole: "OFFICER" });
      expect(a!.completedThisMonth).toBeGreaterThanOrEqual(3);
      const names = me.organizations.map((o) => o.name);
      expect(list.every((o) => names.includes(o.organizationName))).toBe(true);
      expect(list.flatMap((o) => Object.keys(o)).filter((k) => /lat|lng|lon|location/i.test(k))).toEqual([]);
      results.officers = list.map((o) => ({ memberRole: o.memberRole, active: o.active, activeCases: o.activeCases, completedThisMonth: o.completedThisMonth }));
    });

    it("rewards: one reward state per report; voided not payable; totals = count × €5", async () => {
      const page = unwrap(await sup.api.pageRewards({ search: String(charge.publicNumber) }, 0));
      expect(page.rows.length).toBe(2);
      expect(page.rows.every((r) => r.rewardState === "AVAILABLE")).toBe(true);
      const all = unwrap(await sup.api.pageRewards({}, 0));
      expect(all.summary.availableCents).toBe(all.summary.availableCount * 500);
      expect(all.summary.pendingCents).toBe(all.summary.pendingCount * 500);
      const voided = unwrap(await sup.api.pageRewards({ search: String(moved.publicNumber) }, 0));
      expect(voided.rows.every((r) => r.rewardState === "VOIDED")).toBe(true);
      results.rewardSummary = all.summary;
    });

    it("audit: Outcome filter finds this run's outcomes; raw server metadata is allow-listed (no case_id)", async () => {
      for (const x of [charge, reject, moved]) {
        const p = unwrap(await sup.api.pageAudit({ entityType: "outcome", ref: String(x.publicNumber) }, 0));
        expect(p.rows.filter((a) => a.eventType === "OUTCOME_RECORDED")).toHaveLength(1);
      }
      const { data, error } = await sup.client.rpc("admin_page_audit", {
        p_actor_role: null, p_entity_type: null, p_event_type: null, p_ref: null, p_from: null, p_to: null, p_offset: 0, p_limit: 100,
      });
      expect(error).toBeNull();
      const rows = (data as { rows: { metadata: Record<string, unknown> }[] }).rows;
      expect(rows.length).toBeGreaterThan(0);
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r.metadata ?? {})))];
      expect(keys.filter((k) => !AUDIT_KEYS.includes(k))).toEqual([]);
      expect(JSON.stringify(rows)).not.toMatch(/case_id|storage_path|signedUrl|token/i);
      results.auditMetadataKeys = keys;
    });

    it("unknown report number / case id look missing", async () => {
      expect(unwrap(await sup.api.getReport(999_999_999))).toBeNull();
      expect(unwrap(await sup.api.getCase("00000000-0000-4000-8000-000000000000"))).toBeNull();
      expect(unwrap(await sup.api.pageCases({ officerId: "00000000-0000-4000-8000-000000000000" }, 0)).rows).toEqual([]);
    });
  });

  if (!HAS_SUPERVISOR) {
    it("console as supervisor: NOT RUN (CLOUDQA_SUPERVISOR_EMAIL / _PASSWORD not configured)", () => {
      results.supervisor = "NOT RUN";
    });
  }
});

if (!RUN) {
  it("real-cloud T8.7/T9 QA is opt-in (set PARKWATCH_RUN_CLOUD_QA=1)", () => {
    expect(RUN).toBe(false);
  });
}
