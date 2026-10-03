import { PlateNumber } from "./types";

/**
 * Canonical plate key for comparison, de-duplication and future lookups.
 * MVP rules only: trim, uppercase, drop whitespace and presentation
 * separators (hyphens, dots, middle dots). No country-specific formatting is
 * applied, and no international validation is attempted yet.
 *
 *   "ABC-123", "abc-123", "ABC 123", "abc123"  ->  "ABC123"
 */
export function normalizePlate(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-.·_]+/g, "");
}

/** Build a plate value object; `raw` keeps the display form (trimmed). */
export function createPlateNumber(raw: string, country?: string): PlateNumber {
  const plate: PlateNumber = { raw: raw.trim(), normalized: normalizePlate(raw) };
  if (country) plate.country = country.trim().toUpperCase();
  return plate;
}

/**
 * Same plate? Normalized keys must match; countries must not contradict
 * (an unknown country on either side is not treated as a mismatch).
 */
export function platesMatch(a: PlateNumber, b: PlateNumber): boolean {
  if (a.normalized === "" || a.normalized !== b.normalized) return false;
  return !a.country || !b.country || a.country === b.country;
}
