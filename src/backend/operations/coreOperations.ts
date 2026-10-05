// Server-side core workflow operations (T8.3). Every state change that
// matters (submit, accept, inspect, complete, rewards, notifications) is a
// database function that applies the rules atomically; the app only asks.
//
// The client never sends trusted values: no citizen id, report number,
// status, receipt time, reward or charge amount, or officer assignment.
// Those are decided by the server from the signed-in user.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CaptureSource, ChecklistKey, EnforcementOutcomeCode, fail, OfficerEvidenceType, ok, Result } from "../../domain";
import { isUuid } from "../mappers/common";
import { CoreSnapshotRows } from "../mappers/snapshot";
import { mapRpcError, RawServerError } from "./rpcErrors";

export type SubmitEvidenceInput = {
  slot: "FRONT" | "SIDE" | "REAR" | "ATTACHMENT";
  capture_source: CaptureSource;
  storage_path: string;
  captured_at: string;
};

/** What the citizen describes. Deliberately no owner, status, number, priority or amounts. */
export type SubmitReportInput = {
  submissionId: string;
  violationType: string;
  locationAddress: string;
  observedAt: string;
  submittedAt: string;
  evidence: SubmitEvidenceInput[];
  notes: string;
  latitude?: number;
  longitude?: number;
  locationAccuracyM?: number;
  locationCapturedAt?: string;
  plateRaw?: string;
  plateNormalized?: string;
  plateCountry?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleSource?: "MOCK_DETECTED" | "OCR_DETECTED" | "CITIZEN_CONFIRMED";
};

export type SubmitReportOutput = { reportUuid: string; publicReportNumber: number; caseUuid: string | null; receivedAt: string; created: boolean };

export type CoreOperations = {
  submitReport(input: SubmitReportInput): Promise<Result<SubmitReportOutput>>;
  acceptCase(caseUuid: string): Promise<Result<{ changed: boolean }>>;
  startEnRoute(caseUuid: string): Promise<Result<{ changed: boolean }>>;
  startInspection(caseUuid: string): Promise<Result<{ changed: boolean }>>;
  setInspectionCheck(caseUuid: string, key: ChecklistKey, answer: boolean | null): Promise<Result<{ changed: boolean }>>;
  confirmPlateByScan(caseUuid: string): Promise<Result<{ changed: boolean }>>;
  addOfficerEvidence(caseUuid: string, type: OfficerEvidenceType, storagePath: string, capturedAt: string): Promise<Result<{ evidenceId: string }>>;
  /** The charge amount is NOT a parameter: the server takes it from its own settings. */
  completeCase(caseUuid: string, code: EnforcementOutcomeCode, notes?: string): Promise<Result<{ changed: boolean; creditedCents: number }>>;
  markMyNotificationsRead(): Promise<Result<{ updated: number }>>;
  getSnapshot(): Promise<Result<CoreSnapshotRows>>;
};

const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export function createCoreOperations(client: SupabaseClient): CoreOperations {
  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
    try {
      const { data, error, status } = await client.rpc(fn, args);
      if (error) return { ok: false, error: mapRpcError(error as RawServerError, status) };
      return ok(data as T);
    } catch (e) {
      return { ok: false, error: mapRpcError(e as RawServerError) };
    }
  }

  const caseCall = async (fn: string, caseUuid: string, extra: Record<string, unknown> = {}) => {
    if (!isUuid(caseUuid)) return fail<{ changed: boolean }>("NOT_FOUND", "NOT_FOUND");
    const r = await rpc<{ changed?: boolean }>(fn, { p_case_id: caseUuid, ...extra });
    return r.ok ? ok({ changed: r.value?.changed === true }) : r;
  };

  return {
    async submitReport(i) {
      const r = await rpc<{ report_id: string; public_report_number: number | string; case_id: string | null; received_at: string; created: boolean }>(
        "submit_report",
        {
          p_submission_id: i.submissionId,
          p_violation_type: i.violationType,
          p_location_address: i.locationAddress,
          p_observed_at: i.observedAt,
          p_submitted_at: i.submittedAt,
          p_evidence: i.evidence,
          p_notes: i.notes,
          p_latitude: n(i.latitude),
          p_longitude: n(i.longitude),
          p_location_accuracy_m: n(i.locationAccuracyM),
          p_location_captured_at: n(i.locationCapturedAt),
          p_plate_raw: n(i.plateRaw),
          p_plate_normalized: n(i.plateNormalized),
          p_plate_country: n(i.plateCountry),
          p_vehicle_make: n(i.vehicleMake),
          p_vehicle_model: n(i.vehicleModel),
          p_vehicle_color: n(i.vehicleColor),
          p_vehicle_source: n(i.vehicleSource),
        }
      );
      if (!r.ok) return r;
      const v = r.value;
      if (!v || !isUuid(v.report_id)) return fail("BACKEND_ERROR", "BACKEND_ERROR");
      return ok({
        reportUuid: v.report_id,
        publicReportNumber: Number(v.public_report_number),
        caseUuid: v.case_id,
        receivedAt: v.received_at,
        created: v.created === true,
      });
    },
    acceptCase: (c) => caseCall("accept_case", c),
    startEnRoute: (c) => caseCall("start_en_route", c),
    startInspection: (c) => caseCall("start_inspection", c),
    setInspectionCheck: (c, key, answer) => caseCall("set_inspection_check", c, { p_check_key: key, p_answer: answer }),
    confirmPlateByScan: (c) => caseCall("confirm_plate_by_scan", c),
    async addOfficerEvidence(caseUuid, type, storagePath, capturedAt) {
      if (!isUuid(caseUuid)) return fail("NOT_FOUND", "NOT_FOUND");
      const r = await rpc<{ evidence_id: string }>("add_officer_evidence", {
        p_case_id: caseUuid,
        p_evidence_type: type,
        p_storage_path: storagePath,
        p_captured_at: capturedAt,
      });
      if (!r.ok) return r;
      return ok({ evidenceId: String(r.value?.evidence_id ?? "") });
    },
    async completeCase(caseUuid, code, notes) {
      if (!isUuid(caseUuid)) return fail("NOT_FOUND", "NOT_FOUND");
      const r = await rpc<{ changed?: boolean; credited_cents?: number }>("complete_case", {
        p_case_id: caseUuid,
        p_code: code,
        p_notes: notes?.trim() ? notes.trim() : null,
      });
      if (!r.ok) return r;
      return ok({ changed: r.value?.changed === true, creditedCents: Number(r.value?.credited_cents ?? 0) });
    },
    async markMyNotificationsRead() {
      const r = await rpc<{ updated?: number }>("mark_my_notifications_read");
      return r.ok ? ok({ updated: Number(r.value?.updated ?? 0) }) : r;
    },
    async getSnapshot() {
      const r = await rpc<CoreSnapshotRows>("get_core_snapshot");
      if (!r.ok) return r;
      if (!r.value || typeof r.value !== "object") return fail("BACKEND_ERROR", "BACKEND_ERROR");
      return r;
    },
  };
}
