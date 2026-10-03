// Straight-line ("as the crow flies") distance. This is NOT road or driving
// distance and must not be presented as an ETA; routing comes later.

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6_371_008.8; // mean Earth radius
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isPoint = (p: LatLng | null | undefined): p is LatLng =>
  !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

/** Distance in metres, or null when either point is missing. Never a fake 0. */
export function straightLineDistance(a: LatLng | null | undefined, b: LatLng | null | undefined): number | null {
  return isPoint(a) && isPoint(b) ? haversineMeters(a, b) : null;
}

/** "350 m" / "1.2 km" (straight line). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
