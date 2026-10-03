import { DEFAULT_MOCK_CHARGE_AMOUNT_CENTS } from "./config";
import { CitizenReportStatus, Cents, EnforcementOutcome, EnforcementOutcomeCode, IsoTimestamp } from "./types";

/**
 * What an officer's enforcement outcome means for the Citizen.
 *
 * Two questions are answered SEPARATELY:
 *
 * citizenStatus — which citizen-facing report status results.
 *   RESOLVED:   the product has decided (VERIFIED / REJECTED).
 *   UNRESOLVED: no decision yet; the report status is left unchanged.
 *
 * reward — what happens to the report's single pending reward. This is
 *   decided for EVERY outcome:
 *   RELEASE_PENDING: pending reward becomes available (CHARGE_ISSUED only).
 *   CANCEL_PENDING:  pending reward is cancelled; it no longer counts as
 *                    pending and never becomes available.
 */
export type CitizenStatusMapping =
  | { resolution: "RESOLVED"; status: Exclude<CitizenReportStatus, "UNDER_REVIEW"> }
  | {
      resolution: "UNRESOLVED";
      /** Open product question to settle before this status mapping can be resolved. */
      todo: string;
    };

export type RewardEffect = "RELEASE_PENDING" | "CANCEL_PENDING";

export type CitizenConsequence = {
  citizenStatus: CitizenStatusMapping;
  reward: RewardEffect;
  /** null = no citizen outcome notification. */
  citizenNotification: "REPORT_VERIFIED" | "REPORT_REJECTED" | null;
};

const unresolvedStatus = (todo: string): CitizenStatusMapping => ({ resolution: "UNRESOLVED", todo });

/**
 * THE ONLY place enforcement outcomes are mapped to citizen consequences.
 * Screens and the store must call getCitizenOutcomeForEnforcementOutcome
 * rather than re-deriving these rules.
 */
const CITIZEN_OUTCOME_MAPPING: Readonly<Record<EnforcementOutcomeCode, CitizenConsequence>> = {
  CHARGE_ISSUED: {
    citizenStatus: { resolution: "RESOLVED", status: "VERIFIED" },
    reward: "RELEASE_PENDING",
    citizenNotification: "REPORT_VERIFIED",
  },
  REPORT_REJECTED: {
    citizenStatus: { resolution: "RESOLVED", status: "REJECTED" },
    reward: "CANCEL_PENDING",
    citizenNotification: "REPORT_REJECTED",
  },
  VEHICLE_MOVED: {
    citizenStatus: unresolvedStatus("Decide the citizen-facing status when the vehicle moved before the officer arrived."),
    reward: "CANCEL_PENDING",
    citizenNotification: null,
  },
  VALID_PERMIT: {
    citizenStatus: unresolvedStatus("Decide the citizen-facing status when a valid permit was displayed."),
    reward: "CANCEL_PENDING",
    citizenNotification: null,
  },
  DUPLICATE: {
    citizenStatus: unresolvedStatus(
      "Decide the citizen-facing status for a duplicate report (no Duplicate status exists in the citizen UI)."
    ),
    reward: "CANCEL_PENDING",
    citizenNotification: null,
  },
  OTHER: {
    citizenStatus: unresolvedStatus("Decide the citizen-facing status for an 'Other' closure."),
    reward: "CANCEL_PENDING",
    citizenNotification: null,
  },
};

export function getCitizenOutcomeForEnforcementOutcome(code: EnforcementOutcomeCode): CitizenConsequence {
  return CITIZEN_OUTCOME_MAPPING[code];
}

/** Build an outcome record. Only CHARGE_ISSUED carries a charge amount. */
export function createEnforcementOutcome(input: {
  code: EnforcementOutcomeCode;
  decidedAt: IsoTimestamp;
  officerId: string;
  notes?: string;
  chargeAmountCents?: Cents;
}): EnforcementOutcome {
  const notes = input.notes?.trim() ? input.notes : undefined;
  return {
    code: input.code,
    decidedAt: input.decidedAt,
    officerId: input.officerId,
    notes,
    chargeAmountCents:
      input.code === "CHARGE_ISSUED" ? input.chargeAmountCents ?? DEFAULT_MOCK_CHARGE_AMOUNT_CENTS : undefined,
  };
}
