// Seeded (demo) evidence has no real photo. Instead of downloading random
// internet images, seed evidence points at this local scheme and the UI
// draws a neutral, clearly-not-a-photo tile. Real captured evidence always
// has a device file/content URI and is shown as the actual image.

export const DEMO_PHOTO_SCHEME = "parkwatch-demo://";

/** Stable demo URI for a seeded evidence photo (e.g. parkwatch-demo://GHC-789/FRONT). */
export function demoPhotoUri(plate: string, slot: string): string {
  return `${DEMO_PHOTO_SCHEME}${encodeURIComponent(plate)}/${slot}`;
}

export function isDemoPhotoUri(uri: string | undefined | null): boolean {
  return !!uri && uri.startsWith(DEMO_PHOTO_SCHEME);
}

/** The evidence slot of a demo URI (FRONT, SIDE, REAR, LICENSE_PLATE, ...), if any. */
export function demoPhotoSlot(uri: string): string | undefined {
  return isDemoPhotoUri(uri) ? uri.slice(DEMO_PHOTO_SCHEME.length).split("/")[1] : undefined;
}

/** Old seeds used random picsum images; they are replaced by demo URIs on load. */
export function isLegacyPlaceholderUri(uri: string | undefined | null): boolean {
  return !!uri && uri.startsWith("https://picsum.photos/");
}
