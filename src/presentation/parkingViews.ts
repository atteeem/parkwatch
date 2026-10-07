// Parking view models (pure). All times are derived from ISO timestamps and
// a `now`; nothing like "42:27 left" is ever stored.

import {
  addMinutes,
  DEMO_PARKING_HOURLY_RATE_CENTS,
  DEMO_PARKING_ZONES,
  estimateParkingCostCents,
  IsoTimestamp,
  ParkingSession,
  parkingCostCents,
  Vehicle,
} from "../domain";
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

export function parkingQuote(durationMinutes: number, now: Date): ParkingQuote {
  const start = now.toISOString();
  return {
    durationText: formatDurationMinutes(durationMinutes),
    startText: formatClock(start),
    endText: formatClock(addMinutes(start, durationMinutes)),
    estimateText: formatEuros(estimateParkingCostCents(durationMinutes)),
    rateText: `${formatEuros(DEMO_PARKING_HOURLY_RATE_CENTS)} / hour (demo rate)`,
  };
}

// ---------------------------------------------------------------------------
// Active session

export type ActiveParkingView = {
  id: string;
  plate: string;
  zone: string;
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
