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
  "vehicle-front": "Both headlights and the plate in frame",
  "vehicle-side": "Front to rear, both wheels in frame",
  "vehicle-rear": "Both tail lights and the plate in frame",
  plate: "Fill the frame with the licence plate",
  sign: "Fit the whole parking sign in the frame",
};

/** Instruction under "Take 3 Photos" for the citizen's current shot. */
export const CITIZEN_SHOT_INSTRUCTION: Record<CitizenEvidenceType, string> = {
  FRONT: "Front photo: stand in front of the vehicle and line it up with the outline.",
  SIDE: "Side photo: step back until the whole side of the vehicle fits the outline.",
  REAR: "Rear photo: stand behind the vehicle and line it up with the outline.",
};

/** Small label above the frame naming the shot. */
export const CAMERA_GUIDE_LABEL: Record<CameraGuideKind, string> = {
  "vehicle-front": "FRONT",
  "vehicle-side": "SIDE",
  "vehicle-rear": "REAR",
  plate: "LICENCE PLATE",
  sign: "PARKING SIGN",
};

/** width / height of the frame for each subject. */
const ASPECT: Record<CameraGuideKind, number> = {
  "vehicle-front": 4 / 3,
  "vehicle-side": 2.4,
  "vehicle-rear": 4 / 3,
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

// ---------------------------------------------------------------------------
// Fit inside the free camera area (between the instruction card and the photo
// slots), so the guide is large but never sits under a control.

/** Height kept free under the frame for the level line and the hint. */
export const GUIDE_RESERVED_BELOW = 74;
/** Small free area (short phones): only the level line stays; the hint is already in the instruction card. */
export const GUIDE_COMPACT_AREA = 300;
export const GUIDE_RESERVED_BELOW_COMPACT = 32;
export const guideIsCompact = (areaHeight: number) => areaHeight < GUIDE_COMPACT_AREA;
/** Room above the frame for the shot label on its top edge. */
export const GUIDE_RESERVED_ABOVE = 12;

const AREA_WIDTH_SHARE: Record<CameraGuideKind, number> = {
  "vehicle-front": 0.86,
  "vehicle-side": 0.95,
  "vehicle-rear": 0.86,
  plate: 0.86,
  sign: 0.6,
};

/** Frame size inside a measured free area: the subject's shape, as large as fits. */
export function guideFrameInArea(kind: CameraGuideKind, areaWidth: number, areaHeight: number): { width: number; height: number } {
  const aspect = ASPECT[kind];
  let width = Math.max(0, areaWidth) * AREA_WIDTH_SHARE[kind];
  let height = width / aspect;
  const below = guideIsCompact(areaHeight) ? GUIDE_RESERVED_BELOW_COMPACT : GUIDE_RESERVED_BELOW;
  const maxHeight = Math.max(0, areaHeight - below - GUIDE_RESERVED_ABOVE);
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Which vehicle view a guide kind shows (plate / sign are not vehicle views). */
export const GUIDE_VIEW: Partial<Record<CameraGuideKind, "FRONT" | "SIDE" | "REAR">> = {
  "vehicle-front": "FRONT",
  "vehicle-side": "SIDE",
  "vehicle-rear": "REAR",
};
