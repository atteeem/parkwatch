// Test builders for domain tests (not a test file itself).
import {
  createCase,
  createCitizenEvidence,
  createEmptyDraft,
  createInspection,
  createOfficerEvidence,
  createReportFromDraft,
  EnforcementState,
  Inspection,
  OFFICER_EVIDENCE_TYPES,
  OfficerCase,
  recordPendingReward,
  Report,
  ReportDraft,
  transitionCase,
  unwrap,
} from "./testHelpers";

export const T0 = "2026-07-17T18:07:00.000Z";
export const T1 = "2026-07-17T18:20:00.000Z";
export const T2 = "2026-07-17T18:35:00.000Z";
export const CITIZEN = "citizen-1";
export const OFFICER = "officer-1";

export function completeDraft(draftId = "draft-1"): ReportDraft {
  const d = createEmptyDraft(draftId);
  return {
    ...d,
    photos: {
      FRONT: createCitizenEvidence({ id: "e-front", type: "FRONT", uri: "file:///front.jpg", capturedAt: T0 }),
      SIDE: createCitizenEvidence({ id: "e-side", type: "SIDE", uri: "file:///side.jpg", capturedAt: T0 }),
      REAR: createCitizenEvidence({ id: "e-rear", type: "REAR", uri: "file:///rear.jpg", capturedAt: T0 }),
    },
    violationId: "no-parking",
    location: { address: "Mannerheimintie 45, Helsinki" },
  };
}

export function submittedReport(): Report {
  return unwrap(
    createReportFromDraft(completeDraft(), { id: "12600", citizenId: CITIZEN, submittedAt: T0, caseId: "c-12600" })
  );
}

/** A case that has reached INSPECTION via the MVP path. */
export function caseInInspection(): OfficerCase {
  let c = createCase({ id: "c-12600", reportId: "12600", priority: "NORMAL", createdAt: T0 });
  c = unwrap(transitionCase(c, "ASSIGNED", { at: T1, officerId: OFFICER }));
  c = unwrap(transitionCase(c, "EN_ROUTE", { at: T1, officerId: OFFICER }));
  c = unwrap(transitionCase(c, "INSPECTION", { at: T1, officerId: OFFICER }));
  return c;
}

export function readyInspection(): Inspection {
  const i = createInspection({ id: "i-1", caseId: "c-12600", startedAt: T1 });
  return {
    ...i,
    checklist: { vehiclePresent: true, plateMatches: true, violationConfirmed: true, restrictionVerified: true },
    officerEvidence: Object.fromEntries(
      OFFICER_EVIDENCE_TYPES.map((type) => [
        type,
        createOfficerEvidence({ id: `o-${type}`, type, uri: `file:///${type}.jpg`, capturedAt: T1 }),
      ])
    ),
  };
}

/** Golden-path state right before the officer submits a result. */
export function enforcementState(): EnforcementState {
  return {
    officerCase: caseInInspection(),
    inspection: readyInspection(),
    report: submittedReport(),
    ledger: recordPendingReward([], { citizenId: CITIZEN, reportId: "12600", at: T0 }),
    notifications: [],
  };
}
