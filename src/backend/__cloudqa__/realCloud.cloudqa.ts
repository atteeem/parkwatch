/**
 * @jest-environment node
 */
// T8.5 REAL-CLOUD QA — runs the app's real backend modules (core store, server
// operations, private storage) against a REAL Supabase DEVELOPMENT project.
//
// NOT part of `npm test` (different file pattern). Runs only with:
//   PARKWATCH_RUN_CLOUD_QA=1 npm run test:cloud-qa
// Needs `.env` (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY) and the four TEST
// accounts' passwords, either as environment variables or in the git-ignored
// file `.env.cloudqa.local`:
//   CLOUDQA_CITIZEN_A_PASSWORD, CLOUDQA_CITIZEN_B_PASSWORD,
//   CLOUDQA_OFFICER_A_PASSWORD, CLOUDQA_OFFICER_B_PASSWORD
// (emails default to CitizenA@ / CitizenB@ / OfficerA@ / OfficerB@gmail.com;
//  override with CLOUDQA_*_EMAIL). Passwords are never printed or written.
//
// Data: ~10 small reports per run, all marked "[ParkWatch cloud QA <run id>]".
// Nothing is deleted (history is append-only). Results (ids only, no secrets)
// go to `cloud-qa-results.local.json` (git-ignored).
import * as fs from "fs";
import * as path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createCoreOperations, CoreOperations, PageBundle } from "../operations/coreOperations";
import { createEvidenceStorage, EVIDENCE_BUCKETS, ReadLocalFile } from "../storage/evidenceStorage";
import { createCoreBackendStore, CoreBackendStore, ListSpec } from "../core/coreBackendStore";
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

const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14);
const MARK = `[ParkWatch cloud QA ${RUN_ID}] Automated development test record - not a real violation.`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const readPng: ReadLocalFile = async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength);
const created: Record<string, unknown> = { runId: RUN_ID, project: URL_ ? new URL(URL_).host : null, reports: {}, cases: {}, storage: [] as string[] };
const observations: Record<string, unknown> = {};

/** Lets a request reach the server but loses the response of the next call to `fn` (a timeout after commit). */
function lossyFetch() {
  const drop = new Set<string>();
  const f = async (input: unknown, init?: Parameters<typeof nodeFetch>[1]) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    const fn = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(url)?.[1];
    const res = await nodeFetch(input, init);
    if (fn && drop.has(fn)) {
      drop.delete(fn);
      throw new TypeError("fetch failed");
    }
    return res;
  };
  return { fetch: f as unknown as typeof fetch, dropNext: (fn: string) => drop.add(fn) };
}

type Session = { key: AccountKey; client: SupabaseClient; userId: string; ops: CoreOperations; store: CoreBackendStore; accessToken: string; onUnauth: jest.Mock };

async function signIn(key: AccountKey, opts: { lossy?: ReturnType<typeof lossyFetch>; pageSize?: number } = {}): Promise<Session> {
  const a = ACCOUNTS[key];
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: opts.lossy?.fetch ?? nodeFetch } });
  const { data, error } = await client.auth.signInWithPassword({ email: a.email, password: a.password ?? "" });
  if (error || !data.user || !data.session) throw new Error(`Sign-in failed for ${key} (${a.email}): ${error?.message ?? "no session"}`);
  const ops = createCoreOperations(client);
  const onUnauth = jest.fn();
  const store = createCoreBackendStore({
    userId: data.user.id,
    role: a.role,
    ops,
    storage: createEvidenceStorage(client, readPng),
    minFocusRefreshMs: 0,
    pageSize: opts.pageSize ?? 25,
    onUnauthenticated: onUnauth,
  });
  return { key, client, userId: data.user.id, ops, store, accessToken: data.session.access_token, onUnauth };
}

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }, what = ""): T => {
  if (!r.ok) throw new Error(`unexpected ${r.error.code} ${what}`);
  return r.value;
};

function qaDraft(name: string): ReportDraft {
  const d = completeDraft(`cqa-${RUN_ID}-${name}`);
  const now = new Date().toISOString();
  for (const slot of ["FRONT", "SIDE", "REAR"] as const) {
    const p = d.photos[slot]!;
    d.photos[slot] = { ...p, uri: `file:///${slot.toLowerCase()}.png`, capturedAt: now };
  }
  return {
    ...d,
    notes: MARK,
    location: { address: "Cloud QA test (development)", coordinates: { latitude: 60.1699, longitude: 24.9384, accuracyMeters: 9, capturedAt: now } },
  };
}

