// Circular duration dial (pure). One full turn = one hour; the dial can be
// turned several times (hours accumulate). Values snap to 5-minute steps and
// stay within the parking rules (the domain still receives whole minutes).

import { MAX_PARKING_DURATION_MINUTES } from "../domain";
import { formatClock, formatDurationMinutes, WHEEL_MIN_MINUTES, WHEEL_STEP_MINUTES } from "./parkingViews";

export const DIAL_MINUTES_PER_TURN = 60;
export const DIAL_STEP_MINUTES = WHEEL_STEP_MINUTES;
export const DIAL_MIN_MINUTES = WHEEL_MIN_MINUTES;
export const DIAL_MAX_MINUTES = MAX_PARKING_DURATION_MINUTES;
/** Screen-reader increment/decrement step. */
export const DIAL_A11Y_STEP_MINUTES = 15;
/** Touches closer than this to the centre are ignored (the angle is unstable there). */
export const DIAL_DEAD_ZONE_PX = 18;

export type DialRange = { min: number; max: number };
export const DEFAULT_DIAL_RANGE: DialRange = { min: DIAL_MIN_MINUTES, max: DIAL_MAX_MINUTES };

export const clampMinutes = (m: number, r: DialRange = DEFAULT_DIAL_RANGE): number => Math.min(r.max, Math.max(r.min, m));

/** Nearest 5-minute step, within the range. */
export const snapMinutes = (m: number, r: DialRange = DEFAULT_DIAL_RANGE): number =>
  clampMinutes(Math.round(m / DIAL_STEP_MINUTES) * DIAL_STEP_MINUTES, r);

/** Angle of a point around a centre, in degrees clockwise from 12 o'clock (0 ≤ a < 360). */
export function angleAt(x: number, y: number, cx: number, cy: number): number {
  const deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Smallest signed turn from one angle to another (-180, 180]: crossing 12 o'clock is not a jump. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Minutes represented by a turn of `deg` degrees. */
export const minutesForTurn = (deg: number): number => (deg / 360) * DIAL_MINUTES_PER_TURN;

/** Handle angle for a duration (position within the current hour). */
export const angleForMinutes = (m: number): number => ((m % DIAL_MINUTES_PER_TURN) / DIAL_MINUTES_PER_TURN) * 360;

/** Filled part of the ring, 0..1. Whole hours show a full ring (not an empty one). */
export function arcFraction(m: number): number {
  if (m <= 0) return 0;
  const rest = m % DIAL_MINUTES_PER_TURN;
  return rest === 0 ? 1 : rest / DIAL_MINUTES_PER_TURN;
}

/**
 * Drag tracking. `raw` is the unsnapped, clamped duration that follows the
 * finger continuously (so turning back from the maximum responds at once);
 * `value` is what is shown and used: `raw` snapped to 5 minutes.
 */
export type DialDrag = { lastAngle: number; raw: number; value: number };

export function startDrag(angle: number, value: number): DialDrag {
  return { lastAngle: angle, raw: value, value };
}

export function moveDrag(d: DialDrag, angle: number, r: DialRange = DEFAULT_DIAL_RANGE): DialDrag {
  const raw = clampMinutes(d.raw + minutesForTurn(angleDelta(d.lastAngle, angle)), r);
  return { lastAngle: angle, raw, value: snapMinutes(raw, r) };
}

/** Screen-reader adjust: move to the next/previous multiple of 15 minutes. */
export function accessibilityStep(value: number, direction: 1 | -1, r: DialRange = DEFAULT_DIAL_RANGE): number {
  const s = DIAL_A11Y_STEP_MINUTES;
  const next = direction > 0 ? Math.floor(value / s) * s + s : Math.ceil(value / s) * s - s;
  return clampMinutes(next, r);
}

/** "1 hour 15 minutes, ends at 15:45" */
export function dialAccessibilityText(minutes: number, now: Date): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [h ? `${h} ${h === 1 ? "hour" : "hours"}` : "", m ? `${m} ${m === 1 ? "minute" : "minutes"}` : ""].filter(Boolean);
  const end = formatClock(new Date(now.getTime() + minutes * 60_000).toISOString());
  return `${parts.join(" ") || "0 minutes"}, ends at ${end}`;
}

/** Big headline above the dial: "1h 15m", "45m", "2h". */
export function dialHeadline(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export type DurationPreset = { label: string; minutes: number };

/** Quick options under the dial ("Max" = the longest allowed in this context). */
export function dialPresets(r: DialRange = DEFAULT_DIAL_RANGE): DurationPreset[] {
  return [
    { label: "30 min", minutes: 30 },
    { label: "1 h", minutes: 60 },
    { label: "2 h", minutes: 120 },
    { label: "Max", minutes: r.max },
  ].filter((p) => p.minutes >= r.min && p.minutes <= r.max);
}

export { formatDurationMinutes };
