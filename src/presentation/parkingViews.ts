// Parking view models (pure). All times are derived from ISO timestamps and
// a `now`; nothing like "42:27 left" is ever stored.

import {
  addMinutes,
  DEMO_PARKING_HOURLY_RATE_CENTS,
  DEMO_PARKING_ZONES,
  DemoParkingZone,
  estimateParkingCostCents,
  IsoTimestamp,
  MAX_PARKING_DURATION_MINUTES,
  ParkingSession,
  parkingCostCents,
  Vehicle,
} from "../domain";
import { formatDistance, LatLng, straightLineDistance } from "../geo/distance";
import { formatEuros } from "./viewModels";

const MINUTE = 60_000;

/** Duration presets on the Start Parking screen (minutes). "Custom" is handled separately. */
export const PARKING_DURATION_PRESETS: readonly { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 180, label: "3 hours" },
  { minutes: 240, label: "4 hours" },
];

/** Extension presets (minutes). */
export const PARKING_EXTENSION_PRESETS: readonly { minutes: number; label: string }[] = [
  { minutes: 15, label: "+15 min" },
  { minutes: 30, label: "+30 min" },
  { minutes: 60, label: "+1 hour" },
  { minutes: 120, label: "+2 hours" },
];

/** Custom duration stepper: 15-minute steps between 15 min and 24 h. */
export const CUSTOM_DURATION_STEP_MINUTES = 15;
export const CUSTOM_DURATION_MAX_MINUTES = 24 * 60;

export function clampCustomDuration(minutes: number): number {
  const stepped = Math.round(minutes / CUSTOM_DURATION_STEP_MINUTES) * CUSTOM_DURATION_STEP_MINUTES;
  return Math.min(CUSTOM_DURATION_MAX_MINUTES, Math.max(CUSTOM_DURATION_STEP_MINUTES, stepped));
}

// ---------------------------------------------------------------------------
// End-time wheel (Start Parking). The citizen picks WHEN parking ends on a
// 5-minute grid; the domain still receives a duration in minutes, so every
// existing rule (integer minutes, > 0, <= MAX_PARKING_DURATION_MINUTES) applies.

export const WHEEL_STEP_MINUTES = 5;
/** Shortest selectable session: the first row is at least this far in the future. */
export const WHEEL_MIN_MINUTES = 5;

const STEP_MS = WHEEL_STEP_MINUTES * MINUTE;

/** Round a time UP to the next 5-minute mark (a time already on a mark stays). */
export const ceilToWheelStep = (ms: number): number => Math.ceil(ms / STEP_MS) * STEP_MS;

/**
 * Selectable end times (epoch ms) for `now`: every 5-minute mark from at least
 * WHEEL_MIN_MINUTES ahead up to the longest allowed session.
 */
export function endTimeOptions(now: Date, maxMinutes = CUSTOM_DURATION_MAX_MINUTES): number[] {
  const t = now.getTime();
  const first = ceilToWheelStep(t + WHEEL_MIN_MINUTES * MINUTE);
  const last = t + maxMinutes * MINUTE;
  const out: number[] = [];
  for (let x = first; x <= last; x += STEP_MS) out.push(x);
  return out;
}

/**
 * Whole minutes from now until `endMs`, within the parking rules (1..max).
 * Rounded UP, so the session never ends before the chosen time (and the
 * displayed end, which drops seconds, is the chosen row).
 */
export function durationUntil(now: Date, endMs: number, maxMinutes = CUSTOM_DURATION_MAX_MINUTES): number {
  const m = Math.ceil((endMs - now.getTime()) / MINUTE);
  return Math.min(maxMinutes, Math.max(1, m));
}

/** Row index for an end time (nearest row; clamped to the list). */
export function wheelIndexFor(options: readonly number[], endMs: number): number {
  if (options.length === 0) return 0;
  const i = Math.round((endMs - options[0]) / STEP_MS);
  return Math.max(0, Math.min(options.length - 1, i));
}

/** The selected end time, kept valid as time passes (never in the past, never past the maximum). */
export function clampEndTime(options: readonly number[], endMs: number): number | undefined {
  return options.length ? options[wheelIndexFor(options, endMs)] : undefined;
}

/** End time for a preset duration: the NEAREST row of the 5-minute grid ("1 hour" stays about an hour). */
export const endTimeForPreset = (now: Date, minutes: number): number => Math.round((now.getTime() + minutes * MINUTE) / STEP_MS) * STEP_MS;

