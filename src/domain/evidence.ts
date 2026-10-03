import {
  CaptureSource,
  CITIZEN_EVIDENCE_TYPES,
  CitizenEvidence,
  CitizenEvidenceType,
  Evidence,
  IsoTimestamp,
  OFFICER_EVIDENCE_TYPES,
  OfficerEvidence,
  OfficerEvidenceType,
} from "./types";

export function isCitizenEvidenceType(type: string): type is CitizenEvidenceType {
  return (CITIZEN_EVIDENCE_TYPES as readonly string[]).includes(type);
}

export function isOfficerEvidenceType(type: string): type is OfficerEvidenceType {
  return (OFFICER_EVIDENCE_TYPES as readonly string[]).includes(type);
}

/**
 * Capture sources that may fill a REQUIRED evidence slot (citizen
 * FRONT/SIDE/REAR, officer's four photos). CAMERA is the real source; SEED is
 * allowed only so demo/mock records stay valid. LIBRARY never qualifies.
 */
const REQUIRED_EVIDENCE_SOURCES: readonly CaptureSource[] = ["CAMERA", "SEED"];

export function qualifiesAsRequiredEvidence(e: Pick<Evidence, "captureSource">): boolean {
  return REQUIRED_EVIDENCE_SOURCES.includes(e.captureSource);
}

export function createCitizenEvidence(input: {
  id: string;
  type: CitizenEvidence["type"];
  captureSource: CaptureSource;
  uri: string;
  capturedAt: IsoTimestamp;
}): CitizenEvidence {
  return { ...input, source: "CITIZEN" };
}

export function createOfficerEvidence(input: {
  id: string;
  type: OfficerEvidenceType;
  captureSource: CaptureSource;
  uri: string;
  capturedAt: IsoTimestamp;
}): OfficerEvidence {
  return { ...input, source: "OFFICER" };
}
