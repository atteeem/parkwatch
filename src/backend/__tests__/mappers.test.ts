import {
  CHECKLIST_KEYS,
  createCitizenEvidence,
  createOfficerEvidence,
  DEFAULT_MOCK_CHARGE_AMOUNT_CENTS,
  ENFORCEMENT_OUTCOME_CODES,
  EnforcementOutcome,
  InspectionChecklist,
  Notification,
  OfficerCase,
  Report,
  RewardLedgerEntry,
} from "../../domain";
import { submittedReport } from "../../domain/__tests__/fixtures";
import { citizenEvidenceFromRow, citizenEvidenceToInsert, reportFromRow, reportToInsert } from "../mappers/reports";
import {
  caseFromRow,
  caseStatusTimestampsToColumns,
  checklistFromRows,
  checklistToRows,
  officerEvidenceFromRow,
  officerEvidenceToInsert,
  outcomeFromRow,
  outcomeToInsert,
} from "../mappers/enforcement";
import { ledgerEntryFromRow, ledgerEntryToInsert, notificationFromRow, notificationToInsert } from "../mappers/rewards";
import { caseEventsToAudit, reportEventsToAudit, sanitizeAuditMetadata } from "../mappers/audit";
import { parseStorageUri, validateStoragePath } from "../mappers/common";
import {
  BackendCaseRow,
  BackendCitizenEvidenceInsert,
  BackendCitizenEvidenceRow,
  BackendLedgerRow,
  BackendNotificationRow,
  BackendOfficerEvidenceInsert,
  BackendOfficerEvidenceRow,
  BackendOutcomeRow,
  BackendReportInsert,
  BackendReportRow,
} from "../types";

const CITIZEN = "11111111-1111-4111-8111-111111111111";
const OFFICER = "22222222-2222-4222-8222-222222222222";
const REPORT_UUID = "33333333-3333-4333-8333-333333333333";
const CASE_UUID = "44444444-4444-4444-8444-444444444444";
const INSPECTION_UUID = "55555555-5555-4555-8555-555555555555";
const T = "2026-10-05T10:00:00.000Z";
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

/** What the database would return for an insert (server-owned columns filled in). */
function asStoredReport(insert: BackendReportInsert, number: number): BackendReportRow {
  return {
    ...insert,
    id: REPORT_UUID,
    public_report_number: number,
    status: "UNDER_REVIEW",
    priority: "NORMAL",
    received_at: "2026-10-05T10:00:03.000Z",
    resolved_at: null,
    incident_id: null,
    created_at: T,
    updated_at: T,
  };
}

