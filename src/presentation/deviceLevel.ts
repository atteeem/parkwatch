// Phone level guidance for the camera (pure). Only enough orientation to say
// "level" / "tilted" / "hold upright"; it never blocks a photo, and nothing
// here is stored or sent anywhere.
//
// Input: accelerometer gravity in g. Portrait phone held upright: gravity is
// mostly along the y axis. Roll = rotation of the screen around the camera
// axis (a tilted horizon); lean = how far the phone is tipped back/forward
// from vertical (pointing at the ground or sky).

export type LevelStatus = "unknown" | "level" | "tilted" | "notUpright";
export type LevelState = { status: LevelStatus; roll: number; lean: number };
export type Gravity = { x: number; y: number; z: number };

/** Level again once the horizon is within this many degrees ... */
export const LEVEL_ENTER_DEG = 4;
/** ... and tilted only beyond this (hysteresis: no flicker around one value). */
export const LEVEL_EXIT_DEG = 7;
/** Leaning back/forward: "hold upright" beyond EXIT, cleared again under ENTER. */
export const UPRIGHT_ENTER_DEG = 30;
export const UPRIGHT_EXIT_DEG = 40;
/** Smoothing of noisy readings (exponential moving average weight of a new sample). */
export const LEVEL_SMOOTHING = 0.25;
/** Readings far from 1 g are shakes/movement, not orientation: ignored. */
const MIN_G = 0.6;
const MAX_G = 1.4;

export const INITIAL_LEVEL: LevelState = { status: "unknown", roll: 0, lean: 0 };

const deg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Roll and lean in degrees from one gravity sample, or null when the sample
 * is not usable. `xSign` corrects the platform's axis direction (Android
 * reports the opposite sign of iOS), so the drawn horizon leans the right way.
 */
export function tiltFromGravity(g: Gravity, xSign: 1 | -1 = 1): { roll: number; lean: number } | null {
  const mag = Math.hypot(g.x, g.y, g.z);
  if (!Number.isFinite(mag) || mag < MIN_G || mag > MAX_G) return null;
  return {
    roll: deg(Math.atan2(xSign * g.x, Math.abs(g.y))),
    lean: deg(Math.atan2(Math.abs(g.z), Math.abs(g.y))),
  };
}

/** Next state for a sample. Returns the SAME object when nothing visible changed (no re-render). */
export function levelReducer(state: LevelState, sample: Gravity, xSign: 1 | -1 = 1): LevelState {
  const t = tiltFromGravity(sample, xSign);
  if (!t) return state;
  const first = state.status === "unknown";
  const roll = first ? t.roll : state.roll + (t.roll - state.roll) * LEVEL_SMOOTHING;
  const lean = first ? t.lean : state.lean + (t.lean - state.lean) * LEVEL_SMOOTHING;

  let status: LevelStatus;
  if (lean > UPRIGHT_EXIT_DEG || (state.status === "notUpright" && lean > UPRIGHT_ENTER_DEG)) status = "notUpright";
  else if (Math.abs(roll) <= LEVEL_ENTER_DEG) status = "level";
  else if (Math.abs(roll) > LEVEL_EXIT_DEG) status = "tilted";
  else status = state.status === "tilted" ? "tilted" : "level"; // inside the band: keep the previous state

  const changed = status !== state.status || Math.abs(roll - state.roll) >= 0.5 || Math.abs(lean - state.lean) >= 1;
  return changed ? { status, roll, lean } : state;
}

export const LEVEL_MESSAGE: Record<LevelStatus, string | null> = {
  unknown: null,
  level: "Level",
  tilted: "Level your phone",
  notUpright: "Hold phone upright",
};
