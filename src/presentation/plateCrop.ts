// Plate crop geometry (pure). The camera preview fills the screen ("cover"),
// so the photo is larger than / offset from what the user sees. This maps the
// on-screen plate frame to photo pixels, adds a small margin and clamps to the
// photo. Only this region is uploaded for recognition - never the full photo.

export type Rect = { x: number; y: number; width: number; height: number };
export type CropRect = { originX: number; originY: number; width: number; height: number };

/** Extra context around the frame (fraction of the frame size): plates are rarely framed exactly. */
export const PLATE_CROP_MARGIN = 0.15;
/** Upload width: enough for the characters, small enough for a fast upload. */
export const PLATE_UPLOAD_WIDTH = 720;
export const PLATE_UPLOAD_QUALITY = 0.8;

/**
 * `image` is the photo size AFTER orientation is applied (upright pixels);
 * `view` is the preview size on screen; `frame` the plate frame in screen points.
 */
export function plateCropRect(image: { width: number; height: number }, view: { width: number; height: number }, frame: Rect, margin = PLATE_CROP_MARGIN): CropRect {
  const scale = Math.max(view.width / image.width, view.height / image.height); // cover
  const offX = (image.width * scale - view.width) / 2;
  const offY = (image.height * scale - view.height) / 2;
  const mx = frame.width * margin;
  const my = frame.height * margin * 2; // plates are flat: allow more vertical slack
  const x0 = (frame.x - mx + offX) / scale;
  const y0 = (frame.y - my + offY) / scale;
  const x1 = (frame.x + frame.width + mx + offX) / scale;
  const y1 = (frame.y + frame.height + my + offY) / scale;
  const originX = Math.max(0, Math.floor(x0));
  const originY = Math.max(0, Math.floor(y0));
  const right = Math.min(image.width, Math.ceil(x1));
  const bottom = Math.min(image.height, Math.ceil(y1));
  return { originX, originY, width: Math.max(1, right - originX), height: Math.max(1, bottom - originY) };
}

/** Resize only down, never up. */
export const uploadWidthFor = (cropWidth: number) => Math.min(cropWidth, PLATE_UPLOAD_WIDTH);
