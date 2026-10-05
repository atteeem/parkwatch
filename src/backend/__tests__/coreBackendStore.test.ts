// Core backend store with fake operations/storage (offline, deterministic):
// refresh behaviour, failure handling, cleanup and account isolation.
import { createCoreBackendStore } from "../core/coreBackendStore";
import { CoreOperations } from "../operations/coreOperations";
import { EvidenceStorage } from "../storage/evidenceStorage";
import { CoreSnapshotRows } from "../mappers/snapshot";
import { completeDraft } from "../../domain/__tests__/fixtures";
import { DomainErrorCode, Result } from "../../domain";

const USER = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = (code: DomainErrorCode): Result<never> => ({ ok: false, error: { code, message: code } });

const empty = (): CoreSnapshotRows => ({
  reports: [],
  report_evidence: [],
  cases: [],
  outcomes: [],
  inspections: [],
  inspection_checks: [],
  officer_evidence: [],
  ledger: [],
  notifications: [],
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(overrides: Partial<CoreOperations> = {}, storageOverrides: Partial<EvidenceStorage> = {}) {
  const log: string[] = [];
  const ops: CoreOperations = {
    getSnapshot: jest.fn(async () => (log.push("snapshot"), ok(empty()))),
    submitReport: jest.fn(async () => (log.push("submit"), ok({ reportUuid: USER, publicReportNumber: 100001, caseUuid: CASE, receivedAt: "t", created: true }))),
    acceptCase: jest.fn(async () => ok({ changed: true })),
    startEnRoute: jest.fn(async () => ok({ changed: true })),
    startInspection: jest.fn(async () => ok({ changed: true })),
    setInspectionCheck: jest.fn(async () => ok({ changed: true })),
    confirmPlateByScan: jest.fn(async () => ok({ changed: true })),
    addOfficerEvidence: jest.fn(async () => (log.push("add-evidence"), ok({ evidenceId: "e1" }))),
    completeCase: jest.fn(async () => ok({ changed: true, creditedCents: 500 })),
    markMyNotificationsRead: jest.fn(async () => ok({ updated: 1 })),
    ...overrides,
  };
  const storage: EvidenceStorage = {
    upload: jest.fn(async (_b, path) => (log.push(`upload ${path}`), ok({ created: true }))),
    remove: jest.fn(async (_b, paths) => void log.push(`remove ${paths.join(",")}`)),
    sign: jest.fn(async () => ({})),
    ...storageOverrides,
  };
  let t = 1_000_000;
  const store = createCoreBackendStore({ userId: USER, ops, storage, now: () => new Date(t), minFocusRefreshMs: 5000 });
  return { store, ops, storage, log, tick: (ms: number) => (t += ms) };
}

describe("refresh", () => {
  it("first load goes idle -> loading -> ready", async () => {
    const { store } = setup();
    expect(store.getStatus().phase).toBe("idle");
    const p = store.refresh();
    expect(store.getStatus().phase).toBe("loading");
    await p;
    expect(store.getStatus()).toMatchObject({ phase: "ready", error: null, refreshing: false });
    expect(store.getState()).not.toBeNull();
  });

  it("concurrent refresh requests share one server call", async () => {
    const d = deferred<Result<CoreSnapshotRows>>();
    const { store, ops } = setup({ getSnapshot: jest.fn(() => d.promise) });
    const a = store.refresh();
    const b = store.refresh();
    d.resolve(ok(empty()));
    await Promise.all([a, b]);
    expect(ops.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("first-load failure: error phase, no data (never demo data)", async () => {
    const { store } = setup({ getSnapshot: jest.fn(async () => err("NETWORK_ERROR")) });
    await store.refresh();
    expect(store.getStatus()).toMatchObject({ phase: "error", error: { code: "NETWORK_ERROR" } });
    expect(store.getState()).toBeNull();
  });

  it("a failed background refresh keeps the previous data and reports the error", async () => {
    let fail = false;
    const { store } = setup({ getSnapshot: jest.fn(async () => (fail ? err("BACKEND_ERROR") : ok(empty()))) });
    await store.refresh();
    const before = store.getState();
    fail = true;
    const r = await store.refresh();
    expect(r.ok).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getStatus()).toMatchObject({ phase: "ready", error: { code: "BACKEND_ERROR" } });
  });

  it("focus/foreground refresh is skipped while the data is fresh (no polling)", async () => {
    const { store, ops, tick } = setup();
    await store.refresh();
    await store.refreshIfStale();
    expect(ops.getSnapshot).toHaveBeenCalledTimes(1);
    tick(6000);
    await store.refreshIfStale();
    expect(ops.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("dispose (sign-out) drops all data and ignores a late response", async () => {
    const d = deferred<Result<CoreSnapshotRows>>();
    const { store } = setup({ getSnapshot: jest.fn(() => d.promise) });
    const p = store.refresh();
    store.dispose();
    d.resolve(ok(empty()));
    await p;
    expect(store.getState()).toBeNull();
  });
});

describe("mutations", () => {
  it("a successful action refreshes; a failed one does not change local data", async () => {
    let n = 0;
    const { store, ops } = setup({ acceptCase: jest.fn(async () => (++n === 1 ? ok({ changed: true }) : err("CASE_TAKEN"))) });
    await store.refresh();
    expect((await store.acceptCase(CASE)).ok).toBe(true);
    expect(ops.getSnapshot).toHaveBeenCalledTimes(2);
    const before = store.getState();
    expect(await store.acceptCase(CASE)).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
    expect(ops.getSnapshot).toHaveBeenCalledTimes(2);
    expect(store.getState()).toBe(before);
  });

  it("submit: uploads to <uid>/<draft>/..., then calls the server, then refreshes", async () => {
    const { store, log } = setup();
    const r = await store.submitReport(completeDraft("draft-7"));
    expect(r).toEqual({ ok: true, value: { reportId: "100001", created: true } });
    expect(log).toEqual([
      `upload ${USER}/draft-7/e-front.jpg`,
      `upload ${USER}/draft-7/e-side.jpg`,
      `upload ${USER}/draft-7/e-rear.jpg`,
      "submit",
      "snapshot",
    ]);
  });

  it("submit sends no trusted values (owner, status, number, reward) to the server", async () => {
    const { store, ops } = setup();
    await store.submitReport(completeDraft("draft-8"));
    const input = (ops.submitReport as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    for (const k of ["citizenId", "citizen_id", "status", "publicReportNumber", "rewardCents", "receivedAt", "jurisdictionId", "priority"]) expect(input).not.toHaveProperty(k);
    expect(input.submissionId).toBe("draft-8");
  });

  it("submit: an upload failure removes earlier uploads and never calls the server", async () => {
    let n = 0;
    const { store, ops, log } = setup({}, { upload: jest.fn(async (_b, p) => (++n === 2 ? err("UPLOAD_FAILED") : (log.push(`upload ${p}`), ok({ created: true })))) });
    const r = await store.submitReport(completeDraft("draft-9"));
    expect(r).toMatchObject({ ok: false, error: { code: "UPLOAD_FAILED" } });
    expect(ops.submitReport).not.toHaveBeenCalled();
    expect(log).toEqual([`upload ${USER}/draft-9/e-front.jpg`, `remove ${USER}/draft-9/e-front.jpg`]);
  });

  it("submit: a server failure removes this attempt's uploads; the draft can be retried with the same id", async () => {
    let n = 0;
    const { store, ops, log } = setup({
      submitReport: jest.fn(async () => (++n === 1 ? err("NETWORK_ERROR") : ok({ reportUuid: USER, publicReportNumber: 100002, caseUuid: CASE, receivedAt: "t", created: false }))),
    });
    expect(await store.submitReport(completeDraft("draft-10"))).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
    expect(log.filter((l) => l.startsWith("remove"))).toHaveLength(1);
    const again = await store.submitReport(completeDraft("draft-10"));
    expect(again).toEqual({ ok: true, value: { reportId: "100002", created: false } });
    const ids = (ops.submitReport as jest.Mock).mock.calls.map((c) => c[0].submissionId);
    expect(ids).toEqual(["draft-10", "draft-10"]);
  });

  it("submit: an incomplete draft is refused before any upload", async () => {
    const { store, storage } = setup();
    const d = completeDraft("draft-11");
    delete d.photos.REAR;
    expect(await store.submitReport(d)).toMatchObject({ ok: false, error: { code: "INVALID_DRAFT" } });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("officer photo: a server refusal removes the uploaded object", async () => {
    const { store, log } = setup({ addOfficerEvidence: jest.fn(async () => err("CASE_TAKEN")) });
    const r = await store.setOfficerPhoto(CASE, "PARKING_SIGN", "file:///x.jpg");
    expect(r).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
    const uploaded = log.find((l) => l.startsWith("upload"))!.slice(7);
    expect(uploaded.startsWith(`${CASE}/PARKING_SIGN-`)).toBe(true);
    expect(log).toContain(`remove ${uploaded}`);
  });

  it("mark notifications read: skipped when nothing is unread", async () => {
    const { store, ops } = setup();
    await store.refresh();
    expect((await store.markNotificationsRead()).ok).toBe(true);
    expect(ops.markMyNotificationsRead).not.toHaveBeenCalled();
  });

  it("complete case: passes no amount; the result is the server's", async () => {
    const { store, ops } = setup();
    expect(await store.completeCase(CASE, "CHARGE_ISSUED", "n")).toEqual({ ok: true, value: { changed: true } });
    expect((ops.completeCase as jest.Mock).mock.calls[0]).toEqual([CASE, "CHARGE_ISSUED", "n"]);
  });
});
