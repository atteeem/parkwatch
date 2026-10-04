// Local, SIMULATED parking for the MVP: a citizen's vehicles and their
// parking sessions. Nothing here contacts a parking operator, municipality or
// payment provider; prices are demo prices (see config.ts). A real provider
// integration will later replace startParking/extendParking/endParking with
// adapter calls, keeping these shapes.

import { DEMO_PARKING_HOURLY_RATE_CENTS, DEMO_PARKING_ZONES, MAX_PARKING_DURATION_MINUTES } from "./config";
import { createPlateNumber, normalizePlate } from "./plate";
import { fail, ok, Result } from "./result";
import { IsoTimestamp, PlateNumber } from "./types";

export type Vehicle = {
  id: string;
  ownerId: string;
  plate: PlateNumber;
  make?: string;
  model?: string;
  color?: string;
  createdAt: IsoTimestamp;
};

export type ParkingSessionStatus = "ACTIVE" | "COMPLETED";

export type ParkingSession = {
  id: string;
  ownerId: string;
  vehicleId: string;
  /** Plate at the time of parking (history stays correct if the vehicle is edited later). */
  plate: PlateNumber;
  zoneId: string;
  location: string;
  startedAt: IsoTimestamp;
  plannedEndAt: IsoTimestamp;
  endedAt?: IsoTimestamp;
  status: ParkingSessionStatus;
  /** Demo rate captured at start, so later config changes don't rewrite history. */
  hourlyRateCents: number;
  /** Final simulated cost, set when the session is ended. */
  finalCostCents?: number;
  extensions: { at: IsoTimestamp; addedMinutes: number }[];
  /** Always "SIMULATED" in the MVP; a real provider will set its own id here. */
  provider: "SIMULATED";
};

const MINUTE = 60_000;
const trimOrUndefined = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

// ---------------------------------------------------------------------------
// Vehicles

export type NewVehicleInput = { plate: string; make?: string; model?: string; color?: string; country?: string };

/** Validate and create a vehicle. The same normalized plate can be registered only once per owner. */
export function addVehicle(
  existing: readonly Vehicle[],
  input: NewVehicleInput,
  meta: { id: string; ownerId: string; at: IsoTimestamp }
): Result<Vehicle> {
  const normalized = normalizePlate(input.plate ?? "");
  if (!normalized) return fail("INVALID_PLATE", "Enter the vehicle's licence plate.");
  if (existing.some((v) => v.ownerId === meta.ownerId && v.plate.normalized === normalized)) {
    return fail("DUPLICATE_VEHICLE", `${input.plate.trim()} is already registered.`);
  }
  return ok({
    id: meta.id,
    ownerId: meta.ownerId,
    // Display form is upper-case as on the physical plate; matching uses the normalized key.
    plate: createPlateNumber(input.plate.toUpperCase(), input.country ?? "FI"),
    make: trimOrUndefined(input.make),
    model: trimOrUndefined(input.model),
    color: trimOrUndefined(input.color),
    createdAt: meta.at,
  });
}

// ---------------------------------------------------------------------------
// Sessions

export function isValidParkingDuration(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_PARKING_DURATION_MINUTES;
}

export const addMinutes = (iso: IsoTimestamp, minutes: number): IsoTimestamp =>
  new Date(Date.parse(iso) + minutes * MINUTE).toISOString();

export function activeParkingSession(sessions: readonly ParkingSession[], ownerId: string): ParkingSession | undefined {
  return sessions.find((s) => s.ownerId === ownerId && s.status === "ACTIVE");
}

/** Simulated cost for a span of time at the session's demo rate (rounded to whole cents). */
export function parkingCostCents(hourlyRateCents: number, fromIso: IsoTimestamp, toIso: IsoTimestamp): number {
  const minutes = Math.max(0, (Date.parse(toIso) - Date.parse(fromIso)) / MINUTE);
  return Math.round((minutes / 60) * hourlyRateCents);
}

/** Estimate shown before starting: duration x demo rate. */
export function estimateParkingCostCents(minutes: number, hourlyRateCents = DEMO_PARKING_HOURLY_RATE_CENTS): number {
  return Math.round((minutes / 60) * hourlyRateCents);
}

/** Start one simulated session. Only one ACTIVE session per owner; never overwrites it. */
export function startParking(
  sessions: readonly ParkingSession[],
  vehicles: readonly Vehicle[],
  input: { vehicleId: string; zoneId: string; durationMinutes: number },
  meta: { id: string; ownerId: string; at: IsoTimestamp }
): Result<ParkingSession> {
  if (activeParkingSession(sessions, meta.ownerId)) {
    return fail("PARKING_ALREADY_ACTIVE", "You already have an active parking session.");
  }
  const vehicle = vehicles.find((v) => v.id === input.vehicleId && v.ownerId === meta.ownerId);
  if (!vehicle) return fail("NOT_FOUND", "Choose one of your registered vehicles.");
  const zone = DEMO_PARKING_ZONES.find((z) => z.id === input.zoneId);
  if (!zone) return fail("NOT_FOUND", "Choose a parking zone.");
  if (!isValidParkingDuration(input.durationMinutes)) {
    return fail("INVALID_DURATION", "Choose a parking time between 1 minute and 24 hours.");
  }
  return ok({
    id: meta.id,
    ownerId: meta.ownerId,
    vehicleId: vehicle.id,
    plate: vehicle.plate,
    zoneId: zone.id,
    location: zone.location,
    startedAt: meta.at,
    plannedEndAt: addMinutes(meta.at, input.durationMinutes),
    status: "ACTIVE",
    hourlyRateCents: DEMO_PARKING_HOURLY_RATE_CENTS,
    extensions: [],
    provider: "SIMULATED",
  });
}

/** Add time. If the planned end has already passed, the extension counts from now. */
export function extendParking(session: ParkingSession, addedMinutes: number, at: IsoTimestamp): Result<ParkingSession> {
  if (session.status !== "ACTIVE") return fail("NO_ACTIVE_PARKING", "This parking session has already ended.");
  if (!isValidParkingDuration(addedMinutes)) {
    return fail("INVALID_DURATION", "Choose an extension between 1 minute and 24 hours.");
  }
  const base = Date.parse(session.plannedEndAt) > Date.parse(at) ? session.plannedEndAt : at;
  return ok({
    ...session,
    plannedEndAt: addMinutes(base, addedMinutes),
    extensions: [...session.extensions, { at, addedMinutes }],
  });
}

/** Stop the session; the final simulated cost covers the actual parked time. */
export function endParking(session: ParkingSession, at: IsoTimestamp): Result<ParkingSession> {
  if (session.status !== "ACTIVE") return fail("NO_ACTIVE_PARKING", "This parking session has already ended.");
  return ok({
    ...session,
    status: "COMPLETED",
    endedAt: at,
    finalCostCents: parkingCostCents(session.hourlyRateCents, session.startedAt, at),
  });
}
