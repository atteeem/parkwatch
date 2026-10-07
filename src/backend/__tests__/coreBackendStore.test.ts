// Core backend store with fake operations/storage (offline, deterministic):
// refresh, pagination, submit/upload recovery, ambiguous results, signed URLs.
import { createCoreBackendStore, ListSpec } from "../core/coreBackendStore";
import { CitizenSummaryRow, CoreOperations, OfficerSummaryRow, PageBundle } from "../operations/coreOperations";
import { EvidenceStorage } from "../storage/evidenceStorage";
import { completeDraft } from "../../domain/__tests__/fixtures";
import { DomainErrorCode, Result } from "../../domain";

const USER = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = (code: DomainErrorCode): Result<never> => ({ ok: false, error: { code, message: code } });

const citizenSummary: CitizenSummaryRow = { total: 0, under_review: 0, verified: 0, rejected: 0, since_total: 0, since_verified: 0, since_rejected: 0, unread_notifications: 0 };
const officerSummary: OfficerSummaryRow = {
  open: 0, new: 0, high_new: 0, high_open: 0, assigned_to_me: 0, mine_total: 0, mine_completed: 0, mine_issued: 0, mine_rejected: 0,
  since_completed: 0, since_issued: 0, since_rejected: 0, unread_notifications: 0,
};
const emptyPage = (): PageBundle => ({ ids: [], next_cursor: null, next_offset: null });

function report(n: number) {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  return {
    id, public_report_number: 100000 + n, citizen_id: USER, source_draft_id: `d${n}`, jurisdiction_id: "helsinki-demo", status: "UNDER_REVIEW",
    violation_type: "no-parking", plate_raw: null, plate_normalized: null, plate_country: null, vehicle_make: null, vehicle_model: null, vehicle_color: null,
    vehicle_source: null, location_address: `Street ${n}`, latitude: null, longitude: null, location_accuracy_m: null, location_captured_at: null, notes: "",
    observed_at: "2026-10-01T10:00:00Z", submitted_at: `2026-10-01T10:${String(59 - n).padStart(2, "0")}:00Z`, received_at: "x", resolved_at: null,
    incident_id: null, priority: "NORMAL", created_at: "x", updated_at: "x",
  };
}
const reportPage = (ns: number[], next: { ts: string; id: string } | null): PageBundle => ({ ids: ns.map((n) => report(n).id), reports: ns.map(report) as never, report_evidence: [], next_cursor: next });

