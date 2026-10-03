// Central MVP business configuration.
//
// These are PROTOTYPE values taken from the current Figma designs, not
// permanent product rules. They will later be replaced by operator- or
// municipality-specific configuration. Nothing outside src/domain should
// hardcode these numbers.
//
// Money is stored as integer minor units (cents) to avoid floating-point
// rounding. Formatting to "€5.00" belongs to the presentation layer.

export const MVP_CURRENCY = "EUR" as const;

/** Estimated reward shown to a Citizen for a qualifying report (€5.00). */
export const MVP_REWARD_AMOUNT_CENTS = 500;

/** Example parking charge recorded when an Officer issues a charge (€60.00). */
export const DEFAULT_MOCK_CHARGE_AMOUNT_CENTS = 6000;

/** Minimum Citizen withdrawal per the Withdraw Money screen (€5.00). */
export const MIN_WITHDRAWAL_AMOUNT_CENTS = 500;

/**
 * Development stand-in for plate/vehicle detection. Later replaced by
 * camera/OCR -> detected plate -> Citizen confirmation. Screens must read
 * vehicle data from the report, never hardcode these strings.
 */
export const MVP_MOCK_DETECTED_VEHICLE = {
  plate: "GHC-789",
  make: "Volvo",
  model: "XC60",
  color: "Dark Grey",
  source: "MOCK_DETECTED",
} as const;