describe("reports", () => {
  const report: Report = {
    ...submittedReport(),
    location: { address: "Mannerheimintie 45, Helsinki", coordinates: { latitude: 60.1699, longitude: 24.9384, accuracyMeters: 6, capturedAt: T } },
    vehicle: { plate: { raw: "GHC-789", normalized: "GHC789", country: "FI" }, make: "Volvo", model: "XC60", color: "Dark Grey", source: "MOCK_DETECTED" },
  };

  it("domain -> insert carries only citizen-writable columns", () => {
    const insert = unwrap(reportToInsert(report, { citizenUuid: CITIZEN }));
    expect(insert).toMatchObject({ citizen_id: CITIZEN, violation_type: report.violationId, plate_normalized: "GHC789", latitude: 60.1699, location_accuracy_m: 6 });
    for (const serverOwned of ["id", "public_report_number", "status", "priority", "received_at", "resolved_at"]) {
      expect(insert).not.toHaveProperty(serverOwned);
    }
  });

  it("T8.7: GPS report -> insert keeps source GPS with its accuracy and capture time", () => {
    const gps: Report = { ...report, location: { ...report.location, coordinatesSource: "GPS" } };
    const insert = unwrap(reportToInsert(gps, { citizenUuid: CITIZEN }));
    expect(insert).toMatchObject({ latitude: 60.1699, longitude: 24.9384, location_source: "GPS", location_accuracy_m: 6, location_captured_at: T });
    // A point without a stated source is GPS (older data); no point -> no source.
    expect(unwrap(reportToInsert(report, { citizenUuid: CITIZEN })).location_source).toBe("GPS");
    const addressOnly = unwrap(reportToInsert({ ...report, location: { address: "Kaivokatu 1" } }, { citizenUuid: CITIZEN }));
    expect(addressOnly).toMatchObject({ latitude: null, location_source: null, location_accuracy_m: null, location_captured_at: null });
  });

  it("T8.7: MAP_SELECTED report -> insert has no accuracy/capture time and no raw device fix", () => {
    const picked: Report = {
      ...report,
      // Even if stale GPS metadata reached the point, a map-picked point never carries it.
      location: { address: "Kaivokatu 1", coordinates: { latitude: 60.1712, longitude: 24.9411, accuracyMeters: 25, capturedAt: T }, coordinatesSource: "MAP_SELECTED" },
    };
    const insert = unwrap(reportToInsert(picked, { citizenUuid: CITIZEN }));
    expect(insert).toMatchObject({ latitude: 60.1712, longitude: 24.9411, location_source: "MAP_SELECTED", location_accuracy_m: null, location_captured_at: null });
    expect(Object.keys(insert).filter((k) => k.startsWith("device"))).toEqual([]);
  });

  it("T8.7: location provenance from the row: map-picked point has no GPS metadata; a point without a source is GPS", () => {
    const insert = unwrap(reportToInsert(report, { citizenUuid: CITIZEN }));
    const picked = reportFromRow(
      { ...asStoredReport(insert, 100024), latitude: 60.1712, longitude: 24.9411, location_accuracy_m: null, location_captured_at: null, location_source: "MAP_SELECTED" },
      []
    );
    expect(picked.report.location).toEqual({
      address: "Mannerheimintie 45, Helsinki",
      coordinates: { latitude: 60.1712, longitude: 24.9411 },
      coordinatesSource: "MAP_SELECTED",
    });
    const legacy = reportFromRow({ ...asStoredReport(insert, 100025), location_source: null }, []);
    expect(legacy.report.location.coordinatesSource).toBe("GPS");
    expect(legacy.report.location).toEqual({ ...report.location, coordinatesSource: "GPS" });
  });

  it("round trip: same report data; public number and uuid stay separate", () => {
    const insert = unwrap(reportToInsert(report, { citizenUuid: CITIZEN }));
    const mapped = reportFromRow(asStoredReport(insert, 100023), [], { caseId: CASE_UUID });
    expect(mapped.uuid).toBe(REPORT_UUID);
    expect(mapped.publicNumber).toBe(100023);
    expect(mapped.report.id).toBe("100023");
    expect(mapped.report.id).not.toBe(mapped.uuid);
    expect(mapped.report).toMatchObject({
      violationId: report.violationId,
      location: report.location,
      vehicle: report.vehicle,
      observedAt: report.observedAt,
      submittedAt: report.submittedAt,
      status: "UNDER_REVIEW",
      receivedAt: "2026-10-05T10:00:03.000Z", // trusted server time arrives only from the backend
      caseId: CASE_UUID,
    });
  });

  it("refuses an owner that is not a real (uuid) user", () => {
    expect(reportToInsert(report, { citizenUuid: "citizen-demo" })).toMatchObject({ ok: false, error: { code: "INVALID_DATA" } });
  });
});

