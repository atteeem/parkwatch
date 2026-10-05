// Offline unit tests: RPC error mapping, snapshot -> domain state, storage helpers.
import { isAlreadyExists, mapRpcError } from "../operations/rpcErrors";
import { snapshotToState } from "../mappers/snapshot";
import { storageUri } from "../mappers/common";
import { createEvidenceStorage, imageTypeOf, officerEvidencePath, reportEvidencePath, safeSegment } from "../storage/evidenceStorage";
import { createCoreOperations } from "../operations/coreOperations";
import { calculateBalances, getRewardState } from "../../domain";
import { selectCitizenReports } from "../../presentation/viewModels";

const CIT = "11111111-1111-4111-8111-111111111111";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("mapRpcError", () => {
  it.each([
    ["CASE_TAKEN: Another officer has this case.", "CASE_TAKEN"],
    ["INSPECTION_NOT_READY: x", "INSPECTION_NOT_READY"],
    ["EVIDENCE_NOT_UPLOADED: x", "EVIDENCE_NOT_UPLOADED"],
    ["NO_JURISDICTION: x", "NO_JURISDICTION"],
    ["FORBIDDEN: x", "FORBIDDEN"],
    ["SOMETHING_NEW: x", "BACKEND_ERROR"],
  ])("P0001 %s -> %s", (message, code) => {
    expect(mapRpcError({ code: "P0001", message })).toEqual({ code, message: code });
  });

  it("never passes raw server text through", () => {
    const e = mapRpcError({ code: "42501", message: 'permission denied for table "reports"' }, 403);
    expect(e).toEqual({ code: "FORBIDDEN", message: "FORBIDDEN" });
  });

  it("transport failures become NETWORK_ERROR", () => {
    expect(mapRpcError({ message: "TypeError: Failed to fetch" }).code).toBe("NETWORK_ERROR");
    expect(mapRpcError({ message: "Network request failed" }).code).toBe("NETWORK_ERROR");
    expect(mapRpcError({ message: "fetch failed" }).code).toBe("NETWORK_ERROR");
  });

  it("auth and lookup errors", () => {
    expect(mapRpcError({ code: "PGRST301", message: "JWT expired" }).code).toBe("UNAUTHENTICATED");
    expect(mapRpcError({ code: "22P02", message: "invalid input syntax for type uuid" }).code).toBe("NOT_FOUND");
  });

  it("storage duplicate counts as already uploaded", () => {
    expect(isAlreadyExists({ statusCode: "409", message: "The resource already exists" })).toBe(true);
    expect(isAlreadyExists({ status: 403, message: "row-level security" })).toBe(false);
  });
});

