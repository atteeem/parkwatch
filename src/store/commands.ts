// Store commands: pure (state, input) -> Result<{ state, value }>.
//
// Commands ORCHESTRATE: they look things up, call domain functions and write
// the results back. Every business rule (valid transitions, inspection
// readiness, outcome consequences, reward and withdrawal rules) is decided by
// src/domain. A failed command returns the error and the caller keeps the old
// state.

import {
  appendNotificationOnce,
  attachOfficerEvidence,
  ChecklistKey,
  completeCaseWithOutcome,
  createCase,
  createInspection,
  createOfficerEvidence,
  createReportFromDraft,
  EnforcementOutcomeCode,
  EventSource,
  fail,
  findReportForDraft,
  Inspection,
  IsoTimestamp,
  markNotificationsRead,
  markWithdrawalPaid,
  MVP_DEFAULT_JURISDICTION_ID,
  MVP_MOCK_DETECTED_VEHICLE,
  MVP_MOCK_NEW_CASE_DISTANCE_METERS,
  Notification,
  OfficerCase,
  OfficerEvidenceType,
  CaptureSource,
  ok,
  recordPendingReward,
  ReportDraft,
  ReportPriority,
  requestWithdrawal,
  Result,
  setChecklistItem,
  setInspectionNotes,
  transitionCase,
  VehicleInfo,
} from "../domain";
import { ParkWatchState } from "./state";

export type CommandResult<T> = Result<{ state: ParkWatchState; value: T }>;

const done = <T>(state: ParkWatchState, value: T): CommandResult<T> => ok({ state, value });

/** Event source for a command; defaults to a person acting in the app. */
type Sourced = { source?: EventSource };
const srcOf = (input: Sourced): EventSource => input.source ?? "USER_ACTION";
const officerActor = (officerId: string) => ({ role: "OFFICER" as const, accountId: officerId });

function nextId(state: ParkWatchState, prefix: string): [string, ParkWatchState] {
  return [`${prefix}-${state.seq}`, { ...state, seq: state.seq + 1 }];
}

function findCase(state: ParkWatchState, caseId: string): Result<OfficerCase> {
  const c = state.cases.find((x) => x.id === caseId);
  return c ? ok(c) : fail("NOT_FOUND", `Case ${caseId} not found.`);
}

const replaceCase = (state: ParkWatchState, c: OfficerCase): ParkWatchState => ({
  ...state,
  cases: state.cases.map((x) => (x.id === c.id ? c : x)),
});

const putInspection = (state: ParkWatchState, i: Inspection): ParkWatchState => ({
  ...state,
  inspections: { ...state.inspections, [i.caseId]: i },
});

const addNotification = (state: ParkWatchState, n: Notification): ParkWatchState => ({
  ...state,
  notifications: appendNotificationOnce(state.notifications, n).notifications,
});

// ---------------------------------------------------------------------------
// Citizen: submit report

export type SubmissionOptions = {
  reportId: string;
  jurisdictionId: string;
  vehicle: VehicleInfo;
  priority: ReportPriority;
  distanceMeters: number;
};

/**
 * Create the linked Report + Officer Case + pending reward + "under review"
 * notification for a draft. Shared by submitReport and seed data so both use
 * one code path.
 */
