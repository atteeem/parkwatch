// Citizen licence-plate entry (pure). The plate is TYPED by the citizen; the
// scanner view only helps them frame and read it. There is no automatic plate
// recognition (OCR) in ParkWatch yet.

import type { ReportDraft } from "../domain";

/** Longest plate the field accepts (Finnish plates are at most 7 characters plus a dash). */
export const PLATE_INPUT_MAX = 10;

/** Upper-case; letters (incl. Å Ä Ö), digits, one kind of separator; no other characters. */
export function sanitizePlateInput(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9ÅÄÖ\- ]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+/, "")
    .slice(0, PLATE_INPUT_MAX);
}

/** What the plate field shows: the citizen's own entry only (never a placeholder value). */
export const plateFieldValue = (draft: ReportDraft): string => (draft.vehicle?.source === "CITIZEN_CONFIRMED" ? draft.vehicle.plate.raw : "");

/** Licence-plate shape used by the scanner frame (EU / Finnish plate is 520 x 110 mm). */
export const PLATE_ASPECT = 520 / 110;

/** Plain-language status of plate reading, shown in the scanner. */
export const PLATE_SCAN_NOTE = "Automatic plate reading isn't available yet. Line the plate up in the frame and type it below.";
