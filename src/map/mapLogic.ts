// Map behaviour that does not need a native map (pure, tested).

import { OfficerCase as OfficerCaseView, UserReport as CitizenReportView } from "../data/types";
import { haversineMeters, LatLng } from "../geo/distance";
import { LocationFix } from "../location/locationState";

// ---------------------------------------------------------------------------
// Follow mode: ON initially; any user pan/drag turns it OFF; Recenter turns it ON.

export type FollowState = { following: boolean };
export type FollowAction = { type: "USER_GESTURE" } | { type: "RECENTER" };

export const INITIAL_FOLLOW_STATE: FollowState = { following: true };

export function followReducer(state: FollowState, action: FollowAction): FollowState {
  if (action.type === "USER_GESTURE") return state.following ? { following: false } : state;
  return state.following ? state : { following: true };
}

/** Ignore GPS jitter: only move the camera for a meaningful position change. */
export const FOLLOW_MIN_MOVE_METERS = 8;

export function shouldFollowCamera(following: boolean, lastCentered: LatLng | undefined, next: LocationFix | undefined): boolean {
  if (!following || !next) return false;
  if (!lastCentered) return true;
  return haversineMeters(lastCentered, next) >= FOLLOW_MIN_MOVE_METERS;
}

// ---------------------------------------------------------------------------
// Markers

export type MarkerKind = "under-review" | "verified" | "rejected" | "case-new" | "case-active" | "case-high";

export type MapMarker = { id: string; latitude: number; longitude: number; kind: MarkerKind; title?: string };

const hasCoords = (c: { latitude: number; longitude: number } | undefined): c is LatLng =>
  !!c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude);

export type ReportFilter = "all" | CitizenReportView["status"];

/** Citizen report markers: only reports with REAL stored coordinates get one (no substitutes). */
export function citizenReportMarkers(reports: CitizenReportView[], filter: ReportFilter): MapMarker[] {
  return reports
    .filter((r) => (filter === "all" || r.status === filter) && hasCoords(r.coordinates))
    .map((r) => ({
      id: r.id,
      latitude: r.coordinates!.latitude,
      longitude: r.coordinates!.longitude,
      kind: r.status,
      title: r.plate,
    }));
}

/** Officer map markers for open cases with coordinates. */
export function officerCaseMarkers(cases: OfficerCaseView[]): MapMarker[] {
  return cases
    .filter((c) => c.status !== "completed" && c.status !== "rejected" && hasCoords(c.coordinates))
    .map((c) => ({
      id: c.id,
      latitude: c.coordinates!.latitude,
      longitude: c.coordinates!.longitude,
      kind: c.priority === "high" ? "case-high" : c.status === "new" ? "case-new" : "case-active",
      title: c.plate,
    }));
}

// ---------------------------------------------------------------------------
// Camera region

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/**
 * Starting CAMERA view only (never stored as data): the user's fix if known,
 * else the markers' extent, else central Helsinki as a neutral viewport.
 */
export function initialRegion(fix: LatLng | undefined, markers: LatLng[]): Region {
  if (fix) return { latitude: fix.latitude, longitude: fix.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 };
  if (markers.length > 0) {
    const lats = markers.map((m) => m.latitude);
    const lngs = markers.map((m) => m.longitude);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.6),
    };
  }
  return { latitude: 60.1699, longitude: 24.9384, latitudeDelta: 0.04, longitudeDelta: 0.04 };
}

// ---------------------------------------------------------------------------
// Report GPS status (Add Details)

/** Honest status line for the report's GPS location. Never implies a fix that doesn't exist. */
export function gpsStatusText(
  permission: "undetermined" | "granted" | "denied" | "blocked",
  loading: boolean,
  coords: { accuracyMeters?: number } | undefined
): { ok: boolean; text: string } {
  if (coords) {
    const acc = coords.accuracyMeters !== undefined ? ` (accurate to about ${Math.round(coords.accuracyMeters)} m)` : "";
    return { ok: true, text: `GPS location attached${acc}` };
  }
  if (permission === "granted" && loading) return { ok: false, text: "Getting your GPS location…" };
  return { ok: false, text: "Precise GPS location unavailable. The address you enter will be used." };
}

export type GeocodeStatus = "idle" | "loading" | "failed";

type LocationInputs = {
  permission: "undetermined" | "granted" | "denied" | "blocked";
  /** A GPS reading is in progress. */
  loading: boolean;
  coordinates?: { accuracyMeters?: number };
  coordinatesSource?: "GPS" | "MAP_SELECTED";
  addressSource?: "GEOCODED" | "TYPED";
  geocode: GeocodeStatus;
};

/**
 * Report location status line (Add Details). Honest about where the point
 * came from: a point picked on the map is never described as GPS.
 */
export function reportLocationStatus(a: LocationInputs): { ok: boolean; text: string } {
  const lookup = a.geocode === "loading" && a.addressSource !== "TYPED";
  const noAddress = a.geocode === "failed" && a.addressSource !== "TYPED" ? " The address could not be found; please type it." : "";
  if (a.coordinates && a.coordinatesSource === "MAP_SELECTED") {
    return { ok: true, text: lookup ? "Point set on the map. Finding its address…" : `Point set on the map.${noAddress}` };
  }
  if (a.coordinates) {
    const acc = a.coordinates.accuracyMeters !== undefined ? ` (accurate to about ${Math.round(a.coordinates.accuracyMeters)} m)` : "";
    return { ok: true, text: lookup ? "GPS location found. Finding the address…" : `GPS location attached${acc}.${noAddress}` };
  }
  if (a.permission === "granted" && a.loading) return { ok: false, text: "Getting your GPS location…" };
  if (a.permission === "undetermined") return { ok: false, text: "Use your location above, or type the address." };
  return { ok: false, text: "GPS location unavailable. Please type the address." };
}

/**
 * The address is shown read-only when it came from the location; the text
 * field is only the fallback (no permission / no fix / lookup failed), or
 * when the citizen already typed one.
 */
export function addressNeedsTyping(a: LocationInputs): boolean {
  if (a.addressSource === "TYPED") return true;
  if (a.coordinates) return a.geocode === "failed";
  return !(a.permission === "granted" && a.loading);
}

// ---------------------------------------------------------------------------
// Officer: nearest new case by straight-line distance

/**
 * The nearest NEW case to the officer. With a position: closest case that
 * has coordinates (distance in metres, straight line). Without a position or
 * coordinates: the first new case, with distance null (never a fake 0).
 */
export function nearestNewCase<C extends OfficerCaseView>(
  cases: C[],
  officer: LatLng | undefined
): { item: C; distanceMeters: number | null } | undefined {
  const fresh = cases.filter((c) => c.status === "new");
  if (fresh.length === 0) return undefined;
  if (officer) {
    let best: { item: C; distanceMeters: number } | undefined;
    for (const c of fresh) {
      if (!hasCoords(c.coordinates)) continue;
      const d = haversineMeters(officer, c.coordinates);
      if (!best || d < best.distanceMeters) best = { item: c, distanceMeters: d };
    }
    if (best) return best;
  }
  return { item: fresh[0], distanceMeters: null };
}
