import { completeCase } from "./caseLifecycle";
import { completeInspection } from "./inspection";
import { applyOutcomeToLedger, Ledger } from "./ledger";
import {
  appendNotificationOnce,
  buildCitizenOutcomeNotification,
  buildOfficerCompletionNotification,
} from "./notifications";
import { CitizenConsequence, createEnforcementOutcome, getCitizenOutcomeForEnforcementOutcome } from "./outcomes";
import { applyCitizenConsequenceToReport } from "./report";
import { fail, ok, Result } from "./result";
import { Cents, EnforcementOutcomeCode, Inspection, IsoTimestamp, Notification, OfficerCase, Report } from "./types";

export type EnforcementState = {
  officerCase: OfficerCase;
  inspection: Inspection;
  report: Report;
  ledger: Ledger;
  notifications: readonly Notification[];
};

export type EnforcementResult = {
  state: EnforcementState;
  consequence: CitizenConsequence;
  creditedCents: Cents;
  /** false when this exact outcome had already been applied (retry/double tap). */
  changed: boolean;
};

/**
 * Record an officer's enforcement outcome and apply every consequence:
 * inspection locked, case COMPLETED with outcome, citizen report status (only
 * if the mapping is resolved), reward ledger and notifications.
 *
 * Pure and atomic: it either returns a complete new state or an error and
 * the input state untouched.
 *
 * Idempotent: re-submitting the same outcome for an already-completed case
 * returns the existing state with changed=false. No second reward, completion
 * event or notification is created.
 */
export function completeCaseWithOutcome(
  state: EnforcementState,
  input: {
    code: EnforcementOutcomeCode;
    officerId: string;
    decidedAt: IsoTimestamp;
    notes?: string;
    chargeAmountCents?: Cents;
  }
): Result<EnforcementResult> {
  const { officerCase, inspection, report } = state;
  if (officerCase.reportId !== report.id || inspection.caseId !== officerCase.id) {
    return fail("CASE_REPORT_MISMATCH", "Case, inspection and report do not belong together.");
  }

  const consequence = getCitizenOutcomeForEnforcementOutcome(input.code);

  if (officerCase.status === "COMPLETED") {
    if (officerCase.outcome?.code === input.code) {
      return ok({ state, consequence, creditedCents: 0, changed: false });
    }
    return fail("ALREADY_COMPLETED", `Case ${officerCase.id} is already completed with ${officerCase.outcome?.code}.`);
  }

  const outcome = createEnforcementOutcome(input);

  const inspected = completeInspection(inspection, outcome);
  if (!inspected.ok) return inspected;

  const completed = completeCase(officerCase, outcome);
  if (!completed.ok) return completed;

  const updatedReport = applyCitizenConsequenceToReport(report, consequence, outcome.decidedAt);
  if (!updatedReport.ok) return updatedReport;

  const rewarded = applyOutcomeToLedger(state.ledger, consequence, {
    citizenId: report.citizenId,
    reportId: report.id,
    at: outcome.decidedAt,
  });
  if (!rewarded.ok) return rewarded;

  let notifications = [...state.notifications];
  const citizenNote = buildCitizenOutcomeNotification(consequence, {
    citizenId: report.citizenId,
    reportId: report.id,
    caseId: officerCase.id,
    at: outcome.decidedAt,
    creditedCents: rewarded.value.creditedCents,
  });
  if (citizenNote) notifications = appendNotificationOnce(notifications, citizenNote).notifications;
  notifications = appendNotificationOnce(
    notifications,
    buildOfficerCompletionNotification({
      officerId: input.officerId,
      caseId: officerCase.id,
      reportId: report.id,
      outcome,
    })
  ).notifications;

  return ok({
    state: {
      officerCase: completed.value.case,
      inspection: inspected.value.inspection,
      report: updatedReport.value.report,
      ledger: rewarded.value.ledger,
      notifications,
    },
    consequence,
    creditedCents: rewarded.value.creditedCents,
    changed: true,
  });
}
