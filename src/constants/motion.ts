// Shared motion tokens (T8.6). Restrained, fast, and always optional: every
// non-essential animation is skipped when the OS "Reduce Motion" setting is on.

export const MOTION = {
  /** press feedback, small state flips */
  FAST: 130,
  /** tab/filter active state, nav icon */
  NORMAL: 200,
  /** content entering a screen */
  SCREEN: 280,
  /** success mark (circle + check) total */
  SUCCESS: 500,
  /** pressed scale for buttons/cards */
  PRESS_SCALE: 0.98,
  /** small entrance offset (list items, content blocks) */
  SMALL_Y_OFFSET: 8,
  /** bottom-sheet entrance offset */
  SHEET_Y_OFFSET: 30,
} as const;

/** Duration to use: 0 when the user asked for reduced motion. */
export const motionDuration = (ms: number, reduceMotion: boolean): number => (reduceMotion ? 0 : ms);

/** Scale to animate to while pressed: none when disabled or reduced motion is on. */
export const pressScale = (opts: { disabled?: boolean; reduceMotion: boolean }): number =>
  opts.disabled || opts.reduceMotion ? 1 : MOTION.PRESS_SCALE;