export function createSubmission(
  state: ParkWatchState,
  input: { draft: ReportDraft; citizenId: string; at: IsoTimestamp } & Sourced,
  opts: SubmissionOptions
): CommandResult<{ reportId: string; created: boolean }> {
  const source = srcOf(input);
  const existing = findReportForDraft(state.reports, input.draft.draftId);
  if (existing) return done(state, { reportId: existing.id, created: false });

  const caseId = `c-${opts.reportId}`;
  const report = createReportFromDraft(input.draft, {
    id: opts.reportId,
    citizenId: input.citizenId,
    jurisdictionId: opts.jurisdictionId,
    submittedAt: input.at,
    source,
    vehicle: opts.vehicle,
    priority: opts.priority,
    caseId,
  });
  if (!report.ok) return report;
  if (state.reports.some((r) => r.id === opts.reportId)) {
    return fail("INVALID_DRAFT", `Report id ${opts.reportId} already exists.`);
  }

  const officerCase = createCase({
    id: caseId,
    reportId: opts.reportId,
    jurisdictionId: opts.jurisdictionId,
    priority: opts.priority,
    createdAt: input.at,
    distanceMeters: opts.distanceMeters,
    // The case is created by the citizen's submission.
    actor: { role: "CITIZEN", accountId: input.citizenId },
    source,
  });

  let next: ParkWatchState = {
    ...state,
    reports: [...state.reports, report.value],
    cases: [...state.cases, officerCase],
    ledger: [...recordPendingReward(state.ledger, { citizenId: input.citizenId, reportId: opts.reportId, at: input.at })],
  };
  const key = `REPORT_UNDER_REVIEW:${opts.reportId}`;
  next = addNotification(next, {
    id: key,
    idempotencyKey: key,
    recipient: { role: "CITIZEN", accountId: input.citizenId },
    type: "REPORT_UNDER_REVIEW",
    createdAt: input.at,
    reportId: opts.reportId,
    caseId,
  });
  return done(next, { reportId: opts.reportId, created: true });
}

/**
 * Submit a citizen draft. Idempotent per draftId: a repeated submit returns
 * the existing report and creates nothing new.
 */
export function submitReport(
  state: ParkWatchState,
  input: { draft: ReportDraft; citizenId: string; at: IsoTimestamp } & Sourced
): CommandResult<{ reportId: string; created: boolean }> {
  const existing = findReportForDraft(state.reports, input.draft.draftId);
  if (existing) return done(state, { reportId: existing.id, created: false });

  const reportId = String(state.nextReportNumber);
  const result = createSubmission(state, input, {
    reportId,
    jurisdictionId: MVP_DEFAULT_JURISDICTION_ID,
    vehicle: MVP_MOCK_DETECTED_VEHICLE,
    priority: "NORMAL",
    distanceMeters: MVP_MOCK_NEW_CASE_DISTANCE_METERS,
  });
  if (!result.ok) return result;
  return done({ ...result.value.state, nextReportNumber: state.nextReportNumber + 1 }, result.value.value);
}

// ---------------------------------------------------------------------------
// Officer: case lifecycle

/** NEW -> ASSIGNED only (e.g. pre-assigned work; the Accept button uses acceptCase). */
export function assignCase(
  state: ParkWatchState,
  input: { caseId: string; officerId: string; at: IsoTimestamp } & Sourced
): CommandResult<void> {
  const found = findCase(state, input.caseId);
  if (!found.ok) return found;
  const moved = transitionCase(found.value, "ASSIGNED", { at: input.at, actor: officerActor(input.officerId), source: srcOf(input) });
  return moved.ok ? done(replaceCase(state, moved.value), undefined) : moved;
}

/** NEW -> ASSIGNED (to this officer) -> EN_ROUTE. Accept leads straight to the En Route screen. */
export function acceptCase(
  state: ParkWatchState,
  input: { caseId: string; officerId: string; at: IsoTimestamp } & Sourced
): CommandResult<void> {
  const found = findCase(state, input.caseId);
  if (!found.ok) return found;
  let c = found.value;

  if (c.status === "NEW") {
    const assigned = transitionCase(c, "ASSIGNED", { at: input.at, actor: officerActor(input.officerId), source: srcOf(input) });
    if (!assigned.ok) return assigned;
    c = assigned.value;
  } else if (c.assignedOfficerId && c.assignedOfficerId !== input.officerId) {
    return fail("CASE_TAKEN", `Case ${c.id} is assigned to another officer.`);
  }
  const enRoute = transitionCase(c, "EN_ROUTE", { at: input.at, actor: officerActor(input.officerId), source: srcOf(input) });
  if (!enRoute.ok) return enRoute;

  const key = `CASE_ACCEPTED:${c.id}`;
  const next = addNotification(replaceCase(state, enRoute.value), {
    id: key,
    idempotencyKey: key,
    recipient: { role: "OFFICER", accountId: input.officerId },
    type: "CASE_ACCEPTED",
    createdAt: input.at,
    reportId: c.reportId,
    caseId: c.id,
  });
  return done(next, undefined);
}

