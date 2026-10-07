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
  /** GPS = the point is the device fix; MAP_SELECTED = picked on the map (no accuracy/time of its own). */
  locationSource?: "GPS" | "MAP_SELECTED";
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

  // Reads (T8.4): paginated and filtered on the server; all RLS-limited.
  getCitizenSummary(since: string | null): Promise<Result<CitizenSummaryRow>>;
  getOfficerSummary(since: string | null): Promise<Result<OfficerSummaryRow>>;
  getMyLedger(): Promise<Result<CoreSnapshotRows["ledger"]>>;
  pageMyReports(status: ReportStatusFilter, cursor: KeysetCursor | null, limit: number): Promise<Result<PageBundle>>;
  pageMyNotifications(cursor: KeysetCursor | null, limit: number): Promise<Result<PageBundle>>;
  pageOfficerQueue(filter: QueueFilterKey, position: { lat: number; lng: number } | null, offset: number, limit: number): Promise<Result<PageBundle>>;
  pageMyCases(tab: CasesTabKey, cursor: KeysetCursor | null, limit: number): Promise<Result<PageBundle>>;
  getCaseDetail(caseUuid: string): Promise<Result<Partial<CoreSnapshotRows>>>;
  getMyReport(publicNumber: number): Promise<Result<Partial<CoreSnapshotRows>>>;
  /** T8.7: outcomes decided by the signed-in officer in [from, to), with per-day counts in `timeZone`. */
  getOfficerMonthlyStats(from: string, to: string, timeZone: string): Promise<Result<Record<string, unknown>>>;
};

export type KeysetCursor = { ts: string; id: string };
/** One page: the rows to merge, the ordered ids of this page, and where the next page starts. */
export type PageBundle = Partial<CoreSnapshotRows> & { ids: string[]; next_cursor?: KeysetCursor | null; next_offset?: number | null };
export type ReportStatusFilter = "UNDER_REVIEW" | "VERIFIED" | "REJECTED" | null;
export type QueueFilterKey = "all" | "new" | "high" | "assigned";
export type CasesTabKey = "all" | "completed" | "issued" | "rejected";
export type CitizenSummaryRow = {
  total: number;
  under_review: number;
  verified: number;
  rejected: number;
  since_total: number;
  since_verified: number;
  since_rejected: number;
  unread_notifications: number;
};
export type OfficerSummaryRow = {
  open: number;
  new: number;
  high_new: number;
  high_open: number;
  assigned_to_me: number;
  mine_total: number;
  mine_completed: number;
  mine_issued: number;
  mine_rejected: number;
  since_completed: number;
  since_issued: number;
  since_rejected: number;
  unread_notifications: number;
};

const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

async function object<T>(p: Promise<Result<T>>): Promise<Result<T>> {
  const r = await p;
  if (!r.ok) return r;
  return r.value && typeof r.value === "object" ? r : fail("BACKEND_ERROR", "BACKEND_ERROR");
}

async function page(p: Promise<Result<unknown>>): Promise<Result<PageBundle>> {
  const r = await object(p as Promise<Result<PageBundle>>);
  if (!r.ok) return r;
  return ok({ ...r.value, ids: Array.isArray(r.value.ids) ? r.value.ids.map(String) : [] });
}

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
          p_location_source: n(i.locationSource),
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
    getCitizenSummary: (since) => object(rpc<CitizenSummaryRow>("get_citizen_summary", { p_since: since })),
    getOfficerSummary: (since) => object(rpc<OfficerSummaryRow>("get_officer_summary", { p_since: since })),
    async getMyLedger() {
      const r = await rpc<CoreSnapshotRows["ledger"]>("get_my_ledger");
      return r.ok ? ok(Array.isArray(r.value) ? r.value : []) : r;
    },
    pageMyReports: (status, cursor, limit) =>
      page(rpc("page_my_reports", { p_status: status, p_before_ts: cursor?.ts ?? null, p_before_id: cursor?.id ?? null, p_limit: limit })),
    pageMyNotifications: (cursor, limit) =>
      page(rpc("page_my_notifications", { p_before_ts: cursor?.ts ?? null, p_before_id: cursor?.id ?? null, p_limit: limit })),
    pageOfficerQueue: (filter, position, offset, limit) =>
      page(rpc("page_officer_queue", { p_filter: filter, p_lat: position?.lat ?? null, p_lng: position?.lng ?? null, p_offset: offset, p_limit: limit })),
    pageMyCases: (tab, cursor, limit) =>
      page(rpc("page_my_cases", { p_tab: tab, p_before_ts: cursor?.ts ?? null, p_before_id: cursor?.id ?? null, p_limit: limit })),
    async getCaseDetail(caseUuid) {
      if (!isUuid(caseUuid)) return ok({});
      return object(rpc<Partial<CoreSnapshotRows>>("get_case_detail", { p_case_id: caseUuid }));
    },
    getMyReport: (publicNumber) =>
      Number.isSafeInteger(publicNumber) && publicNumber > 0 ? object(rpc<Partial<CoreSnapshotRows>>("get_my_report", { p_public_number: publicNumber })) : Promise.resolve(ok({})),
    getOfficerMonthlyStats: (from, to, timeZone) =>
      object(rpc<Record<string, unknown>>("get_officer_monthly_stats", { p_from: from, p_to: to, p_time_zone: timeZone })),
  };
}