describe("evidence: citizen and officer can never be interchanged", () => {
  const front = createCitizenEvidence({ id: "e1", type: "FRONT", captureSource: "CAMERA", uri: "file:///front.jpg", capturedAt: T });
  const sign = createOfficerEvidence({ id: "e2", type: "PARKING_SIGN", captureSource: "CAMERA", uri: "file:///sign.jpg", capturedAt: T });

  it("citizen evidence maps to the citizen table shape (slot), officer to the officer shape (evidence_type)", () => {
    const c = unwrap(citizenEvidenceToInsert(front, { reportUuid: REPORT_UUID, storagePath: `citizen/${REPORT_UUID}/front.jpg` }));
    const o = unwrap(officerEvidenceToInsert(sign, { inspectionUuid: INSPECTION_UUID, caseUuid: CASE_UUID, storagePath: `officer/${CASE_UUID}/sign.jpg` }));
    expect(c).toEqual({ report_id: REPORT_UUID, slot: "FRONT", capture_source: "CAMERA", storage_path: `citizen/${REPORT_UUID}/front.jpg`, captured_at: T });
    expect(o).toMatchObject({ inspection_id: INSPECTION_UUID, case_id: CASE_UUID, evidence_type: "PARKING_SIGN", capture_source: "CAMERA" });
    expect(c).not.toHaveProperty("evidence_type");
    expect(o).not.toHaveProperty("slot");
  });

  it("runtime guards refuse the wrong kind (even with casts)", () => {
    expect(citizenEvidenceToInsert(sign as never, { reportUuid: REPORT_UUID, storagePath: "citizen/x.jpg" })).toMatchObject({ ok: false, error: { code: "INVALID_DATA" } });
    expect(officerEvidenceToInsert(front as never, { inspectionUuid: INSPECTION_UUID, caseUuid: CASE_UUID, storagePath: "officer/x.jpg" })).toMatchObject({ ok: false, error: { code: "INVALID_DATA" } });
  });

  it("the types refuse it at compile time too", () => {
    // @ts-expect-error officer evidence is not citizen evidence
    citizenEvidenceToInsert(sign, { reportUuid: REPORT_UUID, storagePath: "a.jpg" });
    // @ts-expect-error citizen evidence is not officer evidence
    officerEvidenceToInsert(front, { inspectionUuid: INSPECTION_UUID, caseUuid: CASE_UUID, storagePath: "a.jpg" });
    // @ts-expect-error the insert shapes are not assignable to each other
    const swapped: BackendOfficerEvidenceInsert = {} as BackendCitizenEvidenceInsert;
    expect(swapped).toBeDefined();
  });

  it("library images never fill required slots on either side; attachments may be library", () => {
    const libFront = createCitizenEvidence({ id: "e3", type: "FRONT", captureSource: "LIBRARY", uri: "file:///x.jpg", capturedAt: T });
    const libExtra = createCitizenEvidence({ id: "e4", type: "ATTACHMENT", captureSource: "LIBRARY", uri: "file:///y.jpg", capturedAt: T });
    const libSign = { ...sign, captureSource: "LIBRARY" as const };
    expect(citizenEvidenceToInsert(libFront, { reportUuid: REPORT_UUID, storagePath: "c/x.jpg" }).ok).toBe(false);
    expect(citizenEvidenceToInsert(libExtra, { reportUuid: REPORT_UUID, storagePath: "c/y.jpg" }).ok).toBe(true);
    expect(officerEvidenceToInsert(libSign, { inspectionUuid: INSPECTION_UUID, caseUuid: CASE_UUID, storagePath: "o/s.jpg" }).ok).toBe(false);
  });

  it("evidence rows store a storage path, never a device URI; reads give a storage reference", () => {
    for (const bad of ["file:///data/x.jpg", "content://media/1", "https://x.supabase.co/a.jpg", "../etc/passwd", ""]) {
      expect(validateStoragePath(bad).ok).toBe(false);
    }
    const row: BackendCitizenEvidenceRow = { id: "ev", report_id: REPORT_UUID, slot: "REAR", capture_source: "CAMERA", storage_path: "citizen/r/rear.jpg", captured_at: T, created_at: T };
    const ev = citizenEvidenceFromRow(row);
    expect(ev).toMatchObject({ source: "CITIZEN", type: "REAR" });
    expect(parseStorageUri(ev.uri)).toEqual({ bucket: "report-evidence", path: "citizen/r/rear.jpg" });
    const orow: BackendOfficerEvidenceRow = { id: "ov", inspection_id: INSPECTION_UUID, case_id: CASE_UUID, evidence_type: "LICENSE_PLATE", capture_source: "CAMERA", storage_path: "officer/c/plate.jpg", captured_at: T, created_at: T };
    expect(officerEvidenceFromRow(orow)).toMatchObject({ source: "OFFICER", type: "LICENSE_PLATE" });
    expect(parseStorageUri(officerEvidenceFromRow(orow).uri)?.bucket).toBe("officer-evidence");
  });
});

