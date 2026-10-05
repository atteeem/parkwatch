// Officer cases, inspections (tri-state checks), officer evidence and
// enforcement outcomes: domain <-> backend. Lifecycle and outcome RULES are
// not re-implemented here; these functions only translate shapes.

import {
  CaseStatus,
  CHECKLIST_KEYS,
  DEFAULT_MOCK_CHARGE_AMOUNT_CENTS,
  EnforcementOutcome,
  ENFORCEMENT_OUTCOME_CODES,
  Inspection,
  InspectionChecklist,
  OfficerCase,
  OfficerEvidence,
  OfficerEvidenceType,
  OFFICER_EVIDENCE_TYPES,
} from "../../domain";
import { backendFail, backendOk, BackendResult } from "../result";
import {
  BackendCaseRow,
  BackendInspectionCheckRow,
  BackendInspectionRow,
  BackendOfficerEvidenceInsert,
  BackendOfficerEvidenceRow,
  BackendOutcomeInsert,
  BackendOutcomeRow,
  Uuid,
} from "../types";
import { EVIDENCE_BUCKETS, isUuid, opt, requireCents, storageUri, validateStoragePath } from "./common";

// ---------------------------------------------------------------------------
// Cases

/** Domain statusTimestamps <-> one column per status (first time entered). */
const STATUS_COLUMN = {
  ASSIGNED: "assigned_at",
  EN_ROUTE: "en_route_at",
  ON_SITE: "on_site_at",
  INSPECTION: "inspection_started_at",
  COMPLETED: "completed_at",
} as const satisfies Partial<Record<CaseStatus, keyof BackendCaseRow>>;

export function caseStatusTimestampsToColumns(c: Pick<OfficerCase, "statusTimestamps">): Pick<BackendCaseRow, (typeof STATUS_COLUMN)[keyof typeof STATUS_COLUMN]> {
  const t = c.statusTimestamps;
  return {
    assigned_at: t.ASSIGNED ?? null,
    en_route_at: t.EN_ROUTE ?? null,
    on_site_at: t.ON_SITE ?? null,
    inspection_started_at: t.INSPECTION ?? null,
    completed_at: t.COMPLETED ?? null,
  };
}

/**
 * Case row -> domain case. `reportId` is the domain id of the linked report
 * (its public number); `outcome` comes from enforcement_outcomes; history
 * (events) from audit_events.
 */
export function caseFromRow(row: BackendCaseRow, refs: { reportId: string; outcome?: EnforcementOutcome }): OfficerCase {
  const statusTimestamps: OfficerCase["statusTimestamps"] = { NEW: row.created_at };
  for (const [status, column] of Object.entries(STATUS_COLUMN) as [keyof typeof STATUS_COLUMN, keyof BackendCaseRow][]) {
    const v = row[column];
    if (typeof v === "string") statusTimestamps[status] = v;
  }
  return {
    id: row.id,
    reportId: refs.reportId,
    jurisdictionId: row.jurisdiction_id,
    status: row.status,
    priority: row.priority,
    assignedOfficerId: opt(row.assigned_officer_id),
    createdAt: row.created_at,
    statusTimestamps,
    outcome: refs.outcome,
    completedAt: opt(row.completed_at),
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Inspection + tri-state checklist

/** Always all four keys; answer null = unanswered (kept distinct from false = "no"). */
export function checklistToRows(inspectionUuid: Uuid, checklist: InspectionChecklist, answeredAt: string): BackendInspectionCheckRow[] {
  return CHECKLIST_KEYS.map((key) => {
    const answer = checklist[key];
    return { inspection_id: inspectionUuid, check_key: key, answer, answered_at: answer === null ? null : answeredAt };
  });
}

export function checklistFromRows(rows: BackendInspectionCheckRow[]): InspectionChecklist {
  const checklist = Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, null])) as InspectionChecklist;
  for (const r of rows) if ((CHECKLIST_KEYS as readonly string[]).includes(r.check_key)) checklist[r.check_key] = r.answer;
  return checklist;
}

