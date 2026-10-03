import { CITIZEN, completeDraft, submittedReport, T0, T2 } from "./fixtures";
import {
  applyCitizenConsequenceToReport,
  createEmptyDraft,
  createReportFromDraft,
  errorCode,
  findReportForDraft,
  getCitizenOutcomeForEnforcementOutcome,
  MVP_MOCK_DETECTED_VEHICLE,
  ReportDraft,
  unwrap,
  validateDraft,
} from "./testHelpers";

describe("draft validation", () => {
  it("photos step needs front, side and rear", () => {
    const d = completeDraft();
    const { SIDE: _s, ...rest } = d.photos;
    expect(validateDraft({ ...d, photos: rest }, "PHOTOS")).toEqual([{ code: "MISSING_PHOTO", slot: "SIDE" }]);
    expect(validateDraft(d, "PHOTOS")).toEqual([]);
  });

  it("violation is required from the violation step", () => {
    const d: ReportDraft = { ...completeDraft(), violationId: undefined };
    expect(validateDraft(d, "PHOTOS")).toEqual([]);
    expect(validateDraft(d, "VIOLATION")).toEqual([{ code: "MISSING_VIOLATION" }]);
  });

  it("a blank or whitespace location fails the details step", () => {
    const d = { ...completeDraft(), location: { address: "   " } };
    expect(validateDraft(d, "DETAILS")).toEqual([{ code: "MISSING_LOCATION" }]);
  });

  it("notes and attachments are optional", () => {
    const d = { ...completeDraft(), notes: "", attachments: [] };
    expect(validateDraft(d, "SUBMIT")).toEqual([]);
  });

  it("an empty draft reports every missing requirement", () => {
    const codes = validateDraft(createEmptyDraft("d"), "SUBMIT").map((i) => i.code);
    expect(codes).toEqual(["MISSING_PHOTO", "MISSING_PHOTO", "MISSING_PHOTO", "MISSING_VIOLATION", "MISSING_LOCATION"]);
  });
});

describe("report creation", () => {
  it("freezes a valid draft as UNDER_REVIEW with citizen evidence", () => {
    const r = unwrap(
      createReportFromDraft(completeDraft(), {
        id: "12600",
        citizenId: CITIZEN,
        submittedAt: T2,
        vehicle: MVP_MOCK_DETECTED_VEHICLE,
      })
    );
    expect(r.status).toBe("UNDER_REVIEW");
    expect(r.sourceDraftId).toBe("draft-1");
    expect(r.evidence.map((e) => [e.source, e.type])).toEqual([
      ["CITIZEN", "FRONT"],
      ["CITIZEN", "SIDE"],
      ["CITIZEN", "REAR"],
    ]);
    expect(r.observedAt).toBe(T0);
    expect(r.vehicle?.source).toBe("MOCK_DETECTED");
  });

  it("refuses an incomplete draft", () => {
    expect(
      errorCode(createReportFromDraft(createEmptyDraft("d"), { id: "x", citizenId: CITIZEN, submittedAt: T2 }))
    ).toBe("INVALID_DRAFT");
  });

  it("a submitted draft can be found again (submission guard)", () => {
    const r = submittedReport();
    expect(findReportForDraft([r], "draft-1")).toBe(r);
    expect(findReportForDraft([r], "draft-2")).toBeUndefined();
  });
});

describe("citizen status changes", () => {
  it("re-applying the same resolved consequence is a no-op", () => {
    const verified = getCitizenOutcomeForEnforcementOutcome("CHARGE_ISSUED");
    const once = unwrap(applyCitizenConsequenceToReport(submittedReport(), verified, T2));
    const twice = unwrap(applyCitizenConsequenceToReport(once.report, verified, T2));
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
  });

  it("a verified report cannot later become rejected", () => {
    const once = unwrap(
      applyCitizenConsequenceToReport(submittedReport(), getCitizenOutcomeForEnforcementOutcome("CHARGE_ISSUED"), T2)
    );
    const r = applyCitizenConsequenceToReport(once.report, getCitizenOutcomeForEnforcementOutcome("REPORT_REJECTED"), T2);
    expect(errorCode(r)).toBe("REPORT_ALREADY_RESOLVED");
  });
});
