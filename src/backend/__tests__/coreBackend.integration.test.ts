/**
 * @jest-environment node
 */
// Integration: the app's real backend modules (core operations, evidence
// storage, core backend store) with the real supabase-js client, against the
// local mock backend (scripts/mock-supabase-backend.mjs), which runs the REAL
// migrations in PGlite and executes every RPC and storage call AS the
// signed-in user. Offline; this is NOT a real Supabase project.
import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createCoreOperations } from "../operations/coreOperations";
import { createEvidenceStorage, EVIDENCE_BUCKETS, ReadLocalFile } from "../storage/evidenceStorage";
import { createCoreBackendStore, CoreBackendStore, SubmitProgress } from "../core/coreBackendStore";
import { completeDraft } from "../../domain/__tests__/fixtures";
import { ReportDraft } from "../../domain";
import { selectCitizenReports, selectNotifications, selectWallet, selectOfficerCases } from "../../presentation/viewModels";
import { nodeFetch } from "./helpers/nodeFetch";

const fetch = nodeFetch;

const ROOT = path.resolve(__dirname, "../../..");
const PORT = 54000 + Math.floor(Math.random() * 900);
const URL_ = `http://localhost:${PORT}`;
let server: ChildProcess;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).buffer;
const okFile: ReadLocalFile = async () => JPEG;

async function waitForServer() {
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`${URL_}/__mock/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("mock backend did not start");
}

beforeAll(async () => {
  server = spawn(process.execPath, [path.join(ROOT, "scripts", "mock-supabase-backend.mjs")], { cwd: ROOT, env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: "ignore" });
  await waitForServer();
}, 60_000);

afterAll(() => {
  server?.kill();
});

type Session = { client: SupabaseClient; userId: string; store: CoreBackendStore };

async function signIn(email: string, readFile: ReadLocalFile = okFile, url = URL_): Promise<Session> {
  const client = createClient(URL_, "mock-anon", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: nodeFetch } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: "mock-password-1" });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}`);
  // `url` lets a test point the data client at a dead port (network failure) with a valid session.
  const dataClient = url === URL_ ? client : createClient(url, "mock-anon", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: nodeFetch, headers: { Authorization: `Bearer ${data.session!.access_token}` } } });
  const store = createCoreBackendStore({ userId: data.user.id, ops: createCoreOperations(dataClient), storage: createEvidenceStorage(dataClient, readFile), minFocusRefreshMs: 0 });
  return { client, userId: data.user.id, store };
}

const draft = (id: string): ReportDraft => ({ ...completeDraft(id), notes: "blocking the exit" });
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw new Error(`unexpected ${r.error.code}`);
  return r.value;
};
const state = (s: Session) => s.store.getState()!;
const caseOf = (officer: Session, reportId: string) => state(officer).cases.find((c) => c.reportId === reportId)!;

async function inspectAndPhotograph(officer: Session, caseId: string) {
  unwrap(await officer.store.startInspection(caseId));
  for (const key of ["vehiclePresent", "violationConfirmed", "restrictionVerified"] as const) unwrap(await officer.store.setChecklistItem(caseId, key, true));
  unwrap(await officer.store.confirmPlateBySimulatedScan(caseId));
  for (const t of ["VEHICLE_OVERVIEW", "LICENSE_PLATE", "PARKING_SIGN", "VIOLATION_CONTEXT"] as const) {
    unwrap(await officer.store.setOfficerPhoto(caseId, t, "file:///officer.jpg", new Date().toISOString()));
  }
}

