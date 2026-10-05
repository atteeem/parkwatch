// Citizen reports and citizen evidence: domain <-> backend.
//
// Identity rule: the backend primary key is a UUID; the number citizens see
// ("#100023") is public_report_number. In the domain a Report's `id` is the
// citizen-visible number (that is what every screen shows), so reading a row
// returns BOTH: the domain report (id = public number) and its backend uuid.

import { CitizenEvidence, CitizenEvidenceType, Report, VehicleInfo } from "../../domain";
import { backendFail, backendOk, BackendResult } from "../result";
import {
  BackendCitizenEvidenceInsert,
  BackendCitizenEvidenceRow,
  BackendReportInsert,
  BackendReportRow,
  CitizenEvidenceSlot,
  Uuid,
} from "../types";
import { EVIDENCE_BUCKETS, isUuid, opt, storageUri, validateStoragePath } from "./common";

export function reportToInsert(report: Report, refs: { citizenUuid: Uuid }): BackendResult<BackendReportInsert> {
  if (!isUuid(refs.citizenUuid)) return backendFail("INVALID_DATA", "Report owner must be a signed-in user.");
  const v = report.vehicle;
  const c = report.location.coordinates;
  return backendOk({
    citizen_id: refs.citizenUuid,
    source_draft_id: report.sourceDraftId,
    jurisdiction_id: report.jurisdictionId,
    violation_type: report.violationId,
    plate_raw: v?.plate.raw ?? null,
    plate_normalized: v?.plate.normalized ?? null,
    plate_country: v?.plate.country ?? null,
    vehicle_make: v?.make ?? null,
    vehicle_model: v?.model ?? null,
    vehicle_color: v?.color ?? null,
    vehicle_source: v?.source ?? null,
    location_address: report.location.address,
    latitude: c?.latitude ?? null,
    longitude: c?.longitude ?? null,
    location_accuracy_m: c?.accuracyMeters ?? null,
    location_captured_at: c?.capturedAt ?? null,
    notes: report.notes,
    observed_at: report.observedAt,
    submitted_at: report.submittedAt,
    // Deliberately absent: id, public_report_number, status, priority,
    // received_at, resolved_at -> server-owned.
  });
}

function vehicleFromRow(row: BackendReportRow): VehicleInfo | undefined {
  if (!row.plate_raw || !row.plate_normalized) return undefined;
  return {
    plate: { raw: row.plate_raw, normalized: row.plate_normalized, ...(row.plate_country ? { country: row.plate_country } : {}) },
    make: opt(row.vehicle_make),
    model: opt(row.vehicle_model),
    color: opt(row.vehicle_color),
    source: row.vehicle_source ?? "CITIZEN_CONFIRMED",
  };
}

export type MappedReport = { uuid: Uuid; publicNumber: number; report: Report };

/**
 * Backend row (+ its citizen evidence) -> domain report. `caseId` is the
 * domain id of the linked case, if known. Report history (events) lives in
 * audit_events and is attached separately.
 */
export function reportFromRow(row: BackendReportRow, evidence: BackendCitizenEvidenceRow[], opts: { caseId?: string } = {}): MappedReport {
  const hasCoords = row.latitude !== null && row.longitude !== null;
  const report: Report = {
    id: String(row.public_report_number),
    sourceDraftId: row.source_draft_id,
    citizenId: row.citizen_id,
    jurisdictionId: row.jurisdiction_id,
    status: row.status,
    violationId: row.violation_type,
    location: {
      address: row.location_address,
      ...(hasCoords
        ? {
            coordinates: {
              latitude: row.latitude!,
              longitude: row.longitude!,
              ...(row.location_accuracy_m !== null ? { accuracyMeters: row.location_accuracy_m } : {}),
              ...(row.location_captured_at ? { capturedAt: row.location_captured_at } : {}),
            },
          }
        : {}),
    },
    observedAt: row.observed_at,
    submittedAt: row.submitted_at,
    receivedAt: row.received_at,
    incidentId: opt(row.incident_id),
    notes: row.notes,
    evidence: evidence.filter((e) => e.report_id === row.id).map(citizenEvidenceFromRow),
    vehicle: vehicleFromRow(row),
    priority: row.priority,
    caseId: opts.caseId,
    resolvedAt: opt(row.resolved_at),
    events: [],
  };
  return { uuid: row.id, publicNumber: row.public_report_number, report };
}

// ---------------------------------------------------------------------------
// Citizen evidence (never officer evidence)

const SLOT_BY_TYPE: Record<CitizenEvidence["type"], CitizenEvidenceSlot> = { FRONT: "FRONT", SIDE: "SIDE", REAR: "REAR", ATTACHMENT: "ATTACHMENT" };

export function citizenEvidenceToInsert(
  evidence: CitizenEvidence,
  refs: { reportUuid: Uuid; storagePath: string }
): BackendResult<BackendCitizenEvidenceInsert> {
  // Runtime guard as well as the type: officer evidence must never land here.
  if ((evidence as { source: string }).source !== "CITIZEN") {
    return backendFail("INVALID_DATA", "Only citizen evidence can be attached to a report.");
  }
  const slot = SLOT_BY_TYPE[evidence.type];
  if (!slot) return backendFail("INVALID_DATA", "Unknown citizen evidence type.");
  if (slot !== "ATTACHMENT" && evidence.captureSource === "LIBRARY") {
    return backendFail("INVALID_DATA", "Required report photos must be taken with the camera.");
  }
  const path = validateStoragePath(refs.storagePath);
  if (!path.ok) return path;
  if (!isUuid(refs.reportUuid)) return backendFail("INVALID_DATA", "Unknown report.");
  return backendOk({
    report_id: refs.reportUuid,
    slot,
    capture_source: evidence.captureSource,
    storage_path: path.value,
    captured_at: evidence.capturedAt,
  });
}

export function citizenEvidenceFromRow(row: BackendCitizenEvidenceRow): CitizenEvidence {
  return {
    id: row.id,
    source: "CITIZEN",
    type: row.slot as CitizenEvidenceType | "ATTACHMENT",
    captureSource: row.capture_source,
    uri: storageUri(EVIDENCE_BUCKETS.citizen, row.storage_path),
    capturedAt: row.captured_at,
  };
}
