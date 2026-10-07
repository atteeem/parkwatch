// Picking and shrinking a profile picture (device side). The original photo is
// never uploaded: it is cropped square by the system picker, then resized to
// AVATAR_SIZE px and saved as a compressed JPEG.

import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export const AVATAR_SIZE = 512;
export const AVATAR_JPEG_QUALITY = 0.7;

export type AvatarSource = "library" | "camera";

export type PickedAvatar = { ok: true; uri: string; base64: string } | { ok: false; reason: "canceled" | "denied" | "failed" };

export async function pickAvatarImage(source: AvatarSource): Promise<PickedAvatar> {
  try {
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: "denied" };
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 };
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return { ok: false, reason: "canceled" };
    const asset = result.assets[0];
    const ctx = ImageManipulator.manipulate(asset.uri);
    if ((asset.width ?? AVATAR_SIZE + 1) > AVATAR_SIZE) ctx.resize({ width: AVATAR_SIZE });
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: AVATAR_JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
    if (!saved.uri || !saved.base64) return { ok: false, reason: "failed" };
    return { ok: true, uri: saved.uri, base64: saved.base64 };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Base64 -> bytes for the upload (no extra dependency). Padding and whitespace are ignored. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  const at = (i: number) => (i < clean.length ? chars.indexOf(clean[i]) : 0);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3);
    if (o < len) out[o++] = (n >> 16) & 255;
    if (o < len) out[o++] = (n >> 8) & 255;
    if (o < len) out[o++] = n & 255;
  }
  return out.buffer;
}