describe("core workflow against the mock backend (real SQL, real supabase-js)", () => {
  let citizen: Session;
  let citizen2: Session;
  let officer: Session;
  let officer2: Session;
  let chargeReportId: string;

  beforeAll(async () => {
    citizen = await signIn("citizen@example.test");
    citizen2 = await signIn("citizen2@example.test");
    officer = await signIn("officer@example.test");
    officer2 = await signIn("officer2@example.test");
  }, 30_000);

  it("first load: loading -> ready with no reports", async () => {
    expect(citizen.store.getStatus().phase).toBe("idle");
    const p = citizen.store.refresh();
    expect(citizen.store.getStatus().phase).toBe("loading");
    unwrap(await p);
    expect(citizen.store.getStatus()).toMatchObject({ phase: "ready", error: null });
    expect(state(citizen).reports).toEqual([]);
  });

  it("submit: uploads privately, then the server creates the report, case, pending reward and notification", async () => {
    const phases: SubmitProgress[] = [];
    const r = unwrap(await citizen.store.submitReport(draft("draft-int-1"), (p) => phases.push(p)));
    expect(phases).toEqual(["uploading", "submitting"]);
    expect(r.created).toBe(true);
    expect(r.reportId).toMatch(/^\d+$/);
    chargeReportId = r.reportId;
    const [view] = selectCitizenReports(state(citizen), citizen.userId);
    expect(view).toMatchObject({ id: r.reportId, status: "under-review", rewardState: "estimated", reward: 5 });
    // Evidence is shown through short-lived signed URLs, never a public URL or a device path.
    expect(view.images).toHaveLength(3);
    for (const u of view.images) expect(u).toMatch(new RegExp(`^${URL_}/storage/v1/object/sign/report-evidence/${citizen.userId}/draft-int-1/.+\\?token=`));
    expect(selectWallet(state(citizen), citizen.userId)).toEqual({ available: 0, pending: 5, paidOut: 0 });
    expect(selectNotifications(state(citizen), { role: "CITIZEN", accountId: citizen.userId }, new Date()).map((n) => n.title)).toEqual(["Report under review"]);
    // The signed URL really serves the private object.
    const res = await fetch(view.images[0]);
    expect(res.status).toBe(200);
  });

  it("retrying the same submission returns the same report (no duplicate)", async () => {
    const again = unwrap(await citizen.store.submitReport(draft("draft-int-1")));
    expect(again).toEqual({ reportId: chargeReportId, created: false });
    expect(state(citizen).reports).toHaveLength(1);
  });

  it("an upload failure stops before the server call and removes what was uploaded", async () => {
    let n = 0;
    const flaky = await signIn("citizen@example.test", async () => {
      if (++n === 3) throw new Error("disk");
      return JPEG;
    });
    const r = await flaky.store.submitReport(draft("draft-int-flaky"));
    expect(r).toMatchObject({ ok: false, error: { code: "UPLOAD_FAILED" } });
    const signed = await createEvidenceStorage(citizen.client).sign(EVIDENCE_BUCKETS.citizen, [`${citizen.userId}/draft-int-flaky/draft-int-flaky-FRONT.jpg`]);
    expect(signed).toEqual({});
    unwrap(await citizen.store.refresh());
    expect(state(citizen).reports).toHaveLength(1);
  });

  it("a server refusal after upload removes the uploaded photos (partial-failure cleanup)", async () => {
    // "draft.bad" is not a valid submission id: the server refuses it after the uploads.
    const bad = { ...draft("draft.bad") };
    const r = await citizen.store.submitReport(bad);
    expect(r).toMatchObject({ ok: false, error: { code: "INVALID_DRAFT" } });
    const signed = await createEvidenceStorage(citizen.client).sign(EVIDENCE_BUCKETS.citizen, ["FRONT", "SIDE", "REAR"].map((s) => `${citizen.userId}/draft_bad/draft_bad-${s}.jpg`));
    expect(signed).toEqual({});
  });

  it("another citizen sees nothing of it and cannot sign its photos", async () => {
    unwrap(await citizen2.store.refresh());
    expect(state(citizen2).reports).toEqual([]);
    expect(state(citizen2).ledger).toEqual([]);
    const signed = await createEvidenceStorage(citizen2.client).sign(EVIDENCE_BUCKETS.citizen, [`${citizen.userId}/draft-int-1/draft-int-1-FRONT.jpg`]);
    expect(signed).toEqual({});
  });

  it("officer: sees the case, accepts it; a second officer gets CASE_TAKEN", async () => {
    unwrap(await officer.store.refresh());
    unwrap(await officer2.store.refresh());
    const c = caseOf(officer, chargeReportId);
    expect(c.status).toBe("NEW");
    const view = selectOfficerCases(state(officer), new Date()).find((x) => x.reportId === chargeReportId)!;
    expect(view).toMatchObject({ reporterReliability: "Not rated", reporterStatsKnown: false });
    unwrap(await officer.store.acceptCase(c.id));
    expect(caseOf(officer, chargeReportId)).toMatchObject({ status: "EN_ROUTE", assignedOfficerId: officer.userId });
    expect(await officer2.store.acceptCase(c.id)).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
    // A retry by the winner is a no-op.
    unwrap(await officer.store.acceptCase(c.id));
  });

  it("charge before the inspection is ready is refused by the server", async () => {
    const c = caseOf(officer, chargeReportId);
    expect(await officer.store.completeCase(c.id, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
    unwrap(await officer.store.startInspection(c.id));
    expect(await officer.store.completeCase(c.id, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "INSPECTION_NOT_READY" } });
  });

  it("officer photos: uploaded privately, a retake replaces the slot and removes the old object", async () => {
    const c = caseOf(officer, chargeReportId);
    await inspectAndPhotograph(officer, c.id);
    const first = state(officer).inspections[c.id].officerEvidence.PARKING_SIGN!.uri;
    unwrap(await officer.store.setOfficerPhoto(c.id, "PARKING_SIGN", "file:///retake.jpg"));
    const second = state(officer).inspections[c.id].officerEvidence.PARKING_SIGN!.uri;
    expect(second).not.toEqual(first);
    expect((await fetch(first)).status).not.toBe(200); // old object is gone
    expect((await fetch(second)).status).toBe(200);
    // The citizen cannot read officer evidence.
    const path = new URL(second).pathname.split("/officer-evidence/")[1];
    expect(await createEvidenceStorage(citizen.client).sign(EVIDENCE_BUCKETS.officer, [path])).toEqual({});
  });

  it("CHARGE_ISSUED: server charge 60.00, report verified, 5.00 available, citizen + officer notified; idempotent", async () => {
    const c = caseOf(officer, chargeReportId);
    expect(unwrap(await officer.store.completeCase(c.id, "CHARGE_ISSUED", "clear violation"))).toEqual({ changed: true });
    expect(unwrap(await officer.store.completeCase(c.id, "CHARGE_ISSUED"))).toEqual({ changed: false });
    expect(await officer.store.completeCase(c.id, "REPORT_REJECTED")).toMatchObject({ ok: false, error: { code: "ALREADY_COMPLETED" } });
    const done = selectOfficerCases(state(officer), new Date()).find((x) => x.reportId === chargeReportId)!;
    expect(done).toMatchObject({ status: "completed", chargeAmount: 60, outcomeCode: "CHARGE_ISSUED" });
    expect(selectNotifications(state(officer), { role: "OFFICER", accountId: officer.userId }, new Date()).map((n) => n.title)).toEqual(
      expect.arrayContaining(["Parking Charge Issued", "Case Accepted"])
    );

    unwrap(await citizen.store.refresh());
    expect(selectCitizenReports(state(citizen), citizen.userId)[0]).toMatchObject({ id: chargeReportId, status: "verified", rewardState: "rewarded" });
    expect(selectWallet(state(citizen), citizen.userId)).toEqual({ available: 5, pending: 0, paidOut: 0 });
    const notes = selectNotifications(state(citizen), { role: "CITIZEN", accountId: citizen.userId }, new Date());
    expect(notes.map((n) => n.title)).toEqual(["Report verified", "Report under review"]);
  });

  it("notification read state is stored on the server", async () => {
    unwrap(await citizen.store.markNotificationsRead());
    const fresh = await signIn("citizen@example.test");
    unwrap(await fresh.store.refresh());
    expect(state(fresh).notifications.every((n) => n.readAt)).toBe(true);
  });

  it("REPORT_REJECTED: report rejected, reward voided, citizen told", async () => {
    const { reportId } = unwrap(await citizen.store.submitReport(draft("draft-int-reject")));
    unwrap(await officer.store.refresh());
    const c = caseOf(officer, reportId);
    unwrap(await officer.store.completeCase(c.id, "REPORT_REJECTED"));
    unwrap(await citizen.store.refresh());
    const view = selectCitizenReports(state(citizen), citizen.userId).find((r) => r.id === reportId)!;
    expect(view).toMatchObject({ status: "rejected", rewardState: "none" });
    const titles = selectNotifications(state(citizen), { role: "CITIZEN", accountId: citizen.userId }, new Date()).map((n) => n.title);
    expect(titles).toContain("Report rejected");
    expect(selectWallet(state(citizen), citizen.userId)).toEqual({ available: 5, pending: 0, paidOut: 0 });
  });

  it("VEHICLE_MOVED: case completed, citizen status unchanged, reward voided, no citizen outcome notification", async () => {
    const { reportId } = unwrap(await citizen.store.submitReport(draft("draft-int-moved")));
    unwrap(await officer.store.refresh());
    const c = caseOf(officer, reportId);
    unwrap(await officer.store.acceptCase(c.id));
    unwrap(await officer.store.completeCase(c.id, "VEHICLE_MOVED"));
    expect(caseOf(officer, reportId).status).toBe("COMPLETED");
    unwrap(await citizen.store.refresh());
    const view = selectCitizenReports(state(citizen), citizen.userId).find((r) => r.id === reportId)!;
    expect(view).toMatchObject({ status: "under-review", rewardState: "none" });
    const forReport = state(citizen).notifications.filter((n) => n.reportId === reportId).map((n) => n.type);
    expect(forReport).toEqual(["REPORT_UNDER_REVIEW"]);
    expect(selectWallet(state(citizen), citizen.userId)).toEqual({ available: 5, pending: 0, paidOut: 0 });
  });

  it("an inactive officer sees no cases and cannot act", async () => {
    const inactive = await signIn("inactive-officer@example.test");
    unwrap(await inactive.store.refresh());
    expect(state(inactive).cases).toEqual([]);
    const anyCase = caseOf(officer, chargeReportId);
    expect(await inactive.store.acceptCase(anyCase.id)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("deactivating a membership removes access on the next refresh", async () => {
    await fetch(`${URL_}/__mock/membership`, { method: "POST", body: JSON.stringify({ email: "officer2@example.test", active: false }) });
    unwrap(await officer2.store.refresh());
    expect(state(officer2).cases).toEqual([]);
    await fetch(`${URL_}/__mock/membership`, { method: "POST", body: JSON.stringify({ email: "officer2@example.test", active: true }) });
  });

  it("network failure: typed NETWORK_ERROR, first load shows the error state (no demo fallback)", async () => {
    const offline = await signIn("citizen@example.test", okFile, "http://localhost:9");
    const r = await offline.store.refresh();
    expect(r).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
    expect(offline.store.getStatus()).toMatchObject({ phase: "error", error: { code: "NETWORK_ERROR" } });
    expect(offline.store.getState()).toBeNull();
  });
});
