import { CitizenConsequence } from "./outcomes";
import { Cents, EnforcementOutcome, IsoTimestamp, Notification } from "./types";

/** Append unless a notification with the same idempotency key exists. */
export function appendNotificationOnce(
  list: readonly Notification[],
  n: Notification
): { notifications: Notification[]; appended: boolean } {
  if (list.some((x) => x.idempotencyKey === n.idempotencyKey)) return { notifications: [...list], appended: false };
  return { notifications: [...list, n], appended: true };
}

/**
 * The citizen notification implied by an enforcement consequence, or null.
 * UNRESOLVED outcomes never notify the citizen.
 * Copy ("Report verified", "+€5.00 added…") is produced by the presentation layer.
 */
export function buildCitizenOutcomeNotification(
  consequence: CitizenConsequence,
  input: { citizenId: string; reportId: string; caseId?: string; at: IsoTimestamp; creditedCents: Cents }
): Notification | null {
  if (consequence.citizenNotification === null) return null;
  const idempotencyKey = `${consequence.citizenNotification}:${input.reportId}`;
  return {
    id: idempotencyKey,
    idempotencyKey,
    recipient: { role: "CITIZEN", accountId: input.citizenId },
    type: consequence.citizenNotification,
    createdAt: input.at,
    reportId: input.reportId,
    caseId: input.caseId,
    amountCents: consequence.citizenNotification === "REPORT_VERIFIED" ? input.creditedCents : undefined,
  };
}

/** Officer-side confirmation of a completed case (both kinds appear in the officer designs). */
export function buildOfficerCompletionNotification(input: {
  officerId: string;
  caseId: string;
  reportId: string;
  outcome: EnforcementOutcome;
}): Notification {
  const type = input.outcome.code === "CHARGE_ISSUED" ? "PARKING_CHARGE_ISSUED" : "CASE_CLOSED_WITHOUT_CHARGE";
  const idempotencyKey = `${type}:${input.caseId}`;
  return {
    id: idempotencyKey,
    idempotencyKey,
    recipient: { role: "OFFICER", accountId: input.officerId },
    type,
    createdAt: input.outcome.decidedAt,
    reportId: input.reportId,
    caseId: input.caseId,
    amountCents: input.outcome.chargeAmountCents,
  };
}
