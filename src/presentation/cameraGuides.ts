// Camera framing guides (pure). A guide is only a drawn outline that helps the
// user centre the subject; nothing is detected or checked automatically.

import type { CitizenEvidenceType, OfficerEvidenceType } from "../domain";

export type CameraGuideKind = "vehicle-front" | "vehicle-side" | "vehicle-rear" | "plate" | "sign";

export const CITIZEN_CAMERA_GUIDE: Record<CitizenEvidenceType, CameraGuideKind> = {
  FRONT: "vehicle-front",
  SIDE: "vehicle-side",
  REAR: "vehicle-rear",
};

export const OFFICER_CAMERA_GUIDE: Record<OfficerEvidenceType, CameraGuideKind> = {
  VEHICLE_FRONT: "vehicle-front",
  LICENSE_PLATE: "plate",
  PARKING_SIGN: "sign",
  VEHICLE_REAR: "vehicle-rear",
};

/** Short hint under the frame. Plain framing advice; no claim of detection. */
export const CAMERA_GUIDE_HINT: Record<CameraGuideKind, string> = {
  "vehicle-front": "Fit the front of the vehicle inside the frame",
  "vehicle-side": "Fit the whole side of the vehicle inside the frame",
  "vehicle-rear": "Fit the rear of the vehicle inside the frame",
  plate: "Fill the frame with the licence plate",
  sign: "Fit the parking sign inside the frame",
};

/** width / height of the frame for each subject. */
const ASPECT: Record<CameraGuideKind, number> = {
  "vehicle-front": 1.35,
  "vehicle-side": 2.4,
  "vehicle-rear": 1.35,
  plate: 4.2,
  sign: 0.72,
};

/** Share of the screen width the frame may use. */
const WIDTH_SHARE: Record<CameraGuideKind, number> = {
  "vehicle-front": 0.8,
  "vehicle-side": 0.9,
  "vehicle-rear": 0.8,
  plate: 0.72,
  sign: 0.46,
};

/** Highest share of the screen height the frame may use (keeps room for the controls). */
export const MAX_HEIGHT_SHARE = 0.36;

/** Frame size for a screen: the subject's shape, as wide as allowed, never taller than MAX_HEIGHT_SHARE. */
export function guideFrame(kind: CameraGuideKind, screenWidth: number, screenHeight: number): { width: number; height: number } {
  const aspect = ASPECT[kind];
  let width = Math.max(0, screenWidth) * WIDTH_SHARE[kind];
  let height = width / aspect;
  const maxHeight = Math.max(0, screenHeight) * MAX_HEIGHT_SHARE;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}
