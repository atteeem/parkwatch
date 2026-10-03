import { qualifiesAsRequiredEvidence } from "./evidence";
import { fail, ok, Result } from "./result";
import {
  CHECKLIST_KEYS,
  ChecklistKey,
  EnforcementOutcome,
  Inspection,
  IsoTimestamp,
  OFFICER_EVIDENCE_TYPES,
  OfficerEvidence,
  OfficerEvidenceType,
} from "./types";

export function createInspection(input: { id: string; caseId: string; startedAt: IsoTimestamp }): Inspection {
  return {
    id: input.id,
    caseId: input.caseId,
    startedAt: input.startedAt,
    checklist: { vehiclePresent: null, plateMatches: null, violationConfirmed: null, restrictionVerified: null },
    officerEvidence: {},
    notes: "",
  };
}

const isLocked = (i: Inspection) => i.completedAt !== undefined;

const lockedError = <T>(i: Inspection) =>
  fail<T>("INSPECTION_COMPLETED", `Inspection ${i.id} is completed and can no longer change.`);

/** Answer a checklist item. Officers can answer "no" (false) or clear (null). */
export function setChecklistItem(i: Inspection, key: ChecklistKey, value: boolean | null): Result<Inspection> {
  if (isLocked(i)) return lockedError(i);
  return ok({ ...i, checklist: { ...i.checklist, [key]: value } });
}

/** Simulated plate scan (no OCR in the MVP): confirms plateMatches. */
export function simulatePlateScan(i: Inspection, at: IsoTimestamp): Result<Inspection> {
  if (isLocked(i)) return lockedError(i);
  return ok({ ...i, checklist: { ...i.checklist, plateMatches: true }, plateScanSimulatedAt: at });
}

/**
 * Store (or replace) the officer photo for its required slot. Citizen
 * evidence is rejected, and so is a photo-library image: the four slots are
 * required evidence and must be captured on site (CAMERA, or SEED for demo data).
 */
export function attachOfficerEvidence(i: Inspection, evidence: OfficerEvidence): Result<Inspection> {
  if (isLocked(i)) return lockedError(i);
  if ((evidence as { source: string }).source !== "OFFICER") {
    return fail("EVIDENCE_SOURCE_MISMATCH", "Only officer evidence can be attached to an inspection.");
  }
  if (!qualifiesAsRequiredEvidence(evidence)) {
    return fail("EVIDENCE_SOURCE_NOT_ALLOWED", `${evidence.captureSource} images cannot fill a required officer photo slot.`);
  }
  return ok({ ...i, officerEvidence: { ...i.officerEvidence, [evidence.type]: evidence } });
}

export function setInspectionNotes(i: Inspection, notes: string): Result<Inspection> {
  if (isLocked(i)) return lockedError(i);
  return ok({ ...i, notes });
}

/** Required slots without a qualifying (CAMERA/SEED) photo. */
export function getMissingOfficerEvidence(i: Inspection): OfficerEvidenceType[] {
  return OFFICER_EVIDENCE_TYPES.filter((t) => {
    const e = i.officerEvidence[t];
    return !e || !qualifiesAsRequiredEvidence(e);
  });
}

/** Derived "Required evidence captured" (checklist row 5). Never stored. */
export function isRequiredEvidenceCaptured(i: Inspection): boolean {
  return getMissingOfficerEvidence(i).length === 0;
}

export function countCapturedOfficerEvidence(i: Inspection): number {
  return OFFICER_EVIDENCE_TYPES.length - getMissingOfficerEvidence(i).length;
}

/** All four checklist items explicitly confirmed (true). */
export function isChecklistConfirmed(i: Inspection): boolean {
  return CHECKLIST_KEYS.every((k) => i.checklist[k] === true);
}

/**
 * Readiness for the successful enforcement path (spec OFF-06): all four
 * checks confirmed AND all four officer photos captured. Notes are optional.
 */
export function isInspectionComplete(i: Inspection): boolean {
  return isChecklistConfirmed(i) && isRequiredEvidenceCaptured(i);
}

/**
 * Finish the inspection with an outcome.
 *
 * CHARGE_ISSUED requires isInspectionComplete. Other outcomes are allowed
 * without full readiness at domain level (e.g. vehicle already gone); the
 * current UI may still require it.
 *
 * Idempotent: repeating with the same outcome code returns changed=false.
 */
export function completeInspection(
  i: Inspection,
  outcome: EnforcementOutcome
): Result<{ inspection: Inspection; changed: boolean }> {
  if (isLocked(i)) {
    if (i.outcome?.code === outcome.code) return ok({ inspection: i, changed: false });
    return fail("ALREADY_COMPLETED", `Inspection ${i.id} already completed with ${i.outcome?.code}.`);
  }
  if (outcome.code === "CHARGE_ISSUED" && !isInspectionComplete(i)) {
    return fail("INSPECTION_NOT_READY", "Issuing a charge requires all checks confirmed and all four officer photos.");
  }
  return ok({
    inspection: { ...i, outcome, notes: outcome.notes ?? i.notes, completedAt: outcome.decidedAt },
    changed: true,
  });
}

/**
 * Any inspection activity recorded: a checklist answer (yes OR no) or an
 * officer photo. Required before the officer can record an outcome from the
 * inspection (a desk decision does not go through the inspection at all).
 */
export function hasInspectionActivity(i: Inspection): boolean {
  return CHECKLIST_KEYS.some((k) => i.checklist[k] === true || i.checklist[k] === false) || Object.keys(i.officerEvidence).length > 0;
}