describe("snapshotToState", () => {
  const report = {
    id: R1,
    public_report_number: 100005,
    citizen_id: CIT,
    source_draft_id: "draft-1",
    jurisdiction_id: "helsinki-demo",
    status: "UNDER_REVIEW",
    violation_type: "no-parking",
    plate_raw: "ABC-123",
    plate_normalized: "ABC123",
    plate_country: "FI",
    vehicle_make: null,
    vehicle_model: null,
    vehicle_color: null,
    vehicle_source: "MOCK_DETECTED",
    location_address: "Street 1",
    latitude: 60.1,
    longitude: 24.9,
    location_accuracy_m: null,
    location_captured_at: null,
    notes: "",
    observed_at: "2026-10-01T10:00:00Z",
    submitted_at: "2026-10-01T10:00:00Z",
    received_at: "2026-10-01T10:00:01Z",
    resolved_at: null,
    incident_id: null,
    priority: "NORMAL",
    created_at: "2026-10-01T10:00:01Z",
    updated_at: "2026-10-01T10:00:01Z",
  };
  const evidence = { id: "e1", report_id: R1, slot: "FRONT", capture_source: "CAMERA", storage_path: `${CIT}/draft-1/e1.jpg`, captured_at: "2026-10-01T10:00:00Z", created_at: "x" };
  const ledger = (type: string, key: string) => ({ id: key, citizen_id: CIT, entry_type: type, amount_cents: 500, report_id: R1, withdrawal_id: null, idempotency_key: key, created_at: "2026-10-01T10:00:02Z" });

  it("uses the public number as the report id, translates references and resolves photos", () => {
    const s = snapshotToState(
      {
        reports: [report],
        report_evidence: [evidence],
        cases: [{ id: C1, report_id: R1, jurisdiction_id: "helsinki-demo", status: "NEW", priority: "NORMAL", assigned_officer_id: null, created_at: "x", updated_at: "x", assigned_at: null, en_route_at: null, on_site_at: null, inspection_started_at: null, completed_at: null }],
        ledger: [ledger("REWARD_PENDING", `REWARD_PENDING:${R1}`)],
        notifications: [{ id: "n1", recipient_id: CIT, recipient_role: "CITIZEN", type: "REPORT_UNDER_REVIEW", report_id: R1, case_id: null, amount_cents: null, title: null, body: null, display_hint: null, idempotency_key: "k", created_at: "x", read_at: null }],
      } as never,
      (u) => (u === storageUri("report-evidence", evidence.storage_path) ? "https://signed.example/e1?token=t" : u)
    );
    expect(s.reports[0]).toMatchObject({ id: "100005", caseId: C1 });
    expect(s.reports[0].evidence[0].uri).toBe("https://signed.example/e1?token=t");
    expect(s.cases[0]).toMatchObject({ id: C1, reportId: "100005" });
    expect(s.notifications[0].reportId).toBe("100005");
    expect(s.vehicles).toEqual([]);
    expect(s.parkingSessions).toEqual([]);
  });

  it("server reward entries drive the domain reward state and balances", () => {
    const pending = snapshotToState({ reports: [report], ledger: [ledger("REWARD_PENDING", `REWARD_PENDING:${R1}`)] } as never);
    expect(getRewardState(pending.ledger, "100005")).toBe("PENDING");
    expect(calculateBalances(pending.ledger, CIT)).toMatchObject({ pendingCents: 500, availableCents: 0 });
    const released = snapshotToState({ reports: [report], ledger: [ledger("REWARD_PENDING", `REWARD_PENDING:${R1}`), ledger("REWARD_RELEASED", `REWARD_RELEASED:${R1}`)] } as never);
    expect(calculateBalances(released.ledger, CIT)).toMatchObject({ pendingCents: 0, availableCents: 500 });
    expect(selectCitizenReports(released, CIT)[0].rewardState).toBe("rewarded");
    const voided = snapshotToState({ reports: [report], ledger: [ledger("REWARD_PENDING", `REWARD_PENDING:${R1}`), ledger("REWARD_VOIDED", `REWARD_VOIDED:${R1}`)] } as never);
    expect(calculateBalances(voided.ledger, CIT)).toMatchObject({ pendingCents: 0, availableCents: 0 });
  });

  it("unsigned photos stay storage references (rendered as 'photo unavailable')", () => {
    const s = snapshotToState({ reports: [report], report_evidence: [evidence] } as never);
    expect(s.reports[0].evidence[0].uri.startsWith("parkwatch-storage://")).toBe(true);
  });

  it("tolerates missing keys and drops cases whose report is not visible", () => {
    const s = snapshotToState({ cases: [{ id: C1, report_id: R1 }] } as never);
    expect(s.cases).toEqual([]);
    expect(snapshotToState(null as never).reports).toEqual([]);
  });
});

