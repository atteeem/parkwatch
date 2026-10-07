// Officer evidence capture flow (pure). One continuous camera session:
// after a SAVED photo the camera moves on to the next missing target; a failed
// upload stays on the same target with an error; any captured target can be
// re-selected for a retake. Leaving the camera keeps every saved photo.

import type { OfficerPhotoKey } from "./viewModels";

/** Capture order inside the camera (also the order on the inspection screen). */
export const OFFICER_CAPTURE_ORDER: readonly OfficerPhotoKey[] = ["front", "plate", "sign", "rear"];

export const OFFICER_PHOTO_LABEL: Record<OfficerPhotoKey, string> = {
  front: "Vehicle front",
  plate: "License plate",
  sign: "Parking sign",
  rear: "Vehicle rear",
};

export type OfficerCaptureState = {
  /** Target explicitly chosen (retake, or kept after a failure). undefined = next missing. */
  selected?: OfficerPhotoKey;
  /** Last save error; shown until the next attempt or selection. */
  error: string | null;
};

export const initialOfficerCapture = (start?: string | string[]): OfficerCaptureState => {
  const s = Array.isArray(start) ? start[0] : start;
  return { selected: isOfficerPhotoKey(s) ? s : undefined, error: null };
};

export const isOfficerPhotoKey = (k: string | undefined): k is OfficerPhotoKey => !!k && (OFFICER_CAPTURE_ORDER as readonly string[]).includes(k);

/** First target without a saved photo, in capture order. */
export function nextMissingOfficerSlot(photos: Partial<Record<OfficerPhotoKey, string>>): OfficerPhotoKey | undefined {
  return OFFICER_CAPTURE_ORDER.find((k) => !photos[k]);
}

/** The target the next shutter press saves into (undefined = all four saved, nothing selected). */
export function activeOfficerSlot(state: OfficerCaptureState, photos: Partial<Record<OfficerPhotoKey, string>>): OfficerPhotoKey | undefined {
  return state.selected ?? nextMissingOfficerSlot(photos);
}

export const officerCaptureComplete = (photos: Partial<Record<OfficerPhotoKey, string>>): boolean => OFFICER_CAPTURE_ORDER.every((k) => !!photos[k]);

/** The officer tapped a target (retake or out of order). */
export const selectOfficerSlot = (_state: OfficerCaptureState, slot: OfficerPhotoKey): OfficerCaptureState => ({ selected: slot, error: null });

/**
 * A save finished for `slot`.
 * ok   -> clear the selection: the camera advances to the next missing target.
 * fail -> stay on `slot` (explicitly) and show the error; nothing advances.
 */
export function afterOfficerSave(
  _state: OfficerCaptureState,
  slot: OfficerPhotoKey,
  result: { ok: true } | { ok: false; message: string }
): OfficerCaptureState {
  return result.ok ? { selected: undefined, error: null } : { selected: slot, error: result.message };
}
