// First-use permission education (T8.8). Shown inline where a feature is
// about to need an OS permission; never a repeated modal. The OS dialog
// itself is only shown when the user taps the button next to this text.

export const LOCATION_EDUCATION =
  "ParkWatch uses your location to place the report on the map. You can correct the pin before submitting. Your location is not tracked in the background.";

export const LOCATION_EDUCATION_ACTION = "Use my location";

export const CAMERA_EDUCATION = "Camera access is needed for required evidence photos.";

/**
 * Report location: explain and wait for a tap while the OS has never been
 * asked; once permission was granted the location is fetched automatically.
 */
export function showLocationEducation(permission: string): boolean {
  return permission === "undetermined";
}
