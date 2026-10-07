// "Open in Maps" (T8.8): hand a case location to the platform's own maps
// app. ParkWatch itself does no routing, turn-by-turn navigation or ETA;
// any directions happen in the external app the officer chooses.
//
//   iOS:     Apple Maps (https://maps.apple.com opens the Maps app)
//   Android: geo: intent (default maps app, Google Maps compatible);
//            fallback: Google Maps web URL
//   web:     Google Maps web URL

import { Linking, Platform } from "react-native";

export type MapsPoint = { latitude: number; longitude: number };
export type MapsPlatform = "ios" | "android" | "web";

const coord = (n: number) => String(Math.round(n * 1e6) / 1e6);

export function isValidMapsPoint(p: MapsPoint | undefined | null): p is MapsPoint {
  return !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
}

/** Primary URL for the platform and a web fallback (null when the point is unusable). */
export function externalMapsUrls(point: MapsPoint | undefined | null, label: string, platform: MapsPlatform): { primary: string; fallback: string } | null {
  if (!isValidMapsPoint(point)) return null;
  const ll = `${coord(point.latitude)},${coord(point.longitude)}`;
  const name = label.trim().slice(0, 80) || "Report location";
  const web = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll)}`;
  if (platform === "ios") return { primary: `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(name)}`, fallback: web };
  if (platform === "android") return { primary: `geo:${ll}?q=${encodeURIComponent(`${ll}(${name})`)}`, fallback: web };
  return { primary: web, fallback: web };
}

/** Opens the platform maps app at the point. Resolves false if nothing could be opened. */
export async function openInExternalMaps(point: MapsPoint | undefined | null, label: string): Promise<boolean> {
  const urls = externalMapsUrls(point, label, Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web");
  if (!urls) return false;
  try {
    await Linking.openURL(urls.primary);
    return true;
  } catch {
    try {
      await Linking.openURL(urls.fallback);
      return true;
    } catch {
      return false;
    }
  }
}
