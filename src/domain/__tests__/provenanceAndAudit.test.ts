import { CITIZEN, completeDraft, enforcementState, JURISDICTION, OFFICER, readyInspection, submittedReport, T0, T1, T2 } from "./fixtures";
import {
  attachOfficerEvidence,
  CaptureSource,
  completeCaseWithOutcome,
  countCapturedOfficerEvidence,
  createCitizenEvidence,
  createInspection,
  createOfficerEvidence,
  errorCode,
  isRequiredEvidenceCaptured,
  qualifiesAsRequiredEvidence,
  ReportDraft,
  unwrap,
  validateDraft,
} from "./testHelpers";

const citizenPhoto = (type: "FRONT" | "SIDE" | "REAR", captureSource: CaptureSource) =>
  createCitizenEvidence({ id: `e-${type}`, type, captureSource, uri: `file:///${type}.jpg`, capturedAt: T0 });

describe("evidence provenance: citizen required photos", () => {
  it("CAMERA and SEED qualify; LIBRARY never does", () => {
    expect(qualifiesAsRequiredEvidence({ captureSource: "CAMERA" })).toBe(true);
    expect(qualifiesAsRequiredEvidence({ captureSource: "SEED" })).toBe(true);
    expect(qualifiesAsRequiredEvidence({ captureSource: "LIBRARY" })).toBe(false);
  });

  it("a LIBRARY image in a required slot is flagged and blocks every step", () => {
    const d: ReportDraft = { ...completeDraft(), photos: { ...completeDraft().photos, SIDE: citizenPhoto("SIDE", "LIBRARY") } };
    expect(validateDraft(d, "PHOTOS")).toEqual([{ code: "PHOTO_SOURCE_NOT_ALLOWED", slot: "SIDE" }]);
    expect(validateDraft(d, "SUBMIT")).toContainEqual({ code: "PHOTO_SOURCE_NOT_ALLOWED", slot: "SIDE" });
  });

  it("SEED photos satisfy required slots (demo/mock records)", () => {
    const d: ReportDraft = {
      ...completeDraft(),
      photos: { FRONT: citizenPhoto("FRONT", "SEED"), SIDE: citizenPhoto("SIDE", "SEED"), REAR: citizenPhoto("REAR", "SEED") },
    };
    expect(validateDraft(d, "SUBMIT")).toEqual([]);
  });

  it("LIBRARY attachments are allowed but never fill a missing required slot", () => {
    const attachment = createCitizenEvidence({ id: "att", type: "ATTACHMENT", captureSource: "LIBRARY", uri: "file:///a.jpg", capturedAt: T0 });
    const { REAR: _rear, ...two } = completeDraft().photos;
    const withAttachment: ReportDraft = { ...completeDraft(), photos: two, attachments: [attachment] };
    expect(validateDraft(withAttachment, "SUBMIT")).toEqual([{ code: "MISSING_PHOTO", slot: "REAR" }]);
    expect(validateDraft({ ...completeDraft(), attachments: [attachment] }, "SUBMIT")).toEqual([]);
  });
});

describe("evidence provenance: officer required photos", () => {
  const officerPhoto = (captureSource: CaptureSource) =>
    createOfficerEvidence({ id: "o", type: "PARKING_SIGN", captureSource, uri: "file:///o.jpg", capturedAt: T1 });

  it("a LIBRARY image cannot fill an officer slot", () => {
    const i = createInspection({ id: "i", caseId: "c", startedAt: T1 });
    expect(errorCode(attachOfficerEvidence(i, officerPhoto("LIBRARY")))).toBe("EVIDENCE_SOURCE_NOT_ALLOWED");
    expect(unwrap(attachOfficerEvidence(i, officerPhoto("CAMERA"))).officerEvidence.PARKING_SIGN?.captureSource).toBe("CAMERA");
    expect(unwrap(attachOfficerEvidence(i, officerPhoto("SEED"))).officerEvidence.PARKING_SIGN?.captureSource).toBe("SEED");
  });

  it("a non-qualifying photo already present (e.g. bad data) does not count toward 4/4", () => {
    const i = readyInspection();
    const tampered = { ...i, officerEvidence: { ...i.officerEvidence, PARKING_SIGN: officerPhoto("LIBRARY") } };
    expect(countCapturedOfficerEvidence(tampered)).toBe(3);
    expect(isRequiredEvidenceCaptured(tampered)).toBe(false);
  });
});

describe("report audit trail and time semantics", () => {
  it("a new report has scope, a SUBMITTED event, device times and NO server time", () => {
    const r = submittedReport();
    expect(r.jurisdictionId).toBe(JURISDICTION);
    expect(r.observedAt).toBe(T0);
    expect(r.submittedAt).toBe(T0);
    expect(r.receivedAt).toBeUndefined();
    expect(r.incidentId).toBeUndefined();
    expect(r.events).toEqual([{ type: "SUBMITTED", at: T0, actor: { role: "CITIZEN", accountId: CITIZEN }, source: "USER_ACTION" }]);
  });

  it("a resolved outcome appends STATUS_RESOLVED (actor = officer); unresolved appends nothing", () => {
    const charged = unwrap(completeCaseWithOutcome(enforcementState(), { code: "CHARGE_ISSUED", officerId: OFFICER, decidedAt: T2 }));
    expect(charged.state.report.events.map((e) => e.type)).toEqual(["SUBMITTED", "STATUS_RESOLVED"]);
    expect(charged.state.report.events[1]).toEqual({
      type: "STATUS_RESOLVED",
      at: T2,
      actor: { role: "OFFICER", accountId: OFFICER },
      source: "USER_ACTION",
      from: "UNDER_REVIEW",
      to: "VERIFIED",
      outcomeCode: "CHARGE_ISSUED",
    });

    const moved = unwrap(completeCaseWithOutcome(enforcementState(), { code: "VEHICLE_MOVED", officerId: OFFICER, decidedAt: T2 }));
    expect(moved.state.report.events.map((e) => e.type)).toEqual(["SUBMITTED"]);
  });

  it("re-submitting the same outcome adds no second STATUS_RESOLVED event", () => {
    const once = unwrap(completeCaseWithOutcome(enforcementState(), { code: "REPORT_REJECTED", officerId: OFFICER, decidedAt: T2 }));
    const twice = unwrap(completeCaseWithOutcome(once.state, { code: "REPORT_REJECTED", officerId: OFFICER, decidedAt: T2 }));
    expect(twice.state.report.events.filter((e) => e.type === "STATUS_RESOLVED")).toHaveLength(1);
  });

  it("case events carry actor and source separately; the completion source is recorded", () => {
    const r = unwrap(
      completeCaseWithOutcome(enforcementState(), { code: "CHARGE_ISSUED", officerId: OFFICER, decidedAt: T2, source: "INTEGRATION" })
    );
    const events = r.state.officerCase.events;
    expect(events[0]).toMatchObject({ type: "CREATED", actor: { role: "CITIZEN", accountId: CITIZEN }, source: "USER_ACTION" });
    expect(events.slice(1).every((e) => e.actor.role === "OFFICER" && e.actor.accountId === OFFICER)).toBe(true);
    expect(events.at(-1)).toMatchObject({ to: "COMPLETED", source: "INTEGRATION" });
    expect(r.state.report.events.at(-1)).toMatchObject({ type: "STATUS_RESOLVED", source: "INTEGRATION" });
  });
});
