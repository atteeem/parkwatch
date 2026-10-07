// Merged cache of server rows from pages, details and summaries (T8.4).
// Pure functions: every merge returns a new cache, so React sees a change.
//
// Rules: a row is replaced by the newer copy of the same row. The children
// of a report (its evidence) or of a case (outcome, inspection, checks,
// officer evidence) are replaced as a set whenever the parent arrives with
// that kind of child, so a retaken photo or a cleared check never lingers.

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
import { CoreSnapshotRows } from "../mappers/snapshot";

export type RowCache = {
  reports: Map<string, BackendReportRow>;
  report_evidence: Map<string, BackendCitizenEvidenceRow>;
  cases: Map<string, BackendCaseRow>;
  /** keyed by case id (one outcome per case) */
  outcomes: Map<string, BackendOutcomeRow>;
  /** keyed by case id (one inspection per case) */
  inspections: Map<string, BackendInspectionRow>;
  /** keyed by `${inspection_id}:${check_key}` */
  inspection_checks: Map<string, BackendInspectionCheckRow>;
  officer_evidence: Map<string, BackendOfficerEvidenceRow>;
  ledger: Map<string, BackendLedgerRow>;
  notifications: Map<string, BackendNotificationRow>;
};

export const emptyCache = (): RowCache => ({
  reports: new Map(),
  report_evidence: new Map(),
  cases: new Map(),
  outcomes: new Map(),
  inspections: new Map(),
  inspection_checks: new Map(),
  officer_evidence: new Map(),
  ledger: new Map(),
  notifications: new Map(),
});

const arr = <T>(v: T[] | null | undefined): T[] | undefined => (Array.isArray(v) ? v : undefined);

/** Merge one server bundle (page, detail) into a copy of the cache. */
export function mergeBundle(cache: RowCache, bundle: Partial<CoreSnapshotRows>): RowCache {
  const next: RowCache = {
    reports: new Map(cache.reports),
    report_evidence: new Map(cache.report_evidence),
    cases: new Map(cache.cases),
    outcomes: new Map(cache.outcomes),
    inspections: new Map(cache.inspections),
    inspection_checks: new Map(cache.inspection_checks),
    officer_evidence: new Map(cache.officer_evidence),
    ledger: new Map(cache.ledger),
    notifications: new Map(cache.notifications),
  };

  const reports = arr(bundle.reports) ?? [];
  for (const r of reports) next.reports.set(r.id, r);
  const evidence = arr(bundle.report_evidence);
  if (evidence) {
    const parents = new Set(reports.map((r) => r.id));
    for (const [id, e] of next.report_evidence) if (parents.has(e.report_id)) next.report_evidence.delete(id);
    for (const e of evidence) next.report_evidence.set(e.id, e);
  }

  const cases = arr(bundle.cases) ?? [];
  for (const c of cases) next.cases.set(c.id, c);
  const caseIds = new Set(cases.map((c) => c.id));

  const outcomes = arr(bundle.outcomes);
  if (outcomes) {
    for (const id of caseIds) next.outcomes.delete(id);
    for (const o of outcomes) next.outcomes.set(o.case_id, o);
  }
  const inspections = arr(bundle.inspections);
  if (inspections) {
    for (const id of caseIds) {
      const old = next.inspections.get(id);
      if (old) for (const [k, ch] of next.inspection_checks) if (ch.inspection_id === old.id) next.inspection_checks.delete(k);
      next.inspections.delete(id);
    }
    for (const i of inspections) next.inspections.set(i.case_id, i);
  }
  const checks = arr(bundle.inspection_checks);
  if (checks) for (const ch of checks) next.inspection_checks.set(`${ch.inspection_id}:${ch.check_key}`, ch);
  const officerEvidence = arr(bundle.officer_evidence);
  if (officerEvidence) {
    for (const [id, e] of next.officer_evidence) if (caseIds.has(e.case_id)) next.officer_evidence.delete(id);
    for (const e of officerEvidence) next.officer_evidence.set(e.id, e);
  }

  for (const n of arr(bundle.notifications) ?? []) next.notifications.set(n.id, n);
  return next;
}

/** The citizen's full ledger replaces the cached one. */
export function replaceLedger(cache: RowCache, ledger: BackendLedgerRow[]): RowCache {
  return { ...cache, ledger: new Map(ledger.map((l) => [l.id, l])) };
}

export function cacheToRows(cache: RowCache): CoreSnapshotRows {
  return {
    reports: [...cache.reports.values()],
    report_evidence: [...cache.report_evidence.values()],
    cases: [...cache.cases.values()],
    outcomes: [...cache.outcomes.values()],
    inspections: [...cache.inspections.values()],
    inspection_checks: [...cache.inspection_checks.values()],
    officer_evidence: [...cache.officer_evidence.values()],
    ledger: [...cache.ledger.values()],
    notifications: [...cache.notifications.values()],
  };
}

/** The caller can no longer see this case (reassigned area, revoked access): forget it and its children. */
export function dropCase(cache: RowCache, caseId: string): RowCache {
  if (!cache.cases.has(caseId)) return cache;
  const next = mergeBundle(cache, {});
  next.cases.delete(caseId);
  next.outcomes.delete(caseId);
  const insp = next.inspections.get(caseId);
  if (insp) for (const [k, ch] of next.inspection_checks) if (ch.inspection_id === insp.id) next.inspection_checks.delete(k);
  next.inspections.delete(caseId);
  for (const [id, e] of next.officer_evidence) if (e.case_id === caseId) next.officer_evidence.delete(id);
  return next;
}