describe("evidence storage helpers", () => {
  it("deterministic, safe paths", () => {
    expect(reportEvidencePath(CIT, "draft-1", "draft-1-FRONT", "jpg")).toBe(`${CIT}/draft-1/draft-1-FRONT.jpg`);
    expect(officerEvidencePath(C1, "x/../y", "jpg")).toBe(`${C1}/x____y.jpg`);
    expect(safeSegment("a.b/c")).toBe("a_b_c");
    expect(imageTypeOf("file:///a/b.PNG")).toEqual({ ext: "png", contentType: "image/png" });
    expect(imageTypeOf("content://media/123")).toEqual({ ext: "jpg", contentType: "image/jpeg" });
  });

  it("upload uses upsert:false and never a public URL; duplicate = created:false", async () => {
    const calls: unknown[][] = [];
    let error: unknown = null;
    const bucket = {
      upload: async (...a: unknown[]) => (calls.push(["upload", ...a]), { data: {}, error }),
      remove: async (...a: unknown[]) => (calls.push(["remove", ...a]), { data: [], error: null }),
      createSignedUrls: async (paths: string[], ttl: number) => (calls.push(["sign", paths, ttl]), { data: paths.map((p) => ({ path: p, signedUrl: `https://s/${p}?token=1`, error: null })), error: null }),
      getPublicUrl: () => {
        throw new Error("must not be called");
      },
    };
    const client = { storage: { from: () => bucket } } as never;
    const s = createEvidenceStorage(client, async () => new ArrayBuffer(4));
    expect(await s.upload("report-evidence", "p.jpg", "file:///p.jpg")).toEqual({ ok: true, value: { created: true } });
    expect((calls[0][3] as { upsert: boolean }).upsert).toBe(false);
    error = { statusCode: "409", message: "The resource already exists" };
    expect(await s.upload("report-evidence", "p.jpg", "file:///p.jpg")).toEqual({ ok: true, value: { created: false } });
    error = { statusCode: "403", message: "new row violates row-level security policy" };
    expect(await s.upload("report-evidence", "p.jpg", "file:///p.jpg")).toMatchObject({ ok: false, error: { code: "UPLOAD_FAILED" } });
    expect(await s.sign("report-evidence", ["a", "a", "b"])).toEqual({ a: "https://s/a?token=1", b: "https://s/b?token=1" });
    expect(calls.find((c) => c[0] === "sign")).toEqual(["sign", ["a", "b"], 3600]);
  });

  it("a local file that can't be read is an upload failure (nothing sent)", async () => {
    const upload = jest.fn();
    const s = createEvidenceStorage({ storage: { from: () => ({ upload }) } } as never, async () => {
      throw new Error("gone");
    });
    expect(await s.upload("report-evidence", "p.jpg", "file:///p.jpg")).toMatchObject({ ok: false, error: { code: "UPLOAD_FAILED" } });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("core operations (RPC wrappers)", () => {
  function fakeClient(result: { data: unknown; error: unknown; status?: number }) {
    const calls: [string, Record<string, unknown>][] = [];
    return { calls, client: { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push([fn, args]), result) } as never };
  }

  it("complete_case sends only case, code and notes (no amount)", async () => {
    const { calls, client } = fakeClient({ data: { changed: true, credited_cents: 500 }, error: null });
    const r = await createCoreOperations(client).completeCase(C1, "CHARGE_ISSUED", "  ");
    expect(r).toEqual({ ok: true, value: { changed: true, creditedCents: 500 } });
    expect(calls).toEqual([["complete_case", { p_case_id: C1, p_code: "CHARGE_ISSUED", p_notes: null }]]);
  });

  it("a non-uuid case id never reaches the server", async () => {
    const { calls, client } = fakeClient({ data: null, error: null });
    expect(await createCoreOperations(client).acceptCase("c-12600")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(calls).toEqual([]);
  });

  it("submit_report arguments contain no trusted fields", async () => {
    const { calls, client } = fakeClient({ data: { report_id: R1, public_report_number: 100009, case_id: C1, received_at: "t", created: true }, error: null });
    await createCoreOperations(client).submitReport({
      submissionId: "d",
      violationType: "no-parking",
      locationAddress: "a",
      observedAt: "t",
      submittedAt: "t",
      evidence: [],
      notes: "",
    });
    const keys = Object.keys(calls[0][1]);
    for (const k of keys) expect(k).not.toMatch(/citizen|status|number|reward|amount|received|priority|officer|jurisdiction/);
  });

  it("server rule errors map to codes", async () => {
    const { client } = fakeClient({ data: null, error: { code: "P0001", message: "ALREADY_COMPLETED: x" }, status: 400 });
    expect(await createCoreOperations(client).completeCase(C1, "OTHER")).toMatchObject({ ok: false, error: { code: "ALREADY_COMPLETED" } });
  });
});
