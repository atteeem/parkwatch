// The ONE place domain errors / draft issues become user-facing messages.
// Screens never show raw error codes.

import { DomainError, DraftIssue, MIN_WITHDRAWAL_AMOUNT_CENTS } from "../domain";
import { formatEuros } from "./viewModels";

/** How a screen should present the problem. */
export type UiErrorKind =
  | "INLINE" // next to the field the user must correct
  | "BANNER" // stay on the screen with a message (e.g. retry)
  | "NOT_FOUND"; // show the safe not-found state

export type UiError = { kind: UiErrorKind; message: string };

const GENERIC = "Something went wrong. Please try again.";

export function describeDomainError(error: DomainError | { code: string; message?: string }): UiError {
  switch (error.code) {
    case "INVALID_DRAFT":
      return { kind: "BANNER", message: "Some required details are missing. Please check your report and try again." };
    case "NOT_FOUND":
      return { kind: "NOT_FOUND", message: "We couldn't find that item." };
    case "CASE_TAKEN":
      return { kind: "BANNER", message: "This case is assigned to another officer." };
    case "ALREADY_COMPLETED":
      return { kind: "BANNER", message: "This case has already been completed with a different result." };
    case "INSPECTION_NOT_READY":
      return { kind: "BANNER", message: "Confirm all four checks and take all four officer photos before issuing a parking charge." };
    case "INSPECTION_COMPLETED":
      return { kind: "BANNER", message: "This inspection is already completed and can't be changed." };
    case "INVALID_TRANSITION":
    case "REPORT_ALREADY_RESOLVED":
      return { kind: "BANNER", message: "This action isn't possible at the case's current stage." };
    case "INVALID_AMOUNT":
      return { kind: "INLINE", message: "Enter a valid amount." };
    case "BELOW_MINIMUM":
      return { kind: "INLINE", message: `The minimum withdrawal is ${formatEuros(MIN_WITHDRAWAL_AMOUNT_CENTS)}.` };
    case "INSUFFICIENT_AVAILABLE_BALANCE":
      return {
        kind: "INLINE",
        message: "That is more than your available balance. Pending rewards can't be withdrawn yet.",
      };
    case "EVIDENCE_SOURCE_NOT_ALLOWED":
      return { kind: "INLINE", message: "Required photos must be taken with the camera at the scene." };
    case "INVALID_PLATE":
      return { kind: "INLINE", message: "Enter the vehicle's licence plate." };
    case "DUPLICATE_VEHICLE":
      return { kind: "INLINE", message: "This vehicle is already registered." };
    case "PARKING_ALREADY_ACTIVE":
      return { kind: "BANNER", message: "You already have an active parking session. End it before starting a new one." };
    case "NO_ACTIVE_PARKING":
      return { kind: "BANNER", message: "This parking session has already ended." };
    case "INVALID_DURATION":
      return { kind: "INLINE", message: "Choose a parking time between 1 minute and 24 hours." };
    default:
      return { kind: "BANNER", message: GENERIC };
  }
}

const SLOT_LABEL = { FRONT: "front", SIDE: "side", REAR: "rear" } as const;

export type DraftField = "photos" | "violation" | "location" | "observedAt";

export function describeDraftIssue(issue: DraftIssue): { field: DraftField; message: string } {
  switch (issue.code) {
    case "MISSING_PHOTO":
      return { field: "photos", message: `Take the ${SLOT_LABEL[issue.slot]} photo of the vehicle.` };
    case "PHOTO_SOURCE_NOT_ALLOWED":
      return { field: "photos", message: `The ${SLOT_LABEL[issue.slot]} photo must be taken with the camera.` };
    case "MISSING_VIOLATION":
      return { field: "violation", message: "Select the type of violation." };
    case "MISSING_LOCATION":
      return { field: "location", message: "Enter the location of the vehicle." };
    case "INVALID_OBSERVED_AT":
      return { field: "observedAt", message: "The date and time are not valid." };
  }
}

/** First message per field, for inline display. */
export function draftIssueMessages(issues: DraftIssue[]): Partial<Record<DraftField, string>> {
  const out: Partial<Record<DraftField, string>> = {};
  for (const issue of issues) {
    const { field, message } = describeDraftIssue(issue);
    out[field] ??= message;
  }
  return out;
}
