// Central MVP business configuration.
//
// These are PROTOTYPE values taken from the current Figma designs, not
// permanent product rules. They will later be replaced by operator- or
// municipality-specific configuration. Nothing outside src/domain should
// hardcode these numbers.
//
// Money is stored as integer minor units (cents) to avoid floating-point
// rounding. Formatting to "€5.00" belongs to the presentation layer.

import { createPlateNumber } from "./plate";
import { VehicleInfo } from "./types";

export const MVP_CURRENCY = "EUR" as const;

/** The single demo jurisdiction. No zone/jurisdiction engine exists yet. */
export const MVP_DEFAULT_JURISDICTION_ID = "helsinki-demo";

/** Estimated reward shown to a Citizen for a qualifying report (€5.00). */
export const MVP_REWARD_AMOUNT_CENTS = 500;

/** Example parking charge recorded when an Officer issues a charge (€60.00). */
export const DEFAULT_MOCK_CHARGE_AMOUNT_CENTS = 6000;

/** Minimum Citizen withdrawal per the Withdraw Money screen (€5.00). */
export const MIN_WITHDRAWAL_AMOUNT_CENTS = 500;

/** Mock officer distance for a newly submitted report (no real GPS/routing yet). */
export const MVP_MOCK_NEW_CASE_DISTANCE_METERS = 400;

/**
 * Development stand-in for plate/vehicle detection. Later replaced by
 * camera/OCR -> detected plate -> Citizen confirmation. Screens must read
 * vehicle data from the report, never hardcode these strings.
 */
export const MVP_MOCK_DETECTED_VEHICLE: Readonly<VehicleInfo> = {
  plate: createPlateNumber("GHC-789", "FI"),
  make: "Volvo",
  model: "XC60",
  color: "Dark Grey",
  source: "MOCK_DETECTED",
};

// ---------------------------------------------------------------------------
// Local (simulated) parking. DEMO values only: not the price of any real
// zone, municipality or parking operator. No provider is contacted.

/** Demo hourly rate for simulated parking (€2.00 / hour). */
export const DEMO_PARKING_HOURLY_RATE_CENTS = 200;

/** Longest single parking duration (start or extension) the MVP accepts. */
export const MAX_PARKING_DURATION_MINUTES = 24 * 60;

/** Demo zones offered when starting simulated parking. */
export const DEMO_PARKING_ZONES: readonly { id: string; label: string; location: string }[] = [
  { id: "B2", label: "Zone B2", location: "Fredrikinkatu 22, Helsinki" },
  { id: "A1", label: "Zone A1", location: "Kaivokatu 12, Helsinki" },
  { id: "C4", label: "Zone C4", location: "Pohjoisesplanadi 33, Helsinki" },
];
