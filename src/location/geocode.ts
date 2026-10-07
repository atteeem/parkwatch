// Reverse geocoding: coordinates -> a human-readable address (pure parts,
// testable without a device). The platform adapter lives in
// expoLocationProvider.ts. A failed lookup never invents an address: the
// citizen types one instead.

export type GeocodedPlace = {
  name?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  postalCode?: string | null;
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  formattedAddress?: string | null;
};

export type ReverseGeocoder = (point: { latitude: number; longitude: number }) => Promise<GeocodedPlace[]>;

/** Server limit for report addresses (reports.location_address). */
export const MAX_ADDRESS_LENGTH = 200;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** "Mannerheimintie 12, 00100 Helsinki" from a platform result; null if it has nothing usable. */
export function formatAddress(p: GeocodedPlace): string | null {
  const street = clean(p.street);
  const number = clean(p.streetNumber);
  // Some platforms put "Street 12" in name and leave street empty.
  const line1 = street ? (number && !street.includes(number) ? `${street} ${number}` : street) : clean(p.name);
  const city = clean(p.city) || clean(p.district) || clean(p.subregion);
  const line2 = [clean(p.postalCode), city].filter(Boolean).join(" ");
  const parts = [line1, line2].filter(Boolean);
  const text = parts.length > 0 ? parts.join(", ") : clean(p.formattedAddress);
  return text ? text.slice(0, MAX_ADDRESS_LENGTH) : null;
}

export type GeocodeResult = { ok: true; address: string } | { ok: false };

/** Look up the address of a point. Any failure or empty answer -> { ok: false } (manual fallback). */
export async function reverseGeocodeAddress(geocoder: ReverseGeocoder, point: { latitude: number; longitude: number }): Promise<GeocodeResult> {
  try {
    const places = await geocoder({ latitude: point.latitude, longitude: point.longitude });
    for (const p of places ?? []) {
      const address = formatAddress(p);
      if (address) return { ok: true, address };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
