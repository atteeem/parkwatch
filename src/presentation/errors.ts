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
    case "INVALID_TRANSITION":
    case "ALREADY_COMPLETED":
    case "CASE_TAKEN":
    case "REPORT_ALREADY_RESOLVED":
      return { kind: "BANNER", message: "This action is no longer possible. The item may have changed — please refresh." };
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
