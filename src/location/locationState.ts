// Device-location state (pure). Infrastructure, not domain: business logic
// only ever receives plain GeoPoints, never Expo objects.

export type LocationPermission =
  | "undetermined" // not asked yet
  | "granted"
  | "denied" // refused, but the OS will ask again
  | "blocked"; // refused and the OS won't ask again -> Settings

export type LocationFix = {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in metres, if the device reports one. */
  accuracyMeters?: number;
  /** When the fix was taken (ISO). */
  capturedAt: string;
};

export type LocationState = {
  permission: LocationPermission;
  /** Last REAL fix. Never invented; undefined until the device provides one. */
  fix?: LocationFix;
  loading: boolean;
  /** Friendly message for the last failure, if any. */
  error?: string;
  watching: boolean;
};

export const INITIAL_LOCATION_STATE: LocationState = { permission: "undetermined", loading: false, watching: false };

export type PermissionResponse = { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

export function permissionFromResponse(r: PermissionResponse): LocationPermission {
  if (r.status === "granted") return "granted";
  if (r.status === "undetermined") return "undetermined";
  return r.canAskAgain ? "denied" : "blocked";
}

/** Raw position as reported by the platform (Expo Location / browser geolocation shape). */
export type RawPosition = {
  coords: { latitude: number; longitude: number; accuracy?: number | null };
  timestamp: number;
};

/** Validate a platform position. Returns null (never a guess) for anything unusable. */
export function toLocationFix(raw: RawPosition | null | undefined): LocationFix | null {
  const c = raw?.coords;
  if (!c) return null;
  const { latitude, longitude } = c;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const fix: LocationFix = {
    latitude,
    longitude,
    capturedAt: new Date(Number.isFinite(raw!.timestamp) ? raw!.timestamp : Date.now()).toISOString(),
  };
  if (typeof c.accuracy === "number" && Number.isFinite(c.accuracy) && c.accuracy >= 0) fix.accuracyMeters = c.accuracy;
  return fix;
}

export const LOCATION_UNAVAILABLE_MESSAGE = "Your current location is not available right now.";
