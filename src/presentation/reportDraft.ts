// Citizen report-draft state machine (pure; wrapped by ReportContext).
//
// Lifecycle rules:
// - Only START_NEW creates a fresh draft (new draftId, empty photos,
//   violation, details, attachments, fresh mock vehicle context). Moving
//   back/forward inside the wizard never resets anything.
// - Required photos are CAMERA evidence; attachments are LIBRARY evidence and
//   live in a separate list, so they can never fill a required slot.
// - After a successful submit the draft is marked submitted; it is finished
//   and cannot be submitted again (the store is idempotent per draftId too).

import {
  CITIZEN_EVIDENCE_TYPES,
  CitizenEvidenceType,
  createCitizenEvidence,
  createEmptyDraft,
  draftObservedAtOf,
  GeoPoint,
  IsoTimestamp,
  MVP_MOCK_DETECTED_VEHICLE,
  ReportDraft,
} from "../domain";

export type CitizenDraftState = {
  draft: ReportDraft;
  /** Set once the draft has been submitted; the draft is then read-only. */
  submittedReportId?: string;
};

export type DraftAction =
  | { type: "START_NEW"; draftId: string }
  | { type: "CAPTURE_PHOTO"; slot: CitizenEvidenceType; uri: string; capturedAt: IsoTimestamp }
  | { type: "SET_VIOLATION"; violationId: string }
  /** Address typed by the citizen (manual fallback). */
  | { type: "SET_LOCATION"; address: string }
  /** A real device GPS fix. Becomes the report point unless the citizen picked one on the map. */
  | { type: "SET_DEVICE_FIX"; fix: GeoPoint }
  /** The citizen tapped the map: this point (no GPS accuracy/time) becomes the report point. */
  | { type: "SELECT_MAP_POINT"; latitude: number; longitude: number }
  /** Back to the device fix as the report point. */
  | { type: "USE_DEVICE_FIX" }
  /** Reverse-geocoded address for `point`; ignored if the point changed meanwhile or the address was typed. */
  | { type: "SET_GEOCODED_ADDRESS"; address: string; point: { latitude: number; longitude: number } }
  | { type: "SET_NOTES"; notes: string }
  | { type: "ADD_ATTACHMENT"; uri: string; pickedAt: IsoTimestamp }
  | { type: "REMOVE_ATTACHMENT"; evidenceId: string }
  | { type: "MARK_SUBMITTED"; reportId: string }
  /** Recover a persisted unsent draft (same draft id = same server submission). */
  | { type: "RESTORE"; draft: ReportDraft };

export function newDraftState(draftId: string): CitizenDraftState {
  return { draft: { ...createEmptyDraft(draftId), vehicle: { ...MVP_MOCK_DETECTED_VEHICLE } } };
}

