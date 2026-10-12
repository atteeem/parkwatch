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

export type DemoLatLng = { latitude: number; longitude: number };

/**
 * A demo parking area. Geometry, names and prices are ILLUSTRATIVE ONLY: they are
 * not official municipal zones or any operator's areas. The flat demo rate
 * applies at all times (no time-of-day pricing is simulated).
 */
export type DemoParkingZone = {
  /** Area code shown on the map badge (also the session's zoneId). */
  id: string;
  label: string;
  /** Short area name. */
  name: string;
  /** Street address stored on the session. */
  location: string;
  hourlyRateCents: number;
  /** Badge position. */
  center: DemoLatLng;
  /** Demo outline drawn on the map (closed by the map). */
  boundary: readonly DemoLatLng[];
};

/** A small rectangular demo outline around a centre point. */
const demoBox = (c: DemoLatLng, halfLat = 0.0006, halfLng = 0.0013): DemoLatLng[] => [
  { latitude: c.latitude + halfLat, longitude: c.longitude - halfLng },
  { latitude: c.latitude + halfLat, longitude: c.longitude + halfLng },
  { latitude: c.latitude - halfLat, longitude: c.longitude + halfLng },
  { latitude: c.latitude - halfLat, longitude: c.longitude - halfLng },
];

const zone = (z: Omit<DemoParkingZone, "label" | "boundary">): DemoParkingZone => ({ ...z, label: `Zone ${z.id}`, boundary: demoBox(z.center) });

/** Demo zones offered when starting simulated parking. */
export const DEMO_PARKING_ZONES: readonly DemoParkingZone[] = [
  zone({ id: "B2", name: "Fredrikinkatu", location: "Fredrikinkatu 22, Helsinki", hourlyRateCents: DEMO_PARKING_HOURLY_RATE_CENTS, center: { latitude: 60.1622, longitude: 24.9368 } }),
  zone({ id: "A1", name: "Railway Square", location: "Kaivokatu 12, Helsinki", hourlyRateCents: DEMO_PARKING_HOURLY_RATE_CENTS, center: { latitude: 60.1706, longitude: 24.9425 } }),
  zone({ id: "C4", name: "Esplanadi", location: "Pohjoisesplanadi 33, Helsinki", hourlyRateCents: 300, center: { latitude: 60.1676, longitude: 24.9475 } }),
  zone({ id: "D7", name: "Kamppi", location: "Malminkatu 5, Helsinki", hourlyRateCents: 300, center: { latitude: 60.1683, longitude: 24.9301 } }),
  zone({ id: "E3", name: "Market Square", location: "Eteläranta 10, Helsinki", hourlyRateCents: 250, center: { latitude: 60.1662, longitude: 24.9532 } }),
];