/** ASSIGNED -> EN_ROUTE (when travel starts separately from accepting). */
export function startEnRoute(
  state: ParkWatchState,
  input: { caseId: string; officerId: string; at: IsoTimestamp } & Sourced
): CommandResult<void> {
  const found = findCase(state, input.caseId);
  if (!found.ok) return found;
  const moved = transitionCase(found.value, "EN_ROUTE", { at: input.at, actor: officerActor(input.officerId), source: srcOf(input) });
  return moved.ok ? done(replaceCase(state, moved.value), undefined) : moved;
}

/** EN_ROUTE -> ON_SITE (separate "arrived" step; not used by the current UI). */
export function arriveOnSite(
  state: ParkWatchState,
  input: { caseId: string; officerId: string; at: IsoTimestamp } & Sourced
): CommandResult<void> {
  const found = findCase(state, input.caseId);
  if (!found.ok) return found;
  const moved = transitionCase(found.value, "ON_SITE", { at: input.at, actor: officerActor(input.officerId), source: srcOf(input) });
  return moved.ok ? done(replaceCase(state, moved.value), undefined) : moved;
}

/**
 * EN_ROUTE/ON_SITE -> INSPECTION and create the case's inspection.
 * Idempotent if the case is already in INSPECTION (re-opening the screen
 * never wipes an existing inspection).
 */
export function startInspection(
  state: ParkWatchState,
  input: { caseId: string; officerId: string; at: IsoTimestamp } & Sourced
): CommandResult<void> {
  const found = findCase(state, input.caseId);
  if (!found.ok) return found;
  let next = state;
  if (found.value.status !== "INSPECTION") {
    const moved = transitionCase(found.value, "INSPECTION", { at: input.at, actor: officerActor(input.officerId), source: srcOf(input) });
    if (!moved.ok) return moved;
    next = replaceCase(next, moved.value);
  }
  return ensureInspection(next, { caseId: input.caseId, at: input.at });
}

/** Create the inspection for a case in INSPECTION if it does not exist yet. Never overwrites. */
export function ensureInspection(
  state: ParkWatchState,
  input: { caseId: string; at: IsoTimestamp }
): CommandResult<void> {
  const found = findCase(state, input.caseId);
  if (!found.ok) return found;
  if (found.value.status !== "INSPECTION") {
    return fail("INVALID_TRANSITION", `Case ${input.caseId} is not in INSPECTION.`);
  }
  if (state.inspections[input.caseId]) return done(state, undefined);
  return done(
    putInspection(state, createInspection({ id: `i-${input.caseId}`, caseId: input.caseId, startedAt: input.at })),
    undefined
  );
}

function withInspection(
  state: ParkWatchState,
  caseId: string,
  update: (i: Inspection) => Result<Inspection>
): CommandResult<void> {
  const inspection = state.inspections[caseId];
  if (!inspection) return fail("NOT_FOUND", `No inspection for case ${caseId}.`);
  const updated = update(inspection);
  return updated.ok ? done(putInspection(state, updated.value), undefined) : updated;
}

export function updateChecklist(
  state: ParkWatchState,
  input: { caseId: string; key: ChecklistKey; value: boolean | null }
): CommandResult<void> {
  return withInspection(state, input.caseId, (i) => setChecklistItem(i, input.key, input.value));
}