export function draftReducer(state: CitizenDraftState, action: DraftAction): CitizenDraftState {
  if (action.type === "START_NEW") return newDraftState(action.draftId);
  if (action.type === "RESTORE") return { draft: action.draft };
  // A submitted draft is finished: ignore any further edits.
  if (state.submittedReportId !== undefined) return state;

  const d = state.draft;
  switch (action.type) {
    case "CAPTURE_PHOTO":
      return {
        ...state,
        draft: {
          ...d,
          photos: {
            ...d.photos,
            [action.slot]: createCitizenEvidence({
              // One id per capture: a retake gets a new id (and storage path), so an
              // earlier upload of the replaced photo is never mistaken for this one.
              id: `${d.draftId}-${action.slot}-${(Date.parse(action.capturedAt) || 0).toString(36)}`,
              type: action.slot,
              captureSource: "CAMERA",
              uri: action.uri,
              capturedAt: action.capturedAt,
            }),
          },
        },
      };
    case "SET_VIOLATION":
      return { ...state, draft: { ...d, violationId: action.violationId } };
    case "SET_LOCATION":
      return { ...state, draft: { ...d, addressSource: "TYPED", location: { ...d.location, address: action.address } } };
    case "SET_DEVICE_FIX": {
      const fix = { ...action.fix };
      // A point the citizen picked on the map stays; the fix is still kept as provenance.
      if (d.location.coordinatesSource === "MAP_SELECTED") return { ...state, draft: { ...d, location: { ...d.location, deviceFix: fix } } };
      return { ...state, draft: { ...d, location: { ...d.location, deviceFix: fix, coordinates: { ...fix }, coordinatesSource: "GPS" } } };
    }
    case "SELECT_MAP_POINT": {
      const { coordinates: _old, ...rest } = d.location;
      return {
        ...state,
        draft: {
          ...d,
          // A new point gets a fresh address from geocoding (the old text described the old point).
          addressSource: undefined,
          // Only latitude/longitude: a picked point has no GPS accuracy or capture time.
          location: { ...rest, coordinates: { latitude: action.latitude, longitude: action.longitude }, coordinatesSource: "MAP_SELECTED" },
        },
      };
    }
    case "USE_DEVICE_FIX": {
      const fix = d.location.deviceFix;
      if (!fix) return state;
      return { ...state, draft: { ...d, addressSource: undefined, location: { ...d.location, coordinates: { ...fix }, coordinatesSource: "GPS" } } };
    }
    case "SET_GEOCODED_ADDRESS": {
      const c = d.location.coordinates;
      if (d.addressSource === "TYPED" || !c || !samePoint(c, action.point) || !action.address.trim()) return state;
      return { ...state, draft: { ...d, addressSource: "GEOCODED", location: { ...d.location, address: action.address.trim() } } };
    }
    case "SET_NOTES":
      return { ...state, draft: { ...d, notes: action.notes } };
    case "ADD_ATTACHMENT": {
      const evidence = createCitizenEvidence({
        id: `${d.draftId}-ATT-${d.attachments.length + 1}-${Date.parse(action.pickedAt) || 0}`,
        type: "ATTACHMENT",
        captureSource: "LIBRARY",
        uri: action.uri,
        capturedAt: action.pickedAt,
      });
      return { ...state, draft: { ...d, attachments: [...d.attachments, evidence] } };
    }
    case "REMOVE_ATTACHMENT":
      return { ...state, draft: { ...d, attachments: d.attachments.filter((a) => a.id !== action.evidenceId) } };
    case "MARK_SUBMITTED":
      return { ...state, submittedReportId: action.reportId };
  }
}

/** Required photo slots in display order with labels from the designs. */
export const CITIZEN_PHOTO_SLOTS: readonly { slot: CitizenEvidenceType; label: string }[] = [
  { slot: "FRONT", label: "Front Photo" },
  { slot: "SIDE", label: "Side Photo" },
  { slot: "REAR", label: "Rear Photo" },
];

const samePoint = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  a.latitude === b.latitude && a.longitude === b.longitude;

/** First required slot still missing (for auto-advancing the camera), or undefined. */
export function nextMissingSlot(draft: ReportDraft): CitizenEvidenceType | undefined {
  return CITIZEN_EVIDENCE_TYPES.find((s) => !draft.photos[s]);
}

/** When the violation was observed: the earliest required camera photo (read-only for the citizen). */
export function draftObservedAt(draft: ReportDraft): IsoTimestamp | undefined {
  return draftObservedAtOf(draft);
}

export const newDraftId = () => `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Editing from Review & Submit

export type ReviewEditTarget = "photos" | "violation" | "details";

/** Where each Review "Edit" opens. The step is opened with ?from=review. */
export const REVIEW_EDIT_ROUTE = {
  photos: "/user/report/photos",
  violation: "/user/report/select-violation",
  details: "/user/report/add-details",
} as const satisfies Record<ReviewEditTarget, string>;

const NEXT_STEP = {
  photos: "/user/report/select-violation",
  violation: "/user/report/add-details",
  details: "/user/report/review",
} as const satisfies Record<ReviewEditTarget, string>;

/**
 * After a wizard step's Continue: opened from Review -> go back to Review
 * (nothing else needs re-confirming); otherwise the next step.
 */
export function afterStep(step: ReviewEditTarget, from: string | string[] | undefined): { kind: "backToReview" } | { kind: "push"; route: (typeof NEXT_STEP)[ReviewEditTarget] } {
  const f = Array.isArray(from) ? from[0] : from;
  return f === "review" ? { kind: "backToReview" } : { kind: "push", route: NEXT_STEP[step] };
}
