// Takes one photo and turns it into a small, temporary plate crop for
// recognition. The full photo is never uploaded; both temporary files are
// deleted right away and nothing is added to the report's evidence.

import type { CameraView } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { plateCropRect, PLATE_UPLOAD_QUALITY, Rect, uploadWidthFor } from "../../presentation/plateCrop";

export type PlateCrop = { base64: string; mimeType: "image/jpeg" };

function removeQuietly(uri: string | undefined) {
  if (!uri) return;
  try {
    (new File(uri) as unknown as { delete(): void }).delete();
  } catch {
    // temporary cache file: the OS clears it anyway
  }
}

/** null = the picture could not be taken / processed. */
export async function capturePlateCrop(camera: CameraView, view: { width: number; height: number }, frame: Rect): Promise<PlateCrop | null> {
  let photoUri: string | undefined;
  let cropUri: string | undefined;
  try {
    const photo = await camera.takePictureAsync({ quality: 0.9, exif: false, shutterSound: false });
    photoUri = photo?.uri;
    if (!photoUri) return null;
    // Load once with orientation applied to get the upright size the crop is computed in.
    const upright = await ImageManipulator.manipulate(photoUri).renderAsync();
    const crop = plateCropRect({ width: upright.width, height: upright.height }, view, frame);
    const ctx = ImageManipulator.manipulate(upright).crop(crop);
    ctx.resize({ width: uploadWidthFor(crop.width) });
    const out = await (await ctx.renderAsync()).saveAsync({ compress: PLATE_UPLOAD_QUALITY, format: SaveFormat.JPEG, base64: true });
    cropUri = out.uri;
    return out.base64 ? { base64: out.base64, mimeType: "image/jpeg" } : null;
  } catch {
    return null;
  } finally {
    removeQuietly(photoUri);
    removeQuietly(cropUri);
  }
}
