import {
  CITIZEN_EVIDENCE_TYPES,
  CitizenEvidence,
  CitizenEvidenceType,
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

export function createCitizenEvidence(input: {
  id: string;
  type: CitizenEvidence["type"];
  uri: string;
  capturedAt: IsoTimestamp;
}): CitizenEvidence {
  return { ...input, source: "CITIZEN" };
}

export function createOfficerEvidence(input: {
  id: string;
  type: OfficerEvidenceType;
  uri: string;
  capturedAt: IsoTimestamp;
}): OfficerEvidence {
  return { ...input, source: "OFFICER" };
}
