// Pure capture logic for CameraCapture, testable without a camera.
//
// A capture either yields a real photo URI with its capture time, or a
// non-destructive error. There is NO fallback image: a failed capture never
// produces evidence.

export type CaptureOutcome =
  | { ok: true; uri: string; capturedAt: string }
  | { ok: false; message: string };

export const CAPTURE_FAILED_MESSAGE = "The photo could not be taken. Please try again.";

export async function takePhotoSafely(
  take: () => Promise<{ uri?: string } | undefined | null>,
  now: () => Date = () => new Date()
): Promise<CaptureOutcome> {
  try {
    const photo = await take();
    if (!photo?.uri) return { ok: false, message: CAPTURE_FAILED_MESSAGE };
    return { ok: true, uri: photo.uri, capturedAt: now().toISOString() };
  } catch {
    return { ok: false, message: CAPTURE_FAILED_MESSAGE };
  }
}

export type PermissionView = "loading" | "granted" | "ask" | "settings";

/** Which permission UI to show. "settings" when the OS will no longer prompt. */
export function permissionView(p: { granted: boolean; canAskAgain: boolean } | null | undefined): PermissionView {
  if (!p) return "loading";
  if (p.granted) return "granted";
  return p.canAskAgain ? "ask" : "settings";
}