describe("cases, inspections, outcomes", () => {
  it("case status timestamps survive the round trip", () => {
    const statusTimestamps: OfficerCase["statusTimestamps"] = { NEW: T, ASSIGNED: "2026-10-05T10:01:00.000Z", EN_ROUTE: "2026-10-05T10:01:00.000Z", INSPECTION: "2026-10-05T10:09:00.000Z" };
    const row: BackendCaseRow = {
      id: CASE_UUID, report_id: REPORT_UUID, jurisdiction_id: "helsinki-demo", status: "INSPECTION", priority: "HIGH",
      assigned_officer_id: OFFICER, created_at: T, updated_at: T, ...caseStatusTimestampsToColumns({ statusTimestamps }),
    };
    const c = caseFromRow(row, { reportId: "100023" });
    expect(c).toMatchObject({ id: CASE_UUID, reportId: "100023", status: "INSPECTION", assignedOfficerId: OFFICER, priority: "HIGH" });
    expect(c.statusTimestamps).toEqual(statusTimestamps);
  });

  it("tri-state checks: yes / no / unanswered survive mapping (no is not unanswered)", () => {
    const checklist: InspectionChecklist = { vehiclePresent: true, plateMatches: false, violationConfirmed: null, restrictionVerified: null };
    const rows = checklistToRows(INSPECTION_UUID, checklist, T);
    expect(rows).toHaveLength(CHECKLIST_KEYS.length);
    expect(rows.find((r) => r.check_key === "plateMatches")).toEqual({ inspection_id: INSPECTION_UUID, check_key: "plateMatches", answer: false, answered_at: T });
    expect(rows.find((r) => r.check_key === "violationConfirmed")).toMatchObject({ answer: null, answered_at: null });
    expect(checklistFromRows(rows)).toEqual(checklist);
    expect(checklistFromRows([])).toEqual({ vehiclePresent: null, plateMatches: null, violationConfirmed: null, restrictionVerified: null });
  });

  it.each(ENFORCEMENT_OUTCOME_CODES)("%s survives the round trip", (code) => {
    const outcome: EnforcementOutcome = {
      code,
      decidedAt: T,
      officerId: OFFICER,
      ...(code === "CHARGE_ISSUED" ? { chargeAmountCents: DEFAULT_MOCK_CHARGE_AMOUNT_CENTS } : {}),
      notes: "note",
    };
    const insert = unwrap(outcomeToInsert(outcome, { caseUuid: CASE_UUID, inspectionUuid: INSPECTION_UUID, decidedByUuid: OFFICER }));
    expect(insert.parking_charge_amount_cents).toBe(code === "CHARGE_ISSUED" ? 6000 : null);
    const row: BackendOutcomeRow = { ...insert, id: "o1", created_at: T };
    expect(outcomeFromRow(row)).toEqual(outcome);
  });

  it("parking charge amounts stay integer cents; only CHARGE_ISSUED has one", () => {
    const base = { decidedAt: T, officerId: OFFICER };
    expect(outcomeToInsert({ ...base, code: "CHARGE_ISSUED", chargeAmountCents: 60.5 }, { caseUuid: CASE_UUID, decidedByUuid: OFFICER }).ok).toBe(false);
    expect(outcomeToInsert({ ...base, code: "VEHICLE_MOVED", chargeAmountCents: 6000 }, { caseUuid: CASE_UUID, decidedByUuid: OFFICER }).ok).toBe(false);
  });
});