/** Screen-reader value of the wheel: "Ends at 14:35, 1 h 25 min". */
export const wheelAccessibilityText = (now: Date, endMs: number): string =>
  `Ends at ${formatClock(new Date(endMs).toISOString())}, ${formatDurationMinutes(durationUntil(now, endMs))}`;

/** "45 min", "1 h", "2 h 15 min". */
export function formatDurationMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Countdown "1:05:09" / "42:07" from milliseconds. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export function formatClock(iso: IsoTimestamp): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDay(iso: IsoTimestamp): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const zoneLabel = (zoneId: string) => DEMO_PARKING_ZONES.find((z) => z.id === zoneId)?.label ?? `Zone ${zoneId}`;

export const vehicleTitle = (v: Pick<Vehicle, "make" | "model">) => [v.make, v.model].filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Start Parking summary

export type ParkingQuote = {
  durationText: string;
  startText: string;
  endText: string;
  estimateText: string;
  rateText: string;
};

export function parkingQuote(durationMinutes: number, now: Date, hourlyRateCents = DEMO_PARKING_HOURLY_RATE_CENTS): ParkingQuote {
  const start = now.toISOString();
  return {
    durationText: formatDurationMinutes(durationMinutes),
    startText: formatClock(start),
    endText: formatClock(addMinutes(start, durationMinutes)),
    estimateText: formatEuros(estimateParkingCostCents(durationMinutes, hourlyRateCents)),
    rateText: `${formatEuros(hourlyRateCents)} / hour (demo rate)`,
  };
}

// ---------------------------------------------------------------------------
// Map-first parking: demo areas

export type ParkingAreaRow = {
  id: string;
  name: string;
  location: string;
  rateText: string;
  /** Straight-line distance from the device; only when a real fix exists. */
  distanceText?: string;
  distanceMeters?: number;
};

export const findZone = (zoneId: string | undefined): DemoParkingZone | undefined => DEMO_PARKING_ZONES.find((z) => z.id === zoneId);

export const hourlyRateText = (cents: number): string => `${formatEuros(cents)} / h`;

/**
 * Areas for the "Select area" sheet. With a device position they are sorted
 * nearest first (straight-line distance, never a route or ETA); without one
 * they keep the configured order. `query` matches the area code or name.
 */
export function parkingAreaRows(from: LatLng | undefined, query = ""): ParkingAreaRow[] {
  const q = query.trim().toLowerCase();
  const rows = DEMO_PARKING_ZONES.filter((z) => !q || z.id.toLowerCase().includes(q) || z.name.toLowerCase().includes(q) || z.location.toLowerCase().includes(q)).map((z) => {
    const d = straightLineDistance(from, z.center);
    return {
      id: z.id,
      name: z.name,
      location: z.location,
      rateText: hourlyRateText(z.hourlyRateCents),
      ...(d === null ? {} : { distanceMeters: d, distanceText: formatDistance(d) }),
    };
  });
  return from ? [...rows].sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)) : rows;
}

/** Facts shown for a selected area. Truthful: one flat demo rate, no time-of-day pricing. */
export function parkingAreaDetail(z: DemoParkingZone) {
  return {
    id: z.id,
    name: z.name,
    location: z.location,
    rateText: hourlyRateText(z.hourlyRateCents),
    pricingText: "Demo rate applies at all times",
    maxText: `Up to ${formatDurationMinutes(MAX_PARKING_DURATION_MINUTES)} per session`,
    sourceText: "Demo area · not official zone data",
  };
}

// ---------------------------------------------------------------------------
// Duration step / extension quotes (map-first flow)

export type DurationQuote = { durationText: string; endText: string; estimateCents: number; estimateText: string };

/** Live quote while choosing a duration: "1 h 15 min", ends "15:46", estimated demo cost. */
export function durationQuote(minutes: number, now: Date, hourlyRateCents: number): DurationQuote {
  const cents = estimateParkingCostCents(minutes, hourlyRateCents);
  return {
    durationText: formatDurationMinutes(minutes),
    endText: formatClock(addMinutes(now.toISOString(), minutes)),
    estimateCents: cents,
    estimateText: formatEuros(cents),
  };
}

export type ExtensionQuote = { currentEndText: string; newEndText: string; addedText: string; totalEstimateText: string };

