import { DEFAULT_MOCK_CHARGE_AMOUNT_CENTS } from "./config";
import { CitizenReportStatus, Cents, EnforcementOutcome, EnforcementOutcomeCode, IsoTimestamp } from "./types";

/**
 * What an officer's enforcement outcome means for the Citizen.
 *
 * RESOLVED: the product has decided the citizen-facing consequence.
 * UNRESOLVED: no product decision yet. The officer case still completes and
 *   the exact outcome is kept, but the citizen report status is NOT changed,
 *   no reward is granted and no citizen outcome notification is sent.
 */
export type CitizenConsequence =
  | {
      resolution: "RESOLVED";
      citizenStatus: Exclude<CitizenReportStatus, "UNDER_REVIEW">;
      rewardEligible: boolean;
      citizenNotification: "REPORT_VERIFIED" | "REPORT_REJECTED";
    }
  | {
      resolution: "UNRESOLVED";
      rewardEligible: false;
      citizenNotification: null;
      /** Open product question to settle before this mapping can be resolved. */
      todo: string;
    };

/**
 * THE ONLY place enforcement outcomes are mapped to citizen consequences.
 * Screens and the store must call getCitizenOutcomeForEnforcementOutcome
 * rather than re-deriving these rules.
 */
const CITIZEN_OUTCOME_MAPPING: Readonly<Record<EnforcementOutcomeCode, CitizenConsequence>> = {
  CHARGE_ISSUED: {
    resolution: "RESOLVED",
    citizenStatus: "VERIFIED",
    rewardEligible: true,
    citizenNotification: "REPORT_VERIFIED",
  },
  REPORT_REJECTED: {
    resolution: "RESOLVED",
    citizenStatus: "REJECTED",
    rewardEligible: false,
    citizenNotification: "REPORT_REJECTED",
  },
  VEHICLE_MOVED: {
    resolution: "UNRESOLVED",
    rewardEligible: false,
    citizenNotification: null,
    todo: "Decide the citizen status and reward when the vehicle moved before the officer arrived.",
  },
  VALID_PERMIT: {
    resolution: "UNRESOLVED",
    rewardEligible: false,
    citizenNotification: null,
    todo: "Decide the citizen status and reward when a valid permit was displayed.",
  },
  DUPLICATE: {
    resolution: "UNRESOLVED",
    rewardEligible: false,
    citizenNotification: null,
    todo: "Decide the citizen status and reward for a duplicate report (no Duplicate status exists in the citizen UI).",
  },
  OTHER: {
    resolution: "UNRESOLVED",
    rewardEligible: false,
    citizenNotification: null,
    todo: "Decide the citizen status and reward for an 'Other' closure.",
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