describe("reward ledger and notifications", () => {
  const W = "66666666-6666-4666-8666-666666666666";

  it("ledger entry round trip keeps the idempotency key and integer cents", () => {
    const entry: RewardLedgerEntry = { id: "l1", idempotencyKey: "REWARD_PENDING:100023", citizenId: CITIZEN, type: "REWARD_PENDING", amountCents: 500, reportId: "100023", createdAt: T };
    const insert = unwrap(ledgerEntryToInsert(entry, { citizenUuid: CITIZEN, reportUuid: REPORT_UUID }));
    expect(insert).toEqual({ citizen_id: CITIZEN, entry_type: "REWARD_PENDING", amount_cents: 500, report_id: REPORT_UUID, withdrawal_id: null, idempotency_key: "REWARD_PENDING:100023", created_at: T });
    const row: BackendLedgerRow = { ...insert, id: "l1", created_at: T };
    expect(ledgerEntryFromRow(row, (u) => (u === REPORT_UUID ? "100023" : undefined))).toEqual(entry);
    expect(Number.isInteger(insert.amount_cents)).toBe(true);
  });

  it("refuses fractional or missing amounts and unlinked entries", () => {
    const base: RewardLedgerEntry = { id: "x", idempotencyKey: "k", citizenId: CITIZEN, type: "WITHDRAWAL_REQUESTED", amountCents: 1000, withdrawalId: "w1", createdAt: T };
    expect(ledgerEntryToInsert({ ...base, amountCents: 10.5 }, { citizenUuid: CITIZEN, withdrawalUuid: W }).ok).toBe(false);
    expect(ledgerEntryToInsert({ ...base, amountCents: 0 }, { citizenUuid: CITIZEN, withdrawalUuid: W }).ok).toBe(false);
    expect(ledgerEntryToInsert(base, { citizenUuid: CITIZEN }).ok).toBe(false); // withdrawal without id
    expect(ledgerEntryToInsert({ ...base, type: "REWARD_RELEASED", reportId: "1" }, { citizenUuid: CITIZEN }).ok).toBe(false); // reward without report
    expect(unwrap(ledgerEntryToInsert(base, { citizenUuid: CITIZEN, withdrawalUuid: W }))).toMatchObject({ withdrawal_id: W, report_id: null });
  });

  it("notification links (report and case) survive mapping; non-SYSTEM types carry no free text", () => {
    const n: Notification = {
      id: "n1", idempotencyKey: "REPORT_VERIFIED:100023", recipient: { role: "CITIZEN", accountId: CITIZEN }, type: "REPORT_VERIFIED",
      createdAt: T, reportId: "100023", caseId: CASE_UUID, amountCents: 500, title: "ignored for non-system",
    };
    const insert = unwrap(notificationToInsert(n, { recipientUuid: CITIZEN, reportUuid: REPORT_UUID, caseUuid: CASE_UUID }));
    expect(insert).toMatchObject({ report_id: REPORT_UUID, case_id: CASE_UUID, amount_cents: 500, title: null, body: null });
    const row: BackendNotificationRow = { ...insert, id: "n1", created_at: T, read_at: null };
    const back = notificationFromRow(row, (u) => (u === REPORT_UUID ? "100023" : undefined));
    expect(back).toMatchObject({ reportId: "100023", caseId: CASE_UUID, amountCents: 500, recipient: { role: "CITIZEN", accountId: CITIZEN } });
    expect(notificationToInsert(n, { recipientUuid: CITIZEN })).toMatchObject({ ok: false }); // report link required
  });
});

describe("audit events", () => {
  it("report and case history map to audit rows with safe metadata only", () => {
    const report = submittedReport();
    const rows = reportEventsToAudit(REPORT_UUID, report.events, () => CITIZEN);
    expect(rows[0]).toMatchObject({ entity_type: "report", entity_id: REPORT_UUID, event_type: "REPORT_SUBMITTED", actor_user_id: CITIZEN, actor_role: "CITIZEN" });
    const caseRows = caseEventsToAudit(CASE_UUID, [
      { type: "CREATED", at: T, to: "NEW", actor: { role: "SYSTEM", accountId: "system" }, source: "SYSTEM" },
      { type: "STATUS_CHANGED", at: T, from: "NEW", to: "ASSIGNED", actor: { role: "OFFICER", accountId: OFFICER }, source: "USER_ACTION" },
    ], (a) => (a.role === "OFFICER" ? OFFICER : null));
    expect(caseRows.map((r) => [r.event_type, r.actor_user_id])).toEqual([["CASE_CREATED", null], ["CASE_ACCEPTED", OFFICER]]);
    expect(sanitizeAuditMetadata({ code: "CHARGE_ISSUED", password: "x", token: "t", image_base64: "AAA", uri: "file:///a.jpg", note: "data:image/png;base64,AAA", n: 1 })).toEqual({ code: "CHARGE_ISSUED", n: 1 });
  });
});