function caseBundle(over: Record<string, unknown> = {}, extra: Partial<PageBundle> = {}): PageBundle {
  const r = report(1);
  return {
    ids: [CASE],
    reports: [r] as never,
    report_evidence: [],
    cases: [{ id: CASE, report_id: r.id, jurisdiction_id: "helsinki-demo", status: "NEW", priority: "NORMAL", assigned_officer_id: null, created_at: "x", updated_at: "x", assigned_at: null, en_route_at: null, on_site_at: null, inspection_started_at: null, completed_at: null, ...over }] as never,
    outcomes: [],
    inspections: [],
    inspection_checks: [],
    officer_evidence: [],
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(overrides: Partial<CoreOperations> = {}, storageOverrides: Partial<EvidenceStorage> = {}, role: "citizen" | "officer" = "citizen") {
  const log: string[] = [];
  const onUnauthenticated = jest.fn();
  const ops: CoreOperations = {
    submitReport: jest.fn(async () => (log.push("submit"), ok({ reportUuid: report(9).id, publicReportNumber: 100009, caseUuid: CASE, receivedAt: "t", created: true }))),
    acceptCase: jest.fn(async () => ok({ changed: true })),
    startEnRoute: jest.fn(async () => ok({ changed: true })),
    startInspection: jest.fn(async () => ok({ changed: true })),
    setInspectionCheck: jest.fn(async () => ok({ changed: true })),
    confirmPlateByScan: jest.fn(async () => ok({ changed: true })),
    addOfficerEvidence: jest.fn(async () => (log.push("add-evidence"), ok({ evidenceId: "e1" }))),
    completeCase: jest.fn(async () => ok({ changed: true, creditedCents: 500 })),
    markMyNotificationsRead: jest.fn(async () => ok({ updated: 1 })),
    getCitizenSummary: jest.fn(async () => (log.push("summary"), ok(citizenSummary))),
    getOfficerSummary: jest.fn(async () => (log.push("summary"), ok(officerSummary))),
    getOfficerMonthlyStats: jest.fn(async () => ok({ completed: 0, issued: 0, rejected: 0, no_charge: 0, days: [] })),
    getMyLedger: jest.fn(async () => ok([])),
    pageMyReports: jest.fn(async () => ok(emptyPage())),
    pageMyNotifications: jest.fn(async () => ok(emptyPage())),
    pageOfficerQueue: jest.fn(async () => ok(emptyPage())),
    pageMyCases: jest.fn(async () => ok(emptyPage())),
    getCaseDetail: jest.fn(async () => ok(caseBundle())),
    getMyReport: jest.fn(async () => ok({})),
    ...overrides,
  };
  const storage: EvidenceStorage = {
    upload: jest.fn(async (_b, path) => (log.push(`upload ${path}`), ok({ created: true }))),
    remove: jest.fn(async (_b, paths) => void log.push(`remove ${paths.join(",")}`)),
    sign: jest.fn(async (_b, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}?v=${log.push("sign")}`]))),
    ...storageOverrides,
  };
  let t = 1_000_000;
  const store = createCoreBackendStore({ userId: USER, role, ops, storage, now: () => new Date(t), minFocusRefreshMs: 5000, pageSize: 2, onUnauthenticated });
  return { store, ops, storage, log, onUnauthenticated, tick: (ms: number) => (t += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const ALL: ListSpec = { kind: "reports", status: null };

describe("refresh", () => {
  it("first load goes idle -> loading -> ready (summary + ledger)", async () => {
    const { store, ops } = setup();
    expect(store.getStatus().phase).toBe("idle");
    const p = store.refresh();
    expect(store.getStatus().phase).toBe("loading");
    await p;
    expect(store.getStatus()).toMatchObject({ phase: "ready", error: null, refreshing: false });
    expect(store.getSummary()).toEqual({ kind: "citizen", row: citizenSummary });
    expect(ops.getMyLedger).toHaveBeenCalled();
    expect(ops.getOfficerSummary).not.toHaveBeenCalled();
  });

  it("an officer store loads the officer summary (no ledger)", async () => {
    const { store, ops } = setup({}, {}, "officer");
    await store.refresh();
    expect(store.getSummary()?.kind).toBe("officer");
    expect(ops.getMyLedger).not.toHaveBeenCalled();
  });

  it("concurrent refresh requests share one server call", async () => {
    const d = deferred<Result<CitizenSummaryRow>>();
    const { store, ops } = setup({ getCitizenSummary: jest.fn(() => d.promise) });
    const a = store.refresh();
    const b = store.refresh();
    d.resolve(ok(citizenSummary));
    await Promise.all([a, b]);
    expect(ops.getCitizenSummary).toHaveBeenCalledTimes(1);
  });

  it("first-load failure: error phase, no data (never demo data)", async () => {
    const { store } = setup({ getCitizenSummary: jest.fn(async () => err("NETWORK_ERROR")) });
    await store.refresh();
    expect(store.getStatus()).toMatchObject({ phase: "error", error: { code: "NETWORK_ERROR" } });
    expect(store.getState()).toBeNull();
  });

  it("a failed background refresh keeps the previous data and reports the error", async () => {
    let fail = false;
    const { store } = setup({ getCitizenSummary: jest.fn(async () => (fail ? err("NETWORK_ERROR") : ok(citizenSummary))) });
    await store.refresh();
    const before = store.getState();
    fail = true;
    expect((await store.refresh()).ok).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getStatus()).toMatchObject({ phase: "ready", error: { code: "NETWORK_ERROR" } });
  });

  it("focus/foreground refresh is skipped while the data is fresh (no polling)", async () => {
    const { store, ops, tick } = setup();
    await store.refresh();
    await store.refreshIfStale();
    expect(ops.getCitizenSummary).toHaveBeenCalledTimes(1);
    tick(6000);
    await store.refreshIfStale();
    expect(ops.getCitizenSummary).toHaveBeenCalledTimes(2);
  });

  it("dispose (sign-out) drops all data and ignores a late response", async () => {
    const d = deferred<Result<CitizenSummaryRow>>();
    const { store } = setup({ getCitizenSummary: jest.fn(() => d.promise) });
    const p = store.refresh();
    store.dispose();
    d.resolve(ok(citizenSummary));
    await p;
    expect(store.getState()).toBeNull();
    expect(store.getSummary()).toBeNull();
  });

  it("an UNAUTHENTICATED answer triggers the session check", async () => {
    const { store, onUnauthenticated } = setup({ getCitizenSummary: jest.fn(async () => err("UNAUTHENTICATED")) });
    await store.refresh();
    expect(onUnauthenticated).toHaveBeenCalled();
  });
});

describe("pagination", () => {
  it("page 1 on first show, next page on loadMore, ids are report numbers, no duplicates", async () => {
    const pages = [reportPage([1, 2], { ts: "t2", id: "c2" }), reportPage([2, 3], { ts: "t3", id: "c3" }), reportPage([4], null)];
    const pageMyReports = jest.fn(async (_s: unknown, _c: unknown) => ok(pages.shift()!));
    const { store } = setup({ pageMyReports });
    await store.refresh();
    store.ensureList(ALL);
    await flush();
    expect(store.getList(ALL)).toMatchObject({ ids: ["100001", "100002"], loaded: true, hasMore: true });
    store.loadMore(ALL);
    await flush();
    // Row 2 appeared on both pages (data shifted): shown once.
    expect(store.getList(ALL).ids).toEqual(["100001", "100002", "100003"]);
    store.loadMore(ALL);
    await flush();
    expect(store.getList(ALL)).toMatchObject({ ids: ["100001", "100002", "100003", "100004"], hasMore: false });
    expect(pageMyReports.mock.calls.map((c) => c[1])).toEqual([null, { ts: "t2", id: "c2" }, { ts: "t3", id: "c3" }]);
    expect(store.getState()!.reports).toHaveLength(4);
  });

  it("refresh goes back to page 1 and drops the stale cursor", async () => {
    const pageMyReports = jest.fn(async (_s: unknown, cursor: unknown) => ok(cursor ? reportPage([3], null) : reportPage([1, 2], { ts: "t2", id: "c2" })));
    const { store, tick } = setup({ pageMyReports });
    await store.refresh();
    store.ensureList(ALL);
    await flush();
    store.loadMore(ALL);
    await flush();
    expect(store.getList(ALL).ids).toHaveLength(3);
    tick(10_000);
    await store.refresh();
    expect(store.getList(ALL)).toMatchObject({ ids: ["100001", "100002"], hasMore: true });
    expect(pageMyReports.mock.calls.at(-1)?.[1]).toBeNull();
  });

  it("a next page that arrives after a refresh is dropped (never mixed into the new page 1)", async () => {
    const slow = deferred<Result<PageBundle>>();
    let n = 0;
    const pageMyReports = jest.fn(async (_s: unknown, cursor: unknown) => {
      n++;
      if (cursor) return slow.promise;
      return ok(reportPage(n > 2 ? [5, 6] : [1, 2], { ts: "t", id: "c" }));
    });
    const { store } = setup({ pageMyReports });
    await store.refresh();
    store.ensureList(ALL);
    await flush();
    store.loadMore(ALL);
    await store.refresh();
    slow.resolve(ok(reportPage([3, 4], null)));
    await flush();
    expect(store.getList(ALL).ids).toEqual(["100005", "100006"]);
  });

  it("filters are server-side: each filter is its own list with the server's ids", async () => {
    const pageMyReports = jest.fn(async (status: unknown) => ok(status === "REJECTED" ? reportPage([7], null) : reportPage([1, 2], null)));
    const { store } = setup({ pageMyReports });
    await store.refresh();
    const rejected: ListSpec = { kind: "reports", status: "REJECTED" };
    store.ensureList(rejected);
    store.ensureList(ALL);
    await flush();
    expect(store.getList(rejected).ids).toEqual(["100007"]);
    expect(store.getList(ALL).ids).toEqual(["100001", "100002"]);
    expect(pageMyReports).toHaveBeenCalledWith("REJECTED", null, 2);
  });

  it("queue pages use offsets and the officer position from page 1", async () => {
    const pageOfficerQueue = jest.fn(async (_f: unknown, _p: unknown, offset: number) => ok({ ...caseBundle(), ids: [CASE], next_offset: offset === 0 ? 2 : null }));
    const { store } = setup({ pageOfficerQueue }, {}, "officer");
    store.setQueuePosition({ lat: 60.1, lng: 24.9 });
    await store.refresh();
    const q: ListSpec = { kind: "queue", filter: "high" };
    store.ensureList(q);
    await flush();
    store.setQueuePosition({ lat: 61, lng: 25 }); // moving does not reorder a half-loaded list
    store.loadMore(q);
    await flush();
    expect(pageOfficerQueue.mock.calls).toEqual([
      ["high", { lat: 60.1, lng: 24.9 }, 0, 2],
      ["high", { lat: 60.1, lng: 24.9 }, 2, 2],
    ]);
    expect(store.getList(q)).toMatchObject({ ids: [CASE], hasMore: false });
  });

  it("a failed first page can be retried with loadMore", async () => {
    let fail = true;
    const { store } = setup({ pageMyReports: jest.fn(async () => (fail ? err("NETWORK_ERROR") : ok(reportPage([1], null)))) });
    await store.refresh();
    store.ensureList(ALL);
    await flush();
    expect(store.getList(ALL)).toMatchObject({ loaded: false, error: { code: "NETWORK_ERROR" } });
    fail = false;
    store.loadMore(ALL);
    await flush();
    expect(store.getList(ALL)).toMatchObject({ loaded: true, ids: ["100001"], error: null });
  });
});

describe("submit + upload recovery", () => {
  it("uploads to <uid>/<draft>/..., then calls the server, then refreshes", async () => {
    const { store, log } = setup();
    const r = await store.submitReport(completeDraft("draft-7"));
    expect(r).toEqual({ ok: true, value: { reportId: "100009", created: true } });
    expect(log.slice(0, 4)).toEqual([`upload ${USER}/draft-7/e-front.jpg`, `upload ${USER}/draft-7/e-side.jpg`, `upload ${USER}/draft-7/e-rear.jpg`, "submit"]);
  });

  it("submit sends no trusted values (owner, status, number, reward) to the server", async () => {
    const { store, ops } = setup();
    await store.submitReport(completeDraft("draft-8"));
    const input = (ops.submitReport as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    for (const k of ["citizenId", "citizen_id", "status", "publicReportNumber", "rewardCents", "receivedAt", "jurisdictionId", "priority"]) expect(input).not.toHaveProperty(k);
    expect(input.submissionId).toBe("draft-8");
  });

  it("T8.7: a map-picked point is sent as MAP_SELECTED without GPS accuracy/time and without the raw device fix", async () => {
    const { store, ops } = setup();
    const fix = { latitude: 60.17, longitude: 24.94, accuracyMeters: 25, capturedAt: "2026-10-07T09:40:00.000Z" };
    const d = completeDraft("draft-map");
    d.location = { address: "Kaivokatu 1", coordinates: { latitude: 60.1712, longitude: 24.9411 }, coordinatesSource: "MAP_SELECTED", deviceFix: fix };
    await store.submitReport(d);
    const input = (ops.submitReport as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ latitude: 60.1712, longitude: 24.9411, locationSource: "MAP_SELECTED" });
    expect(input.locationAccuracyM).toBeUndefined();
    expect(input.locationCapturedAt).toBeUndefined();
    // Data minimization: the original GPS fix stays in the local draft only.
    expect(Object.keys(input).filter((k) => /^device/i.test(k))).toEqual([]);
    for (const v of [fix.latitude, fix.longitude, fix.accuracyMeters, fix.capturedAt]) expect(Object.values(input)).not.toContain(v);
  });

  it("T8.7: a GPS point is sent with its accuracy/time and source GPS; observedAt is the earliest photo", async () => {
    const { store, ops } = setup();
    const fix = { latitude: 60.17, longitude: 24.94, accuracyMeters: 7, capturedAt: "2026-10-07T09:40:00.000Z" };
    const d = completeDraft("draft-gps");
    d.location = { address: "Kaivokatu 1", coordinates: fix, coordinatesSource: "GPS", deviceFix: fix };
    await store.submitReport(d);
    const input = (ops.submitReport as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ locationSource: "GPS", locationAccuracyM: 7, locationCapturedAt: fix.capturedAt });
    expect(Object.keys(input).filter((k) => /^device/i.test(k))).toEqual([]);
    const earliest = Object.values(d.photos).map((p) => p!.capturedAt).sort()[0];
    expect(input.observedAt).toBe(earliest);
  });

  it("an upload failure keeps finished uploads (no cleanup) and never calls the server", async () => {
    let n = 0;
    const uploaded: string[] = [];
    const { store, ops, log } = setup({}, { upload: jest.fn(async (_b, p) => (++n === 2 ? err("NETWORK_ERROR") : (log.push(`upload ${p}`), ok({ created: true })))) });
    const r = await store.submitReport(completeDraft("draft-9"), { onUploaded: (p) => uploaded.push(p) });
    expect(r).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
    expect(ops.submitReport).not.toHaveBeenCalled();
    expect(log.some((l) => l.startsWith("remove"))).toBe(false);
    expect(uploaded).toEqual([`${USER}/draft-9/e-front.jpg`]);
  });

  it("a retry (e.g. after an app restart) skips finished uploads and uses the same submission id", async () => {
    let n = 0;
    const { store, ops, storage } = setup({
      submitReport: jest.fn(async () => (++n === 1 ? err("NETWORK_ERROR") : ok({ reportUuid: report(9).id, publicReportNumber: 100009, caseUuid: CASE, receivedAt: "t", created: false }))),
    });
    const uploaded: string[] = [];
    expect(await store.submitReport(completeDraft("draft-10"), { onUploaded: (p) => uploaded.push(p) })).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
    expect(storage.remove).not.toHaveBeenCalled(); // timeout != failure: the server may have the report
    (storage.upload as jest.Mock).mockClear();
    // Committed on the server although the response was lost: the retry returns that report.
    const again = await store.submitReport(completeDraft("draft-10"), { uploaded });
    expect(again).toEqual({ ok: true, value: { reportId: "100009", created: false } });
    expect(storage.upload).not.toHaveBeenCalled();
    expect((ops.submitReport as jest.Mock).mock.calls.map((c) => c[0].submissionId)).toEqual(["draft-10", "draft-10"]);
  });

  it("missing uploads on the server reset the recorded progress", async () => {
    const onUploadsInvalid = jest.fn();
    const { store } = setup({ submitReport: jest.fn(async () => err("EVIDENCE_NOT_UPLOADED")) });
    await store.submitReport(completeDraft("draft-11"), { uploaded: [`${USER}/draft-11/e-front.jpg`], onUploadsInvalid });
    expect(onUploadsInvalid).toHaveBeenCalled();
  });

  it("after success only orphans of this submission are removed, never the report's photos", async () => {
    const { store, storage } = setup();
    const stale = `${USER}/draft-12/old-retake.jpg`;
    await store.submitReport(completeDraft("draft-12"), { uploaded: [stale, `${USER}/draft-12/e-front.jpg`, "someone-else/x.jpg"] });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect((storage.remove as jest.Mock).mock.calls[0][1]).toEqual([stale]);
  });

  it("abandoning a draft removes only the user's own uploads", async () => {
    const { store, storage } = setup();
    await store.abandonSubmission([`${USER}/d/a.jpg`, "other-user/d/b.jpg"]);
    expect((storage.remove as jest.Mock).mock.calls[0][1]).toEqual([`${USER}/d/a.jpg`]);
  });

  it("an incomplete draft is refused before any upload", async () => {
    const { store, storage } = setup();
    const d = completeDraft("draft-13");
    delete d.photos.REAR;
    expect(await store.submitReport(d)).toMatchObject({ ok: false, error: { code: "INVALID_DRAFT" } });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe("ambiguous results (timeout != failure)", () => {
  const officer = (over: Partial<CoreOperations>) => setup(over, {}, "officer");

  it("complete: lost response but the server has the outcome -> success, not a fake failure", async () => {
    const { store } = officer({
      completeCase: jest.fn(async () => err("NETWORK_ERROR")),
      getCaseDetail: jest.fn(async () => ok(caseBundle({ status: "COMPLETED", assigned_officer_id: USER }, { outcomes: [{ case_id: CASE, code: "CHARGE_ISSUED", decided_by: USER, decided_at: "t", notes: null, parking_charge_amount_cents: 6000, inspection_id: null, id: "o", created_at: "t" }] as never }))),
    });
    expect(await store.completeCase(CASE, "CHARGE_ISSUED")).toEqual({ ok: true, value: { changed: true } });
  });

  it("complete: the server has a DIFFERENT outcome -> ALREADY_COMPLETED", async () => {
    const { store } = officer({
      completeCase: jest.fn(async () => err("NETWORK_ERROR")),
      getCaseDetail: jest.fn(async () => ok(caseBundle({ status: "COMPLETED" }, { outcomes: [{ case_id: CASE, code: "REPORT_REJECTED" }] as never }))),
    });
    expect(await store.completeCase(CASE, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "ALREADY_COMPLETED" } });
  });

  it("complete: the server has nothing -> the network failure stands (safe to retry)", async () => {
    const { store } = officer({ completeCase: jest.fn(async () => err("NETWORK_ERROR")) });
    expect(await store.completeCase(CASE, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
  });

  it("complete: the server cannot be re-checked either -> RESULT_UNKNOWN", async () => {
    const { store } = officer({ completeCase: jest.fn(async () => err("NETWORK_ERROR")), getCaseDetail: jest.fn(async () => err("NETWORK_ERROR")) });
    expect(await store.completeCase(CASE, "CHARGE_ISSUED")).toMatchObject({ ok: false, error: { code: "RESULT_UNKNOWN" } });
  });

  it("accept: lost response but the case is now mine -> success", async () => {
    const { store } = officer({
      acceptCase: jest.fn(async () => err("NETWORK_ERROR")),
      getCaseDetail: jest.fn(async () => ok(caseBundle({ status: "EN_ROUTE", assigned_officer_id: USER }))),
    });
    expect((await store.acceptCase(CASE)).ok).toBe(true);
  });

  it("accept: another officer took it meanwhile -> still a failure", async () => {
    const { store } = officer({
      acceptCase: jest.fn(async () => err("NETWORK_ERROR")),
      getCaseDetail: jest.fn(async () => ok(caseBundle({ status: "EN_ROUTE", assigned_officer_id: "someone-else" }))),
    });
    expect(await store.acceptCase(CASE)).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
  });

  it("a rule refusal (CASE_TAKEN) re-reads the case so the screen shows the truth", async () => {
    const { store, ops } = officer({ acceptCase: jest.fn(async () => err("CASE_TAKEN")) });
    expect(await store.acceptCase(CASE)).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
    await flush();
    expect(ops.getCaseDetail).toHaveBeenCalledWith(CASE);
  });

  it("officer photo: a server refusal removes the uploaded object; an unknown result keeps it", async () => {
    const refused = officer({ addOfficerEvidence: jest.fn(async () => err("CASE_TAKEN")) });
    expect(await refused.store.setOfficerPhoto(CASE, "PARKING_SIGN", "file:///x.jpg")).toMatchObject({ ok: false, error: { code: "CASE_TAKEN" } });
    expect(refused.log.some((l) => l.startsWith(`remove ${CASE}/PARKING_SIGN-`))).toBe(true);
    const unknown = officer({ addOfficerEvidence: jest.fn(async () => err("NETWORK_ERROR")), getCaseDetail: jest.fn(async () => err("NETWORK_ERROR")) });
    expect(await unknown.store.setOfficerPhoto(CASE, "PARKING_SIGN", "file:///x.jpg")).toMatchObject({ ok: false, error: { code: "RESULT_UNKNOWN" } });
    expect(unknown.log.some((l) => l.startsWith("remove"))).toBe(false);
  });

  it("a successful action refreshes and re-reads the case", async () => {
    const { store, ops } = officer({});
    await store.refresh();
    (ops.getOfficerSummary as jest.Mock).mockClear();
    expect((await store.startInspection(CASE)).ok).toBe(true);
    expect(ops.getOfficerSummary).toHaveBeenCalled();
    expect(ops.getCaseDetail).toHaveBeenCalledWith(CASE);
  });
});

describe("signed URLs", () => {
  const withPhoto = () =>
    setup({
      getCaseDetail: jest.fn(async () =>
        ok(caseBundle({}, { report_evidence: [{ id: "e1", report_id: report(1).id, slot: "FRONT", capture_source: "CAMERA", storage_path: `${USER}/d1/f.jpg`, captured_at: "t", created_at: "t" }] as never }))
      ),
    }, {}, "officer");

  it("a failed (expired) URL is re-signed once; repeated failures within a minute do not loop", async () => {
    const { store, storage, tick } = withPhoto();
    store.ensureCase(CASE);
    await flush();
    await flush();
    const first = store.getState()!.reports[0].evidence[0].uri;
    expect(first).toMatch(/^https:\/\/signed\//);
    expect(await store.refreshSignedUrl(first)).toBe(true);
    const second = store.getState()!.reports[0].evidence[0].uri;
    expect(second).not.toEqual(first);
    expect(await store.refreshSignedUrl(second)).toBe(false); // cooldown
    tick(61_000);
    expect(await store.refreshSignedUrl(second)).toBe(true);
    expect((storage.sign as jest.Mock).mock.calls.length).toBe(3);
  });

  it("an unknown URL (not ours) is never re-signed", async () => {
    const { store } = withPhoto();
    expect(await store.refreshSignedUrl("https://elsewhere/x.jpg")).toBe(false);
  });
});

describe("notifications", () => {
  it("mark read is skipped when nothing is unread", async () => {
    const { store, ops } = setup();
    await store.refresh();
    expect((await store.markNotificationsRead()).ok).toBe(true);
    expect(ops.markMyNotificationsRead).not.toHaveBeenCalled();
  });

  it("mark read with unread notifications calls the server and refreshes", async () => {
    const { store, ops } = setup({ getCitizenSummary: jest.fn(async () => ok({ ...citizenSummary, unread_notifications: 2 })) });
    await store.refresh();
    expect((await store.markNotificationsRead()).ok).toBe(true);
    expect(ops.markMyNotificationsRead).toHaveBeenCalled();
  });
});

describe("revoked visibility", () => {
  it("a fully successful refresh drops rows the server no longer returns", async () => {
    let visible = true;
    const { store, tick } = setup({ pageOfficerQueue: jest.fn(async () => ok(visible ? caseBundle() : emptyPage())) }, {}, "officer");
    store.ensureList({ kind: "queue", filter: "all" });
    await store.refresh();
    expect(store.getState()!.cases.map((c) => c.id)).toEqual([CASE]);
    visible = false; // e.g. membership deactivated
    tick(10_000);
    await store.refresh();
    expect(store.getState()!.cases).toEqual([]);
  });

  it("a case detail the user can no longer see is removed, not shown stale", async () => {
    let visible = true;
    const { store } = setup({ getCaseDetail: jest.fn(async () => ok(visible ? caseBundle() : { cases: [] })) }, {}, "officer");
    store.ensureCase(CASE);
    await flush();
    expect(store.getState()!.cases).toHaveLength(1);
    visible = false;
    store.ensureCase(CASE);
    await flush();
    expect(store.getState()!.cases).toHaveLength(0);
    expect(store.getCaseLoad(CASE)).toBe("loaded"); // settled: the screen shows "not found", not a spinner
  });
});

describe("pagination review (T8.4)", () => {
  it("switching back to a filter shown earlier reloads its page 1 once the data may have changed", async () => {
    const pageMyReports = jest.fn(async (status: unknown, _cursor?: unknown) => ok(status === "REJECTED" ? reportPage([7], null) : reportPage([1, 2], { ts: "t", id: "c" })));
    const { store, tick } = setup({ pageMyReports });
    const rejected: ListSpec = { kind: "reports", status: "REJECTED" };
    store.ensureList(ALL);
    await flush();
    store.loadMore(ALL); // the user scrolled
    await flush();
    store.ensureList(rejected); // switches tab
    await flush();
    store.ensureList(ALL); // and back, immediately: pages kept
    expect(pageMyReports).toHaveBeenCalledTimes(3);
    tick(6000);
    store.ensureList(ALL); // back after a while: starts over at page 1
    await flush();
    expect(pageMyReports).toHaveBeenCalledTimes(4);
    expect(pageMyReports.mock.calls.at(-1)?.[1]).toBeNull();
    expect(store.getList(ALL).ids).toEqual(["100001", "100002"]);
  });

  it("a slow page of one filter never lands in another filter's list", async () => {
    const slow = deferred<Result<PageBundle>>();
    const pageMyReports = jest.fn((status: unknown) => (status === "VERIFIED" ? slow.promise : Promise.resolve(ok(reportPage([1], null)))));
    const { store } = setup({ pageMyReports });
    const verified: ListSpec = { kind: "reports", status: "VERIFIED" };
    store.ensureList(verified);
    store.ensureList(ALL);
    await flush();
    slow.resolve(ok(reportPage([5], null)));
    await flush();
    expect(store.getList(ALL).ids).toEqual(["100001"]);
    expect(store.getList(verified).ids).toEqual(["100005"]);
  });

  it("an empty state is only possible once the first page has settled", async () => {
    const d = deferred<Result<PageBundle>>();
    const { store } = setup({ pageMyReports: jest.fn(() => d.promise) });
    store.ensureList(ALL);
    await flush();
    expect(store.getList(ALL)).toMatchObject({ loaded: false, loading: true, ids: [] });
    d.resolve(ok(emptyPage()));
    await flush();
    expect(store.getList(ALL)).toMatchObject({ loaded: true, loading: false, ids: [] });
  });
});

describe("signed URL review (T8.4)", () => {
  it("an object the user may not read stays unavailable (no URL, no retry loop)", async () => {
    const { store, storage } = setup(
      { getCaseDetail: jest.fn(async () => ok(caseBundle({}, { report_evidence: [{ id: "e1", report_id: report(1).id, slot: "FRONT", capture_source: "CAMERA", storage_path: `${USER}/d1/f.jpg`, captured_at: "t", created_at: "t" }] as never }))) },
      { sign: jest.fn(async () => ({})) },
      "officer"
    );
    store.ensureCase(CASE);
    await flush();
    await flush();
    const uri = store.getState()!.reports[0].evidence[0].uri;
    expect(uri.startsWith("parkwatch-storage://")).toBe(true); // rendered as "Photo unavailable"
    expect(await store.refreshSignedUrl(uri)).toBe(false);
    expect(storage.sign).toHaveBeenCalledTimes(1);
  });
});

describe("officer cache security review (T8.4)", () => {
  it("sign-out clears protected data; another user's new store starts empty", async () => {
    const a = setup({ pageOfficerQueue: jest.fn(async () => ok(caseBundle())) }, {}, "officer");
    a.store.ensureList({ kind: "queue", filter: "all" });
    await a.store.refresh();
    expect(a.store.getState()!.cases).toHaveLength(1);
    a.store.dispose();
    expect(a.store.getState()).toBeNull();
    expect(a.store.getList({ kind: "queue", filter: "all" }).ids).toEqual([]);
    const b = setup({}, {}, "officer"); // the next account gets its own store
    await b.store.refresh();
    expect(b.store.getState()!.cases).toEqual([]);
  });
});

describe("session check on storage auth failures (T8.5)", () => {
  const { StorageApiError } = jest.requireActual("@supabase/storage-js");
  const { createEvidenceStorage } = jest.requireActual("../storage/evidenceStorage");
  const storageFailingWith = (error: unknown) =>
    createEvidenceStorage({ storage: { from: () => ({ upload: async () => ({ data: null, error }), remove: async () => ({}) }) } } as never, async () => new ArrayBuffer(4));

  it("an invalid-signature upload failure refuses the submit AND asks the auth layer to re-check the session", async () => {
    const invalid = new StorageApiError("signature verification failed", 400, "403", "storage", "AccessDenied");
    const { store, ops, onUnauthenticated } = setup({}, storageFailingWith(invalid));
    const r = await store.submitReport(completeDraft("draft-auth-1"));
    expect(r).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(onUnauthenticated).toHaveBeenCalled();
    expect(ops.submitReport).not.toHaveBeenCalled();
  });

  it("an ordinary RLS storage denial refuses the submit WITHOUT triggering a session check (no sign-out)", async () => {
    const rls = new StorageApiError("new row violates row-level security policy", 400, "403", "storage", "AccessDenied");
    const { store, ops, onUnauthenticated } = setup({}, storageFailingWith(rls));
    const r = await store.submitReport(completeDraft("draft-auth-2"));
    expect(r).toMatchObject({ ok: false, error: { code: "UPLOAD_FAILED" } });
    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(ops.submitReport).not.toHaveBeenCalled();
  });
});
