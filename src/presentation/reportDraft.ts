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
  | { type: "SET_LOCATION"; address: string }
  | { type: "SET_NOTES"; notes: string }
  | { type: "ADD_ATTACHMENT"; uri: string; pickedAt: IsoTimestamp }
  | { type: "REMOVE_ATTACHMENT"; evidenceId: string }
  | { type: "MARK_SUBMITTED"; reportId: string };

export function newDraftState(draftId: string): CitizenDraftState {
  return { draft: { ...createEmptyDraft(draftId), vehicle: { ...MVP_MOCK_DETECTED_VEHICLE } } };
}

export function draftReducer(state: CitizenDraftState, action: DraftAction): CitizenDraftState {
  if (action.type === "START_NEW") return newDraftState(action.draftId);
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
              id: `${d.draftId}-${action.slot}`,
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
      return { ...state, draft: { ...d, location: { ...d.location, address: action.address } } };
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

/** First required slot still missing (for auto-advancing the camera), or undefined. */
export function nextMissingSlot(draft: ReportDraft): CitizenEvidenceType | undefined {
  return CITIZEN_EVIDENCE_TYPES.find((s) => !draft.photos[s]);
}

/** When the violation was observed: explicit value, else earliest photo capture. */
export function draftObservedAt(draft: ReportDraft): IsoTimestamp | undefined {
  if (draft.observedAt) return draft.observedAt;
  return CITIZEN_EVIDENCE_TYPES.map((s) => draft.photos[s]?.capturedAt)
    .filter((t): t is string => !!t)
    .sort()[0];
}

export const newDraftId = () => `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
