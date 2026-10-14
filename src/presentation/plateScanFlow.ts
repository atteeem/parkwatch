// Plate scanner flow (pure). Recognition only ever PROPOSES a plate: the
// citizen confirms it ("Use NNC-685"), edits it, or types it. Nothing is put in
// the report draft until they confirm.

import {
  AMBIGUITY_MARGIN,
  confidenceTier,
  PlateCandidate,
  PlateRecognitionResponse,
} from "../../supabase/functions/_shared/plateText";

export type RecognitionError = "UNAUTHENTICATED" | "NETWORK" | "TIMEOUT" | "RATE_LIMITED" | "UNAVAILABLE" | "BAD_RESPONSE" | "CAPTURE_FAILED";

export type RecognitionOutcome = { ok: true; value: PlateRecognitionResponse } | { ok: false; error: RecognitionError };

/** What the scanner needs: send a plate crop, get a proposal back (implemented by the backend client). */
export type PlateRecognizer = (image: { base64: string; mimeType: "image/jpeg" | "image/png" }) => Promise<RecognitionOutcome>;

export type ScanState =
  | { step: "aim" }
  | { step: "reading" }
  /** A reading to confirm. "medium" = the citizen is explicitly asked to check it. */
  | { step: "result"; plate: string; tier: "high" | "medium" }
  /** Several plausible readings: the citizen picks one (or types). */
  | { step: "choose"; options: PlateCandidate[] }
  | { step: "noResult" }
  | { step: "failed"; error: RecognitionError }
  /** Typing / correcting the plate by hand. */
  | { step: "edit"; text: string };

export type ScanAction =
  | { type: "SCAN" }
  | { type: "OUTCOME"; outcome: RecognitionOutcome }
  | { type: "EDIT"; text: string }
  | { type: "RETRY" };

export const INITIAL_SCAN: ScanState = { step: "aim" };

/** Map a server response to what the citizen sees. */
export function stateForResponse(r: PlateRecognitionResponse): ScanState {
  const top = r.candidates[0];
  const second = r.candidates[1];
  // Two plausible, close readings (e.g. NNC-685 vs NMC-685, or two plates in the frame): let the citizen pick.
  if (top && second && confidenceTier(second.confidence) !== "low" && top.confidence - second.confidence < AMBIGUITY_MARGIN) {
    return { step: "choose", options: r.candidates.filter((c) => confidenceTier(c.confidence) !== "low").slice(0, 3) };
  }
  const tier = confidenceTier(r.confidence);
  if (!r.plate || tier === "low") return { step: "noResult" };
  return { step: "result", plate: r.plate, tier };
}

export function scanReducer(state: ScanState, a: ScanAction): ScanState {
  switch (a.type) {
    case "SCAN":
      return state.step === "reading" ? state : { step: "reading" };
    case "OUTCOME":
      if (state.step !== "reading") return state; // a late answer after the citizen moved on is ignored
      return a.outcome.ok ? stateForResponse(a.outcome.value) : { step: "failed", error: a.outcome.error };
    case "EDIT":
      return { step: "edit", text: a.text };
    case "RETRY":
      return INITIAL_SCAN;
  }
}

/** Plain-language failure copy (no raw provider errors, no numbers). */
export const SCAN_FAILURE_COPY: Record<RecognitionError, { title: string; body: string; retry: boolean }> = {
  NETWORK: { title: "No connection", body: "Check your connection and try again, or enter the plate manually.", retry: true },
  TIMEOUT: { title: "That took too long", body: "Try again, or enter the plate manually.", retry: true },
  RATE_LIMITED: { title: "Too many scans", body: "Wait a moment and try again, or enter the plate manually.", retry: true },
  UNAVAILABLE: { title: "Recognition service unavailable", body: "You can still enter the plate manually.", retry: true },
  BAD_RESPONSE: { title: "Recognition service unavailable", body: "You can still enter the plate manually.", retry: true },
  UNAUTHENTICATED: { title: "Please sign in again", body: "Your session has ended. You can still enter the plate manually.", retry: false },
  CAPTURE_FAILED: { title: "Couldn't take the picture", body: "Try again, or enter the plate manually.", retry: true },
};

export const SCAN_COPY = {
  aim: "Position the registration plate inside the frame",
  reading: "Reading plate…",
  noResultTitle: "Couldn't read the plate",
  noResultBody: "Try again or enter it manually.",
  resultHigh: "Recognised plate",
  resultMedium: "Check the plate matches the vehicle",
  choose: "Which plate is correct?",
  tilted: "Hold phone upright for a clearer scan",
  unavailable: "Plate reading needs a connection to ParkWatch. Type the plate below.",
} as const;