export function attachOfficerPhoto(
  state: ParkWatchState,
  input: { caseId: string; type: OfficerEvidenceType; captureSource: CaptureSource; uri: string; at: IsoTimestamp }
): CommandResult<{ evidenceId: string }> {
  const [evidenceId, withId] = nextId(state, "ev");
  const evidence = createOfficerEvidence({
    id: evidenceId,
    type: input.type,
    captureSource: input.captureSource,
    uri: input.uri,
    capturedAt: input.at,
  });
  const r = withInspection(withId, input.caseId, (i) => attachOfficerEvidence(i, evidence));
  return r.ok ? done(r.value.state, { evidenceId }) : r;
}

export function updateInspectionNotes(
  state: ParkWatchState,
  input: { caseId: string; notes: string }
): CommandResult<void> {
  return withInspection(state, input.caseId, (i) => setInspectionNotes(i, input.notes));
}

/**
 * Record the officer's enforcement outcome via the domain's
 * completeCaseWithOutcome (case, inspection, report, ledger, notifications
 * updated together). Idempotent for the same outcome.
 */
export function completeCase(
  state: ParkWatchState,
  input: { caseId: string; code: EnforcementOutcomeCode; officerId: string; at: IsoTimestamp; notes?: string } & Sourced
): CommandResult<{ changed: boolean; creditedCents: number }> {
  const found = findCase(state, input.caseId);
  if (!found.ok) return found;
  const report = state.reports.find((r) => r.id === found.value.reportId);
  if (!report) return fail("NOT_FOUND", `Report ${found.value.reportId} not found.`);
  const inspection = state.inspections[input.caseId];
  if (!inspection) return fail("NOT_FOUND", `No inspection for case ${input.caseId}.`);

  const result = completeCaseWithOutcome(
    { officerCase: found.value, inspection, report, ledger: state.ledger, notifications: state.notifications },
    { code: input.code, officerId: input.officerId, decidedAt: input.at, notes: input.notes, source: srcOf(input) }
  );
  if (!result.ok) return result;
  const { changed, creditedCents, state: s } = result.value;
  if (!changed) return done(state, { changed, creditedCents });

  const next: ParkWatchState = {
    ...putInspection(replaceCase(state, s.officerCase), s.inspection),
    reports: state.reports.map((r) => (r.id === s.report.id ? s.report : r)),
    ledger: [...s.ledger],
    notifications: [...s.notifications],
  };
  return done(next, { changed, creditedCents });
}

// ---------------------------------------------------------------------------
// Citizen: wallet

export function requestCitizenWithdrawal(
  state: ParkWatchState,
  input: { citizenId: string; amountCents: number; at: IsoTimestamp; withdrawalId?: string }
): CommandResult<{ withdrawalId: string }> {
  let next = state;
  let withdrawalId = input.withdrawalId;
  if (!withdrawalId) [withdrawalId, next] = nextId(state, "w");
  const r = requestWithdrawal(next.ledger, {
    withdrawalId,
    citizenId: input.citizenId,
    amountCents: input.amountCents,
    at: input.at,
  });
  if (!r.ok) return r;
  return done({ ...next, ledger: [...r.value.ledger] }, { withdrawalId });
}

/** Future payout-provider confirmation; used by seed data only in the MVP. */
export function confirmWithdrawalPaid(
  state: ParkWatchState,
  input: { withdrawalId: string; at: IsoTimestamp }
): CommandResult<void> {
  const r = markWithdrawalPaid(state.ledger, input);
  return r.ok ? done({ ...state, ledger: [...r.value] }, undefined) : r;
}

// ---------------------------------------------------------------------------
// Notifications

export function markRead(
  state: ParkWatchState,
  input: { recipient: Notification["recipient"]; at: IsoTimestamp }
): CommandResult<void> {
  return done({ ...state, notifications: markNotificationsRead(state.notifications, input.recipient, input.at) }, undefined);
}