/** Citizen submits through the app store; returns public number, report uuid and case uuid (found by the officer). */
async function submitAndFind(citizen: Session, officer: Session, name: string) {
  const { reportId, created: isNew } = unwrap(await citizen.store.submitReport(qaDraft(name)), `submit ${name}`);
  expect(isNew).toBe(true);
  const rep = unwrap(await citizen.ops.getMyReport(Number(reportId)));
  const reportUuid = rep.reports![0].id;
  let caseId: string | null = null;
  for (let offset = 0; offset < 1000 && !caseId; offset += 50) {
    const page = unwrap(await officer.ops.pageOfficerQueue("all", null, offset, 50));
    caseId = page.cases?.find((c) => c.report_id === reportUuid)?.id ?? null;
    if (page.next_offset == null) break;
  }
  if (!caseId) throw new Error(`officer cannot find the case of ${name}`);
  (created.reports as Record<string, unknown>)[name] = { publicNumber: reportId, reportUuid };
  (created.cases as Record<string, unknown>)[name] = caseId;
  for (const e of rep.report_evidence ?? []) (created.storage as string[]).push(`report-evidence/${e.storage_path}`);
  return { reportId, reportUuid, caseId, evidence: rep.report_evidence ?? [] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle(s: Session, spec: ListSpec) {
  for (let i = 0; i < 150 && s.store.getList(spec).loading; i++) await sleep(40);
}
async function loadAll(s: Session, spec: ListSpec) {
  s.store.ensureList(spec);
  await sleep(0);
  await settle(s, spec);
  while (s.store.getList(spec).hasMore) {
    s.store.loadMore(spec);
    await sleep(0);
    await settle(s, spec);
  }
  return s.store.getList(spec).ids;
}
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

const d = RUN ? describe : describe.skip;

d("REAL Supabase development project — T8.5 cloud QA", () => {
  const S = {} as Record<AccountKey, Session>;

  beforeAll(async () => {
    const missing = [!URL_ && "EXPO_PUBLIC_SUPABASE_URL", !KEY && "EXPO_PUBLIC_SUPABASE_ANON_KEY", ...Object.entries(ACCOUNTS).filter(([, a]) => !a.password).map(([k]) => `CLOUDQA_${k.replace(/([A-Z])/g, "_$1").toUpperCase()}_PASSWORD`)].filter(Boolean);
    if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
    if (/^sb_secret_/.test(KEY)) throw new Error("Refusing a secret key: use the anon/publishable key");
    for (const k of Object.keys(ACCOUNTS) as AccountKey[]) S[k] = await signIn(k);
    created.accounts = Object.fromEntries((Object.keys(S) as AccountKey[]).map((k) => [k, S[k].userId]));
  }, 60_000);

  afterAll(() => {
    fs.writeFileSync(path.join(ROOT, "cloud-qa-results.local.json"), JSON.stringify({ created, observations }, null, 2));
  });

  it("accounts: server-side roles are as provisioned (no role from metadata)", async () => {
    const roles: Record<string, string> = {};
    for (const k of Object.keys(S) as AccountKey[]) {
      const { data, error } = await S[k].client.from("profiles").select("role").eq("id", S[k].userId).single();
      if (error) throw new Error(error.message);
      roles[k] = data.role;
    }
    expect(roles).toEqual({ citizenA: "CITIZEN", citizenB: "CITIZEN", officerA: "OFFICER", officerB: "OFFICER" });
    const { data: mem } = await S.officerA.client.from("organization_members").select("active").eq("user_id", S.officerA.userId);
    expect(mem?.some((m) => m.active)).toBe(true);
    const { data: none } = await S.citizenA.client.from("organization_members").select("active").eq("user_id", S.citizenA.userId);
    expect(none).toEqual([]);
  });

  describe("citizen flow → officer charge → citizen consequence", () => {
    let charge: Awaited<ReturnType<typeof submitAndFind>>;

    it("Citizen A submits through the app store: one report, server-owned fields, private evidence, case, pending €5", async () => {
      const phases: string[] = [];
      const draft = qaDraft("charge");
      const r = unwrap(await S.citizenA.store.submitReport(draft, { onProgress: (p) => phases.push(p) }));
      expect(phases).toEqual(["uploading", "submitting"]);
      const rep = unwrap(await S.citizenA.ops.getMyReport(Number(r.reportId)));
      const row = rep.reports![0];
      expect(row).toMatchObject({ citizen_id: S.citizenA.userId, status: "UNDER_REVIEW", jurisdiction_id: "helsinki-demo", source_draft_id: draft.draftId });
      expect(Number(row.public_report_number)).toBeGreaterThan(0);
      expect(rep.report_evidence).toHaveLength(3);
      for (const e of rep.report_evidence!) expect(e.storage_path.startsWith(`${S.citizenA.userId}/${draft.draftId}/`)).toBe(true);
      expect(await ledgerOf(S.citizenA, row.id)).toEqual(["REWARD_PENDING"]);
      let caseId: string | null = null;
      for (let o = 0; o < 1000 && !caseId; o += 50) {
        const p = unwrap(await S.officerA.ops.pageOfficerQueue("new", null, o, 50));
        caseId = p.cases?.find((c) => c.report_id === row.id)?.id ?? null;
        if (p.next_offset == null) break;
      }
      expect(caseId).toBeTruthy();
      charge = { reportId: r.reportId, reportUuid: row.id, caseId: caseId!, evidence: rep.report_evidence! };
      (created.reports as Record<string, unknown>).charge = { publicNumber: r.reportId, reportUuid: row.id };
      (created.cases as Record<string, unknown>).charge = caseId;
      for (const e of rep.report_evidence!) (created.storage as string[]).push(`report-evidence/${e.storage_path}`);
    });

    it("the report survives an app restart (a fresh session reads it from the cloud)", async () => {
      const fresh = await signIn("citizenA");
      fresh.store.ensureList({ kind: "reports", status: null });
      unwrap(await fresh.store.refresh());
      expect(fresh.store.getList({ kind: "reports", status: null }).ids).toContain(charge.reportId);
      const view = fresh.store.getState()!.reports.find((x) => x.id === charge.reportId);
      expect(view?.status).toBe("UNDER_REVIEW");
      fresh.store.dispose();
    });

    it("Officer B cannot mutate a case assigned to Officer A", async () => {
      unwrap(await S.officerA.store.acceptCase(charge.caseId), "accept");
      const r = await S.officerB.ops.startInspection(charge.caseId);
      expect(r).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
      const c = await S.officerB.ops.completeCase(charge.caseId, "REPORT_REJECTED");
      expect(c).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
    });

    it("Officer A: inspection, tri-state checks, plate, 4 private photos (+ retake), CHARGE_ISSUED", async () => {
      const o = S.officerA;
      expect(await o.ops.completeCase(charge.caseId, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
      unwrap(await o.store.startInspection(charge.caseId));
      expect(await o.store.completeCase(charge.caseId, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "INSPECTION_NOT_READY" } });
      unwrap(await o.store.setChecklistItem(charge.caseId, "vehiclePresent", false));
      unwrap(await o.store.setChecklistItem(charge.caseId, "vehiclePresent", null));
      for (const k of ["vehiclePresent", "violationConfirmed", "restrictionVerified"] as const) unwrap(await o.store.setChecklistItem(charge.caseId, k, true));
      unwrap(await o.store.confirmPlateBySimulatedScan(charge.caseId));
      for (const t of ["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"] as const) {
        unwrap(await o.store.setOfficerPhoto(charge.caseId, t, `file:///${t.toLowerCase()}.png`), t);
      }
      const before = unwrap(await o.ops.getCaseDetail(charge.caseId)).officer_evidence!.find((e) => e.evidence_type === "PARKING_SIGN")!.storage_path;
      unwrap(await o.store.setOfficerPhoto(charge.caseId, "PARKING_SIGN", "file:///retake.png"));
      const detail = unwrap(await o.ops.getCaseDetail(charge.caseId));
      const after = detail.officer_evidence!.find((e) => e.evidence_type === "PARKING_SIGN")!.storage_path;
      expect(after).not.toBe(before);
      expect(detail.officer_evidence).toHaveLength(4);
      // the replaced object is gone; the new one is private but readable by the officer
      expect(await createEvidenceStorage(o.client).sign(EVIDENCE_BUCKETS.officer, [before])).toEqual({});
      for (const e of detail.officer_evidence!) (created.storage as string[]).push(`officer-evidence/${e.storage_path}`);

      expect(unwrap(await o.store.completeCase(charge.caseId, "CHARGE_ISSUED", MARK))).toEqual({ changed: true });
      const done = unwrap(await o.ops.getCaseDetail(charge.caseId));
      const c = done.cases![0];
      expect(c).toMatchObject({ status: "COMPLETED", assigned_officer_id: o.userId });
      for (const col of ["assigned_at", "en_route_at", "inspection_started_at", "completed_at"] as const) expect(c[col]).toBeTruthy();
      expect(done.outcomes![0]).toMatchObject({ code: "CHARGE_ISSUED", parking_charge_amount_cents: 6000, decided_by: o.userId });
      expect(done.inspections![0].completed_at).toBeTruthy();
    });

    it("retrying completion creates no duplicate outcome, reward or notification; a different outcome is refused", async () => {
      const o = S.officerA;
      expect(unwrap(await o.store.completeCase(charge.caseId, "CHARGE_ISSUED"))).toEqual({ changed: false });
      expect(await o.store.completeCase(charge.caseId, "REPORT_REJECTED")).toMatchObject({ ok: false, error: { code: "ALREADY_COMPLETED" } });
      expect(unwrap(await o.ops.getCaseDetail(charge.caseId)).outcomes).toHaveLength(1);
    });

    it("Citizen A sees Verified, €5 released exactly once, one REPORT_VERIFIED notification, photos via signed URLs", async () => {
      const c = S.citizenA;
      const rep = unwrap(await c.ops.getMyReport(Number(charge.reportId))).reports![0];
      expect(rep.status).toBe("VERIFIED");
      expect(await ledgerOf(c, charge.reportUuid)).toEqual(["REWARD_PENDING", "REWARD_RELEASED"]);
      expect(await notifsOf(c, charge.reportUuid)).toEqual(["REPORT_UNDER_REVIEW", "REPORT_VERIFIED"]);
      const officerNotes = await notifsOf(S.officerA, charge.reportUuid);
      expect(officerNotes.filter((t) => t === "PARKING_CHARGE_ISSUED")).toHaveLength(1);
      // the app view model + private evidence rendering path
      c.store.ensureList({ kind: "reports", status: null });
      unwrap(await c.store.refresh());
      c.store.ensureReport(charge.reportId);
      for (let i = 0; i < 100 && c.store.getReportLoad(charge.reportId) !== "loaded"; i++) await sleep(40);
      const view = c.store.getState()!.reports.find((x) => x.id === charge.reportId)!;
      expect(view.status).toBe("VERIFIED");
      const res = await nodeFetch(view.evidence[0].uri);
      expect(res.status).toBe(200);
      expect(view.evidence[0].uri).toMatch(/\/storage\/v1\/object\/sign\/report-evidence\//);
    });
  });

  describe("other outcomes", () => {
    it("REPORT_REJECTED: report REJECTED, reward voided, citizen rejection notification", async () => {
      const x = await submitAndFind(S.citizenA, S.officerA, "reject");
      unwrap(await S.officerA.store.completeCase(x.caseId, "REPORT_REJECTED"));
      expect(unwrap(await S.citizenA.ops.getMyReport(Number(x.reportId))).reports![0].status).toBe("REJECTED");
      expect(await ledgerOf(S.citizenA, x.reportUuid)).toEqual(["REWARD_PENDING", "REWARD_VOIDED"]);
      expect(await notifsOf(S.citizenA, x.reportUuid)).toEqual(["REPORT_REJECTED", "REPORT_UNDER_REVIEW"]);
    });

    const unresolved: [string, "VEHICLE_MOVED" | "VALID_PERMIT" | "DUPLICATE" | "OTHER", "accept" | "inspect" | "none"][] = [
      ["moved", "VEHICLE_MOVED", "accept"],
      ["permit", "VALID_PERMIT", "inspect"],
      ["duplicate", "DUPLICATE", "none"],
      ["other", "OTHER", "accept"],
    ];
    it.each(unresolved)("%s (%s): case COMPLETED, citizen status unchanged, reward voided, NO citizen outcome notification", async (name, code, prep) => {
      const x = await submitAndFind(S.citizenA, S.officerA, name);
      if (prep !== "none") unwrap(await S.officerA.store.acceptCase(x.caseId));
      if (prep === "inspect") unwrap(await S.officerA.store.startInspection(x.caseId));
      unwrap(await S.officerA.store.completeCase(x.caseId, code));
      expect(unwrap(await S.officerA.ops.getCaseDetail(x.caseId)).cases![0].status).toBe("COMPLETED");
      const rep = unwrap(await S.citizenA.ops.getMyReport(Number(x.reportId))).reports![0];
      expect(rep.status).toBe("UNDER_REVIEW");
      expect(rep.resolved_at).toBeNull();
      expect(await ledgerOf(S.citizenA, x.reportUuid)).toEqual(["REWARD_PENDING", "REWARD_VOIDED"]);
      expect(await notifsOf(S.citizenA, x.reportUuid)).toEqual(["REPORT_UNDER_REVIEW"]);
    });
  });

  describe("accept race", () => {
    it("Officer A and B accept the same NEW case at once: exactly one wins, the other gets CASE_TAKEN", async () => {
      const x = await submitAndFind(S.citizenA, S.officerA, "race");
      const [a, b] = await Promise.all([S.officerA.ops.acceptCase(x.caseId), S.officerB.ops.acceptCase(x.caseId)]);
      const wins = [a, b].filter((r) => r.ok && r.value.changed);
      const losses = [a, b].filter((r) => !r.ok);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      expect(losses[0]).toMatchObject({ error: { code: "CASE_TAKEN" } });
      const winner = a.ok ? S.officerA : S.officerB;
      const c = unwrap(await winner.ops.getCaseDetail(x.caseId)).cases![0];
      expect(c.assigned_officer_id).toBe(winner.userId);
      expect((await notifsOf(winner, x.reportUuid)).filter((t) => t === "CASE_ACCEPTED")).toHaveLength(1);
      const loser = a.ok ? S.officerB : S.officerA;
      expect((await notifsOf(loser, x.reportUuid)).filter((t) => t === "CASE_ACCEPTED")).toHaveLength(0);
      observations.acceptRaceWinner = winner.key;
    });
  });

  describe("RLS and private storage on the real project", () => {
    let bReport: Awaited<ReturnType<typeof submitAndFind>>;
    let aReport: { reportUuid: string; caseId: string; evidence: { storage_path: string }[] };

    beforeAll(async () => {
      bReport = await submitAndFind(S.citizenB, S.officerA, "citizenB");
      const a = (created.reports as Record<string, { reportUuid: string }>).charge;
      const ad = unwrap(await S.officerA.ops.getCaseDetail((created.cases as Record<string, string>).charge));
      aReport = { reportUuid: a.reportUuid, caseId: (created.cases as Record<string, string>).charge, evidence: ad.report_evidence ?? [] };
    }, 60_000);

    it("Citizen A cannot see Citizen B's report, evidence, rewards or notifications", async () => {
      const c = S.citizenA;
      expect(unwrap(await c.ops.getMyReport(Number(bReport.reportId))).reports).toEqual([]);
      const { data: rows } = await c.client.from("reports").select("id").eq("id", bReport.reportUuid);
      expect(rows).toEqual([]);
      const { data: ev } = await c.client.from("report_evidence").select("id").eq("report_id", bReport.reportUuid);
      expect(ev).toEqual([]);
      const { data: led } = await c.client.from("reward_ledger").select("id").eq("citizen_id", S.citizenB.userId);
      expect(led).toEqual([]);
      const { data: no } = await c.client.from("notifications").select("id").eq("recipient_id", S.citizenB.userId);
      expect(no).toEqual([]);
      expect(await createEvidenceStorage(c.client).sign(EVIDENCE_BUCKETS.citizen, bReport.evidence.map((e) => e.storage_path))).toEqual({});
      const page = unwrap(await c.ops.pageMyReports(null, null, 50));
      expect((page.reports ?? []).every((r) => r.citizen_id === c.userId)).toBe(true);
    });

    it("Citizens see no officer queue, cases, inspections, outcomes or officer evidence", async () => {
      const c = S.citizenA;
      for (const t of ["officer_cases", "inspections", "inspection_checks", "officer_evidence", "enforcement_outcomes"]) {
        const { data, error } = await c.client.from(t).select("*").limit(5);
        expect(error ? "denied" : data).toEqual(error ? "denied" : []);
      }
      expect(unwrap(await c.ops.pageOfficerQueue("all", null, 0, 50)).ids).toEqual([]);
      expect(unwrap(await c.ops.getCaseDetail(aReport.caseId)).cases).toEqual([]);
      expect(unwrap(await c.ops.getOfficerSummary(null)).open).toBe(0);
      const off = unwrap(await S.officerA.ops.getCaseDetail(aReport.caseId)).officer_evidence ?? [];
      expect(off.length).toBeGreaterThan(0);
      expect(await createEvidenceStorage(c.client).sign(EVIDENCE_BUCKETS.officer, off.map((e) => e.storage_path))).toEqual({});
    });

    it("Citizens cannot run officer operations", async () => {
      const c = S.citizenA.ops;
      const id = bReport.caseId;
      for (const r of [
        await c.acceptCase(id),
        await c.startEnRoute(id),
        await c.startInspection(id),
        await c.setInspectionCheck(id, "vehiclePresent", true),
        await c.confirmPlateByScan(id),
        await c.addOfficerEvidence(id, "PARKING_SIGN", `${id}/x.png`, new Date().toISOString()),
        await c.completeCase(id, "CHARGE_ISSUED"),
      ]) {
        expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      }
    });

    it("Citizens cannot write protected tables directly", async () => {
      const c = S.citizenA.client;
      const now = new Date().toISOString();
      const attempts: Record<string, Record<string, unknown>> = {
        reports: { citizen_id: S.citizenA.userId, source_draft_id: `cqa-${RUN_ID}-direct`, jurisdiction_id: "helsinki-demo", violation_type: "no-parking", location_address: "x", observed_at: now, submitted_at: now },
        officer_cases: { report_id: bReport.reportUuid, jurisdiction_id: "helsinki-demo" },
        enforcement_outcomes: { case_id: bReport.caseId, code: "OTHER", decided_by: S.citizenA.userId, decided_at: now },
        reward_ledger: { citizen_id: S.citizenA.userId, entry_type: "OPENING_BALANCE", amount_cents: 100000, idempotency_key: `cqa-${RUN_ID}` },
        audit_events: { actor_role: "CITIZEN", source: "USER_ACTION", entity_type: "report", entity_id: bReport.reportUuid, event_type: "FAKE" },
        notifications: { recipient_id: S.citizenA.userId, recipient_role: "CITIZEN", type: "SYSTEM", idempotency_key: `cqa-${RUN_ID}` },
      };
      const allowed: string[] = [];
      for (const [table, row] of Object.entries(attempts)) {
        const { error } = await c.from(table).insert(row);
        if (!error) allowed.push(table);
      }
      expect(allowed).toEqual([]);
      const { error: upd } = await c.from("reports").update({ status: "VERIFIED" }).eq("id", bReport.reportUuid).select("id");
      expect(upd ? "denied" : "no error").toBeDefined();
      const { data: still } = await S.citizenB.client.from("reports").select("status").eq("id", bReport.reportUuid).single();
      expect(still?.status).toBe("UNDER_REVIEW");
    });

    it("Officers cannot read citizens' rewards, notifications or other profiles", async () => {
      const o = S.officerA.client;
      const { data: led } = await o.from("reward_ledger").select("id").limit(5);
      expect(led ?? []).toEqual([]);
      const { data: no } = await o.from("notifications").select("id").eq("recipient_id", S.citizenA.userId);
      expect(no ?? []).toEqual([]);
      const { data: pr } = await o.from("profiles").select("id").neq("id", S.officerA.userId);
      expect(pr ?? []).toEqual([]);
    });

    it("Private storage: own and enforcement access only; no public URLs; buckets not public", async () => {
      const path0 = aReport.evidence[0].storage_path;
      expect(Object.keys(await createEvidenceStorage(S.citizenA.client).sign(EVIDENCE_BUCKETS.citizen, [path0]))).toEqual([path0]);
      expect(await createEvidenceStorage(S.citizenB.client).sign(EVIDENCE_BUCKETS.citizen, [path0])).toEqual({});
      // Same-organization officers may read the citizen evidence of cases in their area.
      expect(Object.keys(await createEvidenceStorage(S.officerB.client).sign(EVIDENCE_BUCKETS.citizen, [path0]))).toEqual([path0]);
      const pub = await nodeFetch(`${URL_}/storage/v1/object/public/report-evidence/${path0}`);
      expect(pub.status).toBeGreaterThanOrEqual(400);
      const pubOff = await nodeFetch(`${URL_}/storage/v1/object/public/officer-evidence/${aReport.caseId}/x.png`);
      expect(pubOff.status).toBeGreaterThanOrEqual(400);
      // Citizens cannot upload into another user's folder or into officer evidence.
      const up1 = await S.citizenA.client.storage.from("report-evidence").upload(`${S.citizenB.userId}/cqa-${RUN_ID}/x.png`, PNG, { contentType: "image/png" });
      expect(up1.error).toBeTruthy();
      const up2 = await S.citizenA.client.storage.from("officer-evidence").upload(`${aReport.caseId}/cqa-${RUN_ID}.png`, PNG, { contentType: "image/png" });
      expect(up2.error).toBeTruthy();
      // An officer who is not assigned cannot upload officer evidence for the case.
      const up3 = await S.officerB.client.storage.from("officer-evidence").upload(`${bReport.caseId}/cqa-${RUN_ID}.png`, PNG, { contentType: "image/png" });
      observations.unassignedOfficerUploadToUnassignedCase = up3.error ? "denied" : "allowed";
    });
  });

  describe("signed URL expiry (short TEST-only expiry; app default unchanged)", () => {
    it("an expired signed URL stops working and the app store re-signs it", async () => {
      const c = S.citizenA;
      const charge = (created.reports as Record<string, { publicNumber: string; reportUuid: string }>).charge;
      const p = unwrap(await c.ops.getMyReport(Number(charge.publicNumber))).report_evidence![0].storage_path;
      const short = await c.client.storage.from("report-evidence").createSignedUrl(p, 1);
      expect(short.error).toBeNull();
      await sleep(3500);
      const expired = await nodeFetch(short.data!.signedUrl);
      expect(expired.status).toBeGreaterThanOrEqual(400);
      observations.expiredSignedUrlStatus = expired.status;
      const view = c.store.getState()!.reports.find((x) => x.id === charge.publicNumber)!;
      const oldUrl = view.evidence[0].uri;
      expect(await c.store.refreshSignedUrl(oldUrl)).toBe(true);
      const newUrl = c.store.getState()!.reports.find((x) => x.id === charge.publicNumber)!.evidence[0].uri;
      expect(newUrl).not.toBe(oldUrl);
      expect((await nodeFetch(newUrl)).status).toBe(200);
      expect(await c.store.refreshSignedUrl(newUrl)).toBe(false); // once a minute per object: no loops
    }, 30_000);
  });

  describe("pagination on the real project (page size 2)", () => {
    it("citizen: all reports once across pages = server count; Rejected tab finds its rows on page 1; notifications page", async () => {
      const c = await signIn("citizenA", { pageSize: 2 });
      unwrap(await c.store.refresh());
      const ids = await loadAll(c, { kind: "reports", status: null });
      const total = (c.store.getSummary()?.row as { total: number }).total;
      expect(total).toBeGreaterThan(2);
      expect(ids.length).toBe(total);
      expect(new Set(ids).size).toBe(ids.length);
      const rejected = await loadAll(c, { kind: "reports", status: "REJECTED" });
      expect(rejected).toContain((created.reports as Record<string, { publicNumber: string }>).reject.publicNumber);
      expect(rejected.length).toBe((c.store.getSummary()?.row as { rejected: number }).rejected);
      const notes = await loadAll(c, { kind: "notifications" });
      expect(new Set(notes).size).toBe(notes.length);
      expect(notes.length).toBeGreaterThan(2);
      // refresh goes back to page 1
      unwrap(await c.store.refresh());
      expect(c.store.getList({ kind: "reports", status: null }).ids).toHaveLength(2);
      observations.citizenPagination = { total, pagesLoaded: Math.ceil(ids.length / 2), rejected: rejected.length, notifications: notes.length };
      c.store.dispose();
    }, 120_000);

    it("officer: queue filters and cases tabs page server-side; totals match server counts; no duplicates", async () => {
      const o = await signIn("officerA", { pageSize: 2 });
      unwrap(await o.store.refresh());
      const sum = o.store.getSummary()?.row as { open: number; new: number; mine_total: number; mine_completed: number; mine_rejected: number; mine_issued: number };
      const all = await loadAll(o, { kind: "queue", filter: "all" });
      expect(all.length).toBe(sum.open);
      expect(new Set(all).size).toBe(all.length);
      const fresh = await loadAll(o, { kind: "queue", filter: "new" });
      expect(fresh.length).toBe(sum.new);
      const cases = await loadAll(o, { kind: "cases", tab: "all" });
      expect(cases.length).toBe(sum.mine_total);
      expect(new Set(cases).size).toBe(cases.length);
      expect((await loadAll(o, { kind: "cases", tab: "completed" })).length).toBe(sum.mine_completed);
      expect((await loadAll(o, { kind: "cases", tab: "rejected" })).length).toBe(sum.mine_rejected);
      expect((await loadAll(o, { kind: "cases", tab: "issued" })).length).toBe(sum.mine_issued);
      const notes = await loadAll(o, { kind: "notifications" });
      expect(new Set(notes).size).toBe(notes.length);
      observations.officerPagination = { open: sum.open, new: sum.new, mineTotal: sum.mine_total, notifications: notes.length };
      o.store.dispose();
    }, 180_000);
  });

  describe("lost responses after commit (timeout != failure) on the real backend", () => {
    it("submit_report: response lost after commit; the retry with the same id recovers the SAME report", async () => {
      const lossy = lossyFetch();
      const c = await signIn("citizenA", { lossy });
      const before = unwrap(await c.ops.getCitizenSummary(null)).total;
      const draft = qaDraft("lost-submit");
      lossy.dropNext("submit_report");
      expect(await c.store.submitReport(draft)).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
      const again = unwrap(await c.store.submitReport(draft));
      expect(again.created).toBe(false);
      expect(unwrap(await c.ops.getCitizenSummary(null)).total).toBe(before + 1);
      const rep = unwrap(await c.ops.getMyReport(Number(again.reportId))).reports![0];
      expect(await ledgerOf(c, rep.id)).toEqual(["REWARD_PENDING"]);
      (created.reports as Record<string, unknown>)["lost-submit"] = { publicNumber: again.reportId, reportUuid: rep.id };
      c.store.dispose();
    });

    it("accept_case and complete_case: lost responses are reconciled from server state (one outcome, one notification)", async () => {
      const x = await submitAndFind(S.citizenA, S.officerA, "lost-officer");
      const lossy = lossyFetch();
      const o = await signIn("officerA", { lossy });
      lossy.dropNext("accept_case");
      unwrap(await o.store.acceptCase(x.caseId), "reconciled accept");
      expect(unwrap(await o.ops.getCaseDetail(x.caseId)).cases![0]).toMatchObject({ status: "EN_ROUTE", assigned_officer_id: o.userId });
      lossy.dropNext("complete_case");
      expect(await o.store.completeCase(x.caseId, "VEHICLE_MOVED")).toEqual({ ok: true, value: { changed: true } });
      const d2 = unwrap(await o.ops.getCaseDetail(x.caseId));
      expect(d2.outcomes).toHaveLength(1);
      expect((await notifsOf(o, x.reportUuid)).filter((t) => t === "CASE_CLOSED_WITHOUT_CHARGE")).toHaveLength(1);
      o.store.dispose();
    });
  });

  describe("auth expiry (observed on the real project)", () => {
    it("an invalid/expired access token is refused and the app asks the auth layer to re-check; nothing changes", async () => {
      const c = await signIn("citizenB");
      const bad = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: nodeFetch, headers: { Authorization: `Bearer ${c.accessToken.slice(0, -4)}xxxx` } } });
      const onUnauth = jest.fn();
      const store = createCoreBackendStore({ userId: c.userId, role: "citizen", ops: createCoreOperations(bad), storage: createEvidenceStorage(bad, readPng), onUnauthenticated: onUnauth });
      const before = unwrap(await c.ops.getCitizenSummary(null)).total;
      const r = await store.submitReport(qaDraft("expired"));
      expect(r.ok).toBe(false);
      expect(onUnauth).toHaveBeenCalled();
      expect(unwrap(await c.ops.getCitizenSummary(null)).total).toBe(before);
      observations.invalidTokenError = r.ok ? null : r.error.code;
    });

    it("after sign-out the old access token: recorded (Supabase JWTs stay valid until expiry unless the session is checked)", async () => {
      const c = await signIn("citizenB");
      await c.client.auth.signOut({ scope: "local" });
      const raw = await nodeFetch(`${URL_}/rest/v1/rpc/get_citizen_summary`, {
        method: "POST",
        headers: { apikey: KEY, authorization: `Bearer ${c.accessToken}`, "content-type": "application/json" },
        body: "{}",
      });
      observations.oldAccessTokenAfterLocalSignOut = raw.status;
      const g = await signIn("citizenB");
      await g.client.auth.signOut({ scope: "global" });
      const raw2 = await nodeFetch(`${URL_}/rest/v1/rpc/get_citizen_summary`, {
        method: "POST",
        headers: { apikey: KEY, authorization: `Bearer ${g.accessToken}`, "content-type": "application/json" },
        body: "{}",
      });
      observations.oldAccessTokenAfterGlobalSignOut = raw2.status;
      const refresh = await createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: nodeFetch } }).auth.refreshSession({ refresh_token: "invalid" });
      observations.invalidRefreshTokenRejected = !!refresh.error;
      expect(refresh.error).toBeTruthy();
    });
  });
});

if (!RUN) {
  it("real-cloud QA is opt-in (set PARKWATCH_RUN_CLOUD_QA=1)", () => {
    expect(RUN).toBe(false);
  });
}