/**
 * Extending: the domain adds time to the planned end, or to now if that has
 * passed. The estimate is the whole session at its demo rate up to the new end.
 */
export function extensionQuote(s: ParkingSession, addedMinutes: number, now: Date): ExtensionQuote {
  const end = Date.parse(s.plannedEndAt);
  const base = end > now.getTime() ? end : now.getTime();
  const newEnd = new Date(base + addedMinutes * MINUTE).toISOString();
  return {
    currentEndText: formatClock(s.plannedEndAt),
    newEndText: formatClock(newEnd),
    addedText: `+${formatDurationMinutes(addedMinutes)}`,
    totalEstimateText: formatEuros(parkingCostCents(s.hourlyRateCents, s.startedAt, newEnd)),
  };
}

// ---------------------------------------------------------------------------
// Active session

export type ActiveParkingView = {
  id: string;
  plate: string;
  zone: string;
  zoneId: string;
  /** Demo area name ("Railway Square"); the zone label when the area is unknown. */
  areaName: string;
  location: string;
  startText: string;
  endText: string;
  remainingMs: number;
  remainingText: string;
  elapsedText: string;
  expired: boolean;
  /** 0..1 of the planned time used (for the timer ring). */
  progress: number;
  currentCostText: string;
};

export function toActiveParkingView(s: ParkingSession, now: Date): ActiveParkingView {
  const start = Date.parse(s.startedAt);
  const end = Date.parse(s.plannedEndAt);
  const t = now.getTime();
  const remainingMs = Math.max(0, end - t);
  return {
    id: s.id,
    plate: s.plate.raw,
    zone: zoneLabel(s.zoneId),
    zoneId: s.zoneId,
    areaName: findZone(s.zoneId)?.name ?? zoneLabel(s.zoneId),
    location: s.location,
    startText: formatClock(s.startedAt),
    endText: formatClock(s.plannedEndAt),
    remainingMs,
    remainingText: formatCountdown(remainingMs),
    elapsedText: formatDurationMinutes((t - start) / MINUTE),
    expired: t >= end,
    progress: end > start ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 1,
    currentCostText: formatEuros(parkingCostCents(s.hourlyRateCents, s.startedAt, now.toISOString())),
  };
}

// ---------------------------------------------------------------------------
// History

export type ParkingHistoryItem = {
  id: string;
  plate: string;
  zone: string;
  location: string;
  dateText: string;
  startText: string;
  endText: string;
  durationText: string;
  costText: string;
  statusText: "Completed";
};

/** Completed sessions of one citizen, newest first. */
export function parkingHistory(sessions: readonly ParkingSession[], ownerId: string): ParkingHistoryItem[] {
  return sessions
    .filter((s) => s.ownerId === ownerId && s.status === "COMPLETED" && s.endedAt)
    .sort((a, b) => b.endedAt!.localeCompare(a.endedAt!) || b.id.localeCompare(a.id))
    .map((s) => ({
      id: s.id,
      plate: s.plate.raw,
      zone: zoneLabel(s.zoneId),
      location: s.location,
      dateText: formatDay(s.startedAt),
      startText: formatClock(s.startedAt),
      endText: formatClock(s.endedAt!),
      durationText: formatDurationMinutes((Date.parse(s.endedAt!) - Date.parse(s.startedAt)) / MINUTE),
      costText: formatEuros(s.finalCostCents ?? 0),
      statusText: "Completed",
    }));
}

// ---------------------------------------------------------------------------
// Vehicles

export type VehicleView = { id: string; plate: string; title: string; color?: string; isDefault: boolean };

/**
 * The citizen's vehicles, oldest first. The default (preselected for parking)
 * is the vehicle used most recently, else the first registered one.
 */
export function vehicleViews(vehicles: readonly Vehicle[], sessions: readonly ParkingSession[], ownerId: string): VehicleView[] {
  const mine = vehicles.filter((v) => v.ownerId === ownerId);
  const lastUsed = [...sessions]
    .filter((s) => s.ownerId === ownerId && mine.some((v) => v.id === s.vehicleId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.vehicleId;
  const defaultId = lastUsed ?? mine[0]?.id;
  return mine.map((v) => ({ id: v.id, plate: v.plate.raw, title: vehicleTitle(v), color: v.color, isDefault: v.id === defaultId }));
}
