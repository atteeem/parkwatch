import { OFFICER, readyInspection, T1, T2 } from "./fixtures";
import {
  attachOfficerEvidence,
  completeInspection,
  countCapturedOfficerEvidence,
  createCitizenEvidence,
  createEnforcementOutcome,
  createInspection,
  createOfficerEvidence,
  errorCode,
  getMissingOfficerEvidence,
  Inspection,
  isChecklistConfirmed,
  isInspectionComplete,
  isRequiredEvidenceCaptured,
  OfficerEvidence,
  setChecklistItem,
  simulatePlateScan,
  unwrap,
} from "./testHelpers";

const fresh = () => createInspection({ id: "i-1", caseId: "c-1", startedAt: T1 });

function withoutPhoto(i: Inspection, slot: keyof Inspection["officerEvidence"]): Inspection {
  const { [slot]: _removed, ...rest } = i.officerEvidence;
  return { ...i, officerEvidence: rest };
}

describe("inspection readiness", () => {
  it("a fresh inspection is not ready", () => {
    const i = fresh();
    expect(isChecklistConfirmed(i)).toBe(false);
    expect(isRequiredEvidenceCaptured(i)).toBe(false);
    expect(isInspectionComplete(i)).toBe(false);
  });

  it("an incomplete checklist fails successful-path readiness even with all photos", () => {
    const i = unwrap(setChecklistItem(readyInspection(), "restrictionVerified", null));
    expect(isRequiredEvidenceCaptured(i)).toBe(true);
    expect(isInspectionComplete(i)).toBe(false);
  });

  it("an explicit 'no' on a checklist item fails readiness", () => {
    const i = unwrap(setChecklistItem(readyInspection(), "vehiclePresent", false));
    expect(i.checklist.vehiclePresent).toBe(false);
    expect(isInspectionComplete(i)).toBe(false);
  });

  it("3 of 4 officer photos is incomplete", () => {
    const i = withoutPhoto(readyInspection(), "PARKING_SIGN");
    expect(countCapturedOfficerEvidence(i)).toBe(3);
    expect(getMissingOfficerEvidence(i)).toEqual(["PARKING_SIGN"]);
    expect(isRequiredEvidenceCaptured(i)).toBe(false);
    expect(isInspectionComplete(i)).toBe(false);
  });

  it("4 of 4 required photos derives evidence-captured; with all checks it is complete", () => {
    const i = readyInspection();
    expect(countCapturedOfficerEvidence(i)).toBe(4);
    expect(isRequiredEvidenceCaptured(i)).toBe(true);
    expect(isInspectionComplete(i)).toBe(true);
  });

  it("notes are optional for completion", () => {
    const i = readyInspection();
    expect(i.notes).toBe("");
    const outcome = createEnforcementOutcome({ code: "CHARGE_ISSUED", decidedAt: T2, officerId: OFFICER });
    expect(unwrap(completeInspection(i, outcome)).inspection.completedAt).toBe(T2);
  });
});

describe("inspection mutations", () => {
  it("simulated plate scan confirms plateMatches", () => {
    const i = unwrap(simulatePlateScan(fresh(), T1));
    expect(i.checklist.plateMatches).toBe(true);
    expect(i.plateScanSimulatedAt).toBe(T1);
  });

  it("re-capturing a slot replaces the previous photo", () => {
    const a = createOfficerEvidence({ id: "a", type: "LICENSE_PLATE", uri: "file:///a.jpg", capturedAt: T1 });
    const b = createOfficerEvidence({ id: "b", type: "LICENSE_PLATE", uri: "file:///b.jpg", capturedAt: T2 });
    const i = unwrap(attachOfficerEvidence(unwrap(attachOfficerEvidence(fresh(), a)), b));
    expect(i.officerEvidence.LICENSE_PLATE?.id).toBe("b");
    expect(countCapturedOfficerEvidence(i)).toBe(1);
  });

  it("rejects citizen evidence", () => {
    const citizenPhoto = createCitizenEvidence({ id: "c", type: "FRONT", uri: "file:///c.jpg", capturedAt: T1 });
    const r = attachOfficerEvidence(fresh(), citizenPhoto as unknown as OfficerEvidence);
    expect(errorCode(r)).toBe("EVIDENCE_SOURCE_MISMATCH");
  });
});

describe("inspection completion", () => {
  const outcome = (code: "CHARGE_ISSUED" | "VEHICLE_MOVED") =>
    createEnforcementOutcome({ code, decidedAt: T2, officerId: OFFICER, notes: "note" });

  it("persists checklist, evidence, outcome, notes and completion time", () => {
    const { inspection } = unwrap(completeInspection(readyInspection(), outcome("CHARGE_ISSUED")));
    expect(inspection.outcome?.code).toBe("CHARGE_ISSUED");
    expect(inspection.notes).toBe("note");
    expect(inspection.completedAt).toBe(T2);
    expect(countCapturedOfficerEvidence(inspection)).toBe(4);
    expect(isChecklistConfirmed(inspection)).toBe(true);
  });

  it("CHARGE_ISSUED is refused when the inspection is not complete", () => {
    const r = completeInspection(withoutPhoto(readyInspection(), "VIOLATION_CONTEXT"), outcome("CHARGE_ISSUED"));
    expect(errorCode(r)).toBe("INSPECTION_NOT_READY");
  });

  it("a completed inspection is locked", () => {
    const { inspection } = unwrap(completeInspection(readyInspection(), outcome("CHARGE_ISSUED")));
    expect(errorCode(setChecklistItem(inspection, "vehiclePresent", false))).toBe("INSPECTION_COMPLETED");
  });

  it("completing twice with the same outcome is a no-op", () => {
    const first = unwrap(completeInspection(readyInspection(), outcome("CHARGE_ISSUED")));
    const second = unwrap(completeInspection(first.inspection, outcome("CHARGE_ISSUED")));
    expect(second.changed).toBe(false);
    expect(second.inspection).toBe(first.inspection);
  });
});
