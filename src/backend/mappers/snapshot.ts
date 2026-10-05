// get_core_snapshot() rows -> the domain ParkWatchState, so every existing
// selector/view model works unchanged in server-backed mode. The rows are
// already limited by Row Level Security to what the signed-in user may see.
//
// Identity: a domain Report's id is its public report number (what people
// see); cases, inspections, evidence, ledger and notification ids stay the
// server uuids. Report uuids are translated wherever rows reference them.

import { Inspection, RewardLedgerEntry, rewardEntryKey } from "../../domain";
import { EMPTY_STATE, ParkWatchState } from "../../store/state";
import {
  BackendCaseRow,
  BackendCitizenEvidenceRow,
  BackendInspectionCheckRow,
  BackendInspectionRow,
  BackendLedgerRow,
  BackendNotificationRow,
  BackendOfficerEvidenceRow,
  BackendOutcomeRow,
  BackendReportRow,
} from "../types";
import { caseFromRow, inspectionFromRows, outcomeFromRow } from "./enforcement";
import { reportFromRow } from "./reports";
import { ledgerEntryFromRow, notificationFromRow } from "./rewards";

export type CoreSnapshotRows = {
  reports: BackendReportRow[];
  report_evidence: BackendCitizenEvidenceRow[];
  cases: BackendCaseRow[];
  outcomes: BackendOutcomeRow[];
  inspections: BackendInspectionRow[];
  inspection_checks: BackendInspectionCheckRow[];
  officer_evidence: BackendOfficerEvidenceRow[];
  ledger: BackendLedgerRow[];
  notifications: BackendNotificationRow[];
};

const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

/** Tolerate missing keys (an older server) instead of crashing. */
export function normalizeSnapshot(raw: Partial<CoreSnapshotRows> | null | undefined): CoreSnapshotRows {
  return {
    reports: arr(raw?.reports),
    report_evidence: arr(raw?.report_evidence),
    cases: arr(raw?.cases),
    outcomes: arr(raw?.outcomes),
    inspections: arr(raw?.inspections),
    inspection_checks: arr(raw?.inspection_checks),
    officer_evidence: arr(raw?.officer_evidence),
    ledger: arr(raw?.ledger),
    notifications: arr(raw?.notifications),
  };
}

/** Server reward keys use the report uuid; the domain derives reward state from its own key per public report id. */
function toDomainLedgerKey(e: RewardLedgerEntry): RewardLedgerEntry {
  if ((e.type === "REWARD_PENDING" || e.type === "REWARD_RELEASED" || e.type === "REWARD_VOIDED") && e.reportId) {
    return { ...e, idempotencyKey: rewardEntryKey(e.type, e.reportId) };
  }
  return e;
}

/** Every private storage object referenced by the snapshot, per bucket (for signing). */
export function storagePathsOf(rows: CoreSnapshotRows): { report: string[]; officer: string[] } {
  return { report: rows.report_evidence.map((e) => e.storage_path), officer: rows.officer_evidence.map((e) => e.storage_path) };
}

/**
 * Build the domain state. `resolveUri` turns a `parkwatch-storage://` reference
 * into a displayable (signed) URL; references it cannot resolve stay as they
 * are and render as "photo unavailable".
 */
export function snapshotToState(input: Partial<CoreSnapshotRows>, resolveUri: (uri: string) => string = (u) => u): ParkWatchState {
  const rows = normalizeSnapshot(input);
  const publicIdByUuid = new Map(rows.reports.map((r) => [r.id, String(r.public_report_number)]));
  const caseByReportUuid = new Map(rows.cases.map((c) => [c.report_id, c.id]));
  const reportIdOf = (uuid: string) => publicIdByUuid.get(uuid);

  const reports = rows.reports.map((row) => {
    const { report } = reportFromRow(row, rows.report_evidence, { caseId: caseByReportUuid.get(row.id) });
    return { ...report, evidence: report.evidence.map((e) => ({ ...e, uri: resolveUri(e.uri) })) };
  });

  const outcomeByCase = new Map(rows.outcomes.map((o) => [o.case_id, outcomeFromRow(o)]));

  // A case whose report the caller cannot see is useless to every screen; skip it.
  const cases = rows.cases
    .filter((c) => publicIdByUuid.has(c.report_id))
    .map((c) => caseFromRow(c, { reportId: publicIdByUuid.get(c.report_id)!, outcome: outcomeByCase.get(c.id) }));

  const inspections: Record<string, Inspection> = {};
  for (const row of rows.inspections) {
    const insp = inspectionFromRows(row, rows.inspection_checks, rows.officer_evidence, outcomeByCase.get(row.case_id));
    for (const e of Object.values(insp.officerEvidence)) if (e) e.uri = resolveUri(e.uri);
    inspections[row.case_id] = insp;
  }

  return {
    ...EMPTY_STATE,
    reports,
    cases,
    inspections,
    ledger: rows.ledger.map((l) => toDomainLedgerKey(ledgerEntryFromRow(l, reportIdOf))),
    notifications: rows.notifications.map((n) => notificationFromRow(n, reportIdOf)),
    // Parking is local-only in T8.3 and is not part of the server snapshot.
    vehicles: [],
    parkingSessions: [],
  };
}