export function inspectionFromRows(
  row: BackendInspectionRow,
  checks: BackendInspectionCheckRow[],
  evidence: BackendOfficerEvidenceRow[],
  outcome?: EnforcementOutcome
): Inspection {
  const officerEvidence: Inspection["officerEvidence"] = {};
  for (const e of evidence.filter((x) => x.inspection_id === row.id)) officerEvidence[e.evidence_type] = officerEvidenceFromRow(e);
  return {
    id: row.id,
    caseId: row.case_id,
    startedAt: row.started_at,
    checklist: checklistFromRows(checks.filter((c) => c.inspection_id === row.id)),
    officerEvidence,
    plateScanSimulatedAt: opt(row.plate_confirmed_via_scan_at),
    notes: row.notes,
    outcome,
    completedAt: opt(row.completed_at),
  };
}

// ---------------------------------------------------------------------------
// Officer evidence (never citizen evidence)

export function officerEvidenceToInsert(
  evidence: OfficerEvidence,
  refs: { inspectionUuid: Uuid; caseUuid: Uuid; storagePath: string }
): BackendResult<BackendOfficerEvidenceInsert> {
  if ((evidence as { source: string }).source !== "OFFICER") {
    return backendFail("INVALID_DATA", "Only officer evidence can be attached to an inspection.");
  }
  if (!(OFFICER_EVIDENCE_TYPES as readonly string[]).includes(evidence.type)) {
    return backendFail("INVALID_DATA", "Unknown officer evidence type.");
  }
  if (evidence.captureSource === "LIBRARY") return backendFail("INVALID_DATA", "Officer evidence must be taken with the camera on site.");
  const path = validateStoragePath(refs.storagePath);
  if (!path.ok) return path;
  if (!isUuid(refs.inspectionUuid) || !isUuid(refs.caseUuid)) return backendFail("INVALID_DATA", "Unknown inspection.");
  return backendOk({
    inspection_id: refs.inspectionUuid,
    case_id: refs.caseUuid,
    evidence_type: evidence.type as OfficerEvidenceType,
    capture_source: evidence.captureSource,
    storage_path: path.value,
    captured_at: evidence.capturedAt,
  });
}

export function officerEvidenceFromRow(row: BackendOfficerEvidenceRow): OfficerEvidence {
  return {
    id: row.id,
    source: "OFFICER",
    type: row.evidence_type,
    captureSource: row.capture_source,
    uri: storageUri(EVIDENCE_BUCKETS.officer, row.storage_path),
    capturedAt: row.captured_at,
  };
}

// ---------------------------------------------------------------------------
// Enforcement outcome ("parking charge", not a criminal fine)

export function outcomeToInsert(
  outcome: EnforcementOutcome,
  refs: { caseUuid: Uuid; inspectionUuid?: Uuid; decidedByUuid: Uuid }
): BackendResult<BackendOutcomeInsert> {
  if (!(ENFORCEMENT_OUTCOME_CODES as readonly string[]).includes(outcome.code)) return backendFail("INVALID_DATA", "Unknown outcome.");
  if (!isUuid(refs.caseUuid) || !isUuid(refs.decidedByUuid)) return backendFail("INVALID_DATA", "Unknown case or officer.");
  let charge: number | null = null;
  if (outcome.code === "CHARGE_ISSUED") {
    const cents = requireCents(outcome.chargeAmountCents ?? DEFAULT_MOCK_CHARGE_AMOUNT_CENTS, "Parking charge");
    if (!cents.ok) return cents;
    charge = cents.value;
  } else if (outcome.chargeAmountCents !== undefined) {
    return backendFail("INVALID_DATA", "Only an issued parking charge has an amount.");
  }
  return backendOk({
    case_id: refs.caseUuid,
    inspection_id: refs.inspectionUuid ?? null,
    code: outcome.code,
    decided_by: refs.decidedByUuid,
    decided_at: outcome.decidedAt,
    notes: outcome.notes?.trim() ? outcome.notes : null,
    parking_charge_amount_cents: charge,
  });
}

export function outcomeFromRow(row: BackendOutcomeRow): EnforcementOutcome {
  return {
    code: row.code,
    decidedAt: row.decided_at,
    officerId: row.decided_by,
    ...(row.parking_charge_amount_cents !== null ? { chargeAmountCents: row.parking_charge_amount_cents } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
  };
}
