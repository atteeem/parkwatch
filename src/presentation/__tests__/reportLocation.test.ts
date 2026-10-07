// T8.7 citizen report: automatic GPS -> address, map correction with honest
// provenance, manual fallback, read-only observed time, Review edit routing,
// and draft persistence of all of it.
import * as fs from "fs";
import * as path from "path";
import { draftReducer, newDraftState, draftObservedAt, afterStep, REVIEW_EDIT_ROUTE, CitizenDraftState } from "../reportDraft";
import { formatAddress, reverseGeocodeAddress, MAX_ADDRESS_LENGTH } from "../../location/geocode";
import { addressNeedsTyping, reportLocationStatus } from "../../map/mapLogic";
import { createReportFromDraft, isDraftValid } from "../../domain";
import { loadPersistedDraft, savePersistedDraft } from "../draftPersistence";
import { createMemoryStorage } from "../../store/persistence";
import { toDraftReview } from "../citizenViews";
import { systemChecks } from "../officerViews";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const T1 = "2026-10-07T09:34:10.000Z";
const T2 = "2026-10-07T09:35:00.000Z";
const FIX = { latitude: 60.1699, longitude: 24.9384, accuracyMeters: 9, capturedAt: "2026-10-07T09:40:00.000Z" };

function withPhotos(): CitizenDraftState {
  let s = newDraftState("d-loc");
  s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "SIDE", uri: "file:///side.jpg", capturedAt: T2 });
  s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "FRONT", uri: "file:///front.jpg", capturedAt: T1 });
  s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "REAR", uri: "file:///rear.jpg", capturedAt: T2 });
  return draftReducer(s, { type: "SET_VIOLATION", violationId: "no-parking" });
}

describe("automatic GPS -> address", () => {
  it("a device fix becomes the report point (source GPS) and is kept as provenance", () => {
    const s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    expect(s.draft.location.coordinates).toEqual(FIX);
    expect(s.draft.location.coordinatesSource).toBe("GPS");
    expect(s.draft.location.deviceFix).toEqual(FIX);
  });

  it("the reverse-geocoded address fills the Location field (no typing needed)", () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SET_GEOCODED_ADDRESS", address: "Mannerheimintie 12, 00100 Helsinki", point: FIX });
    expect(s.draft.location.address).toBe("Mannerheimintie 12, 00100 Helsinki");
    expect(s.draft.addressSource).toBe("GEOCODED");
    expect(isDraftValid(s.draft, "SUBMIT")).toBe(true);
  });

  it("a stale lookup (for a point that is no longer the report point) is ignored", () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SELECT_MAP_POINT", latitude: 60.171, longitude: 24.941 });
    s = draftReducer(s, { type: "SET_GEOCODED_ADDRESS", address: "Old point street 1", point: FIX });
    expect(s.draft.location.address).toBe("");
  });

  it("a typed address is never overwritten by geocoding", () => {
    let s = draftReducer(withPhotos(), { type: "SET_LOCATION", address: "Kaivokatu 12, Helsinki" });
    s = draftReducer(s, { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SET_GEOCODED_ADDRESS", address: "Somewhere else 1", point: FIX });
    expect(s.draft.location.address).toBe("Kaivokatu 12, Helsinki");
    expect(s.draft.addressSource).toBe("TYPED");
  });

  it("formats platform results into a readable address", () => {
    expect(formatAddress({ street: "Mannerheimintie", streetNumber: "12", postalCode: "00100", city: "Helsinki" })).toBe("Mannerheimintie 12, 00100 Helsinki");
    expect(formatAddress({ name: "Kaivokatu 1", city: "Helsinki" })).toBe("Kaivokatu 1, Helsinki");
    expect(formatAddress({ street: "Aleksanterinkatu 5", streetNumber: "5", district: "Kluuvi" })).toBe("Aleksanterinkatu 5, Kluuvi");
    expect(formatAddress({ formattedAddress: "  Some place  " })).toBe("Some place");
    expect(formatAddress({})).toBeNull();
    expect(formatAddress({ name: "x".repeat(400) })!.length).toBe(MAX_ADDRESS_LENGTH);
  });

  it("lookup failures never invent an address", async () => {
    expect(await reverseGeocodeAddress(async () => [], FIX)).toEqual({ ok: false });
    expect(await reverseGeocodeAddress(async () => [{}], FIX)).toEqual({ ok: false });
    expect(await reverseGeocodeAddress(async () => Promise.reject(new Error("no geocoder on web")), FIX)).toEqual({ ok: false });
    expect(await reverseGeocodeAddress(async () => [{}, { street: "Kaivokatu", streetNumber: "1", city: "Helsinki" }], FIX)).toEqual({ ok: true, address: "Kaivokatu 1, Helsinki" });
  });
});

describe("manual address only as a fallback", () => {
  const base = { loading: false, geocode: "idle" as const };
  it("found address -> read-only (no typing)", () => {
    expect(addressNeedsTyping({ ...base, permission: "granted", coordinates: { accuracyMeters: 8 }, coordinatesSource: "GPS", addressSource: "GEOCODED" })).toBe(false);
  });
  it("while the first GPS fix is coming -> wait, no text field yet", () => {
    expect(addressNeedsTyping({ ...base, permission: "granted", loading: true })).toBe(false);
  });
  it("permission denied / blocked / GPS failed -> type the address", () => {
    expect(addressNeedsTyping({ ...base, permission: "denied" })).toBe(true);
    expect(addressNeedsTyping({ ...base, permission: "blocked" })).toBe(true);
    expect(addressNeedsTyping({ ...base, permission: "granted" })).toBe(true); // granted but no fix came
  });
  it("lookup failed -> type the address; already typed -> keep the text field", () => {
    expect(addressNeedsTyping({ ...base, permission: "granted", coordinates: {}, coordinatesSource: "GPS", geocode: "failed" })).toBe(true);
    expect(addressNeedsTyping({ ...base, permission: "granted", coordinates: {}, coordinatesSource: "GPS", addressSource: "TYPED" })).toBe(true);
  });
  it("status line never calls a map-picked point GPS", () => {
    const map = reportLocationStatus({ ...base, permission: "granted", coordinates: {}, coordinatesSource: "MAP_SELECTED" });
    expect(map.text).toMatch(/map/i);
    expect(map.text).not.toMatch(/GPS/);
    expect(reportLocationStatus({ ...base, permission: "granted", coordinates: { accuracyMeters: 9.4 }, coordinatesSource: "GPS" }).text).toBe(
      "GPS location attached (accurate to about 9 m)."
    );
    expect(reportLocationStatus({ ...base, permission: "denied" }).text).toMatch(/type the address/);
    expect(reportLocationStatus({ ...base, permission: "granted", coordinates: {}, coordinatesSource: "GPS", geocode: "failed" }).text).toMatch(/could not be found/);
  });
});

describe("map correction keeps provenance honest", () => {
  it("a picked point has no GPS accuracy/time; the raw device fix stays unchanged", () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SET_GEOCODED_ADDRESS", address: "Gps street 1", point: FIX });
    s = draftReducer(s, { type: "SELECT_MAP_POINT", latitude: 60.1712, longitude: 24.9411 });
    expect(s.draft.location.coordinates).toEqual({ latitude: 60.1712, longitude: 24.9411 });
    expect(s.draft.location.coordinatesSource).toBe("MAP_SELECTED");
    expect(s.draft.location.deviceFix).toEqual(FIX);
    // The old address described the old point: it is replaced by a new lookup.
    expect(s.draft.addressSource).toBeUndefined();
    s = draftReducer(s, { type: "SET_GEOCODED_ADDRESS", address: "Picked street 3", point: { latitude: 60.1712, longitude: 24.9411 } });
    expect(s.draft.location.address).toBe("Picked street 3");
  });

  it("a later GPS fix never moves a point the citizen picked (only the device fix updates)", () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SELECT_MAP_POINT", latitude: 60.1712, longitude: 24.9411 });
    const later = { ...FIX, latitude: 60.1701, capturedAt: "2026-10-07T09:41:00.000Z" };
    s = draftReducer(s, { type: "SET_DEVICE_FIX", fix: later });
    expect(s.draft.location.coordinates).toEqual({ latitude: 60.1712, longitude: 24.9411 });
    expect(s.draft.location.deviceFix).toEqual(later);
  });

  it("'Use my GPS' puts the device fix back as the report point", () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SELECT_MAP_POINT", latitude: 60.1712, longitude: 24.9411 });
    s = draftReducer(s, { type: "USE_DEVICE_FIX" });
    expect(s.draft.location).toMatchObject({ coordinates: FIX, coordinatesSource: "GPS" });
  });

  it("the submitted report carries the picked point + source, never the raw device fix (local store path)", () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SELECT_MAP_POINT", latitude: 60.1712, longitude: 24.9411 });
    s = draftReducer(s, { type: "SET_GEOCODED_ADDRESS", address: "Picked street 3", point: { latitude: 60.1712, longitude: 24.9411 } });
    const r = createReportFromDraft(s.draft, { id: "r1", citizenId: "c1", jurisdictionId: "j", submittedAt: T2, source: "USER_ACTION" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.location).toEqual({
      address: "Picked street 3",
      coordinates: { latitude: 60.1712, longitude: 24.9411 },
      coordinatesSource: "MAP_SELECTED",
    });
    // The original GPS fix stays in the draft ("Use my GPS") but is not part of the report.
    expect(s.draft.location.deviceFix).toEqual(FIX);
    expect(r.value.location).not.toHaveProperty("deviceFix");
    // Draft-only bookkeeping is not part of the report.
    expect(r.value).not.toHaveProperty("addressSource");
  });

  it("officers see a map-picked point described as such, never as reporter GPS", () => {
    expect(systemChecks({ coordinates: { source: "MAP_SELECTED" } })[0]).toEqual({ label: "Location set by reporter on the map", state: "info" });
    expect(systemChecks({ coordinates: { accuracyMeters: 9, source: "GPS" } })[0].label).toBe("Location from reporter GPS (±9 m)");
  });

  it("the server request never sends GPS accuracy/time for a map-picked point", () => {
    const store = read("src/backend/core/coreBackendStore.ts");
    expect(store).toMatch(/locationAccuracyM: source === "GPS" \? coords\?\.accuracyMeters : undefined/);
    expect(store).toMatch(/locationCapturedAt: source === "GPS" \? coords\?\.capturedAt : undefined/);
    expect(store).toMatch(/locationSource: coords \? source : undefined/);
  });
});

describe("observed time is automatic and read-only", () => {
  it("defaults to the EARLIEST required camera photo, not the first slot", () => {
    expect(draftObservedAt(withPhotos().draft)).toBe(T1);
  });

  it("the citizen has no date/time picker or setter", () => {
    const screen = read("app/user/report/add-details.tsx");
    expect(screen).toMatch(/Observed automatically/);
    expect(screen).toMatch(/From the time of your first evidence photo/);
    expect(screen).not.toMatch(/DateTimePicker|datetimepicker|setObservedAt|type="date"/);
    expect(read("src/context/ReportContext.tsx")).not.toMatch(/setObservedAt|SET_OBSERVED/);
    expect(read("src/presentation/reportDraft.ts")).not.toMatch(/SET_OBSERVED/);
  });

  it("the server keeps observedAt (device) and receivedAt (server) separate", () => {
    const store = read("src/backend/core/coreBackendStore.ts");
    expect(store).toMatch(/observedAt: draftObservedAtOf\(draft\)/);
    expect(store).not.toMatch(/receivedAt:/);
  });
});

describe("Review & Submit edit routing", () => {
  it("each edit opens the right step with from=review, and Continue there returns to Review", () => {
    expect(REVIEW_EDIT_ROUTE).toEqual({ photos: "/user/report/photos", violation: "/user/report/select-violation", details: "/user/report/add-details" });
    for (const step of ["photos", "violation", "details"] as const) expect(afterStep(step, "review")).toEqual({ kind: "backToReview" });
    expect(afterStep("photos", undefined)).toEqual({ kind: "push", route: "/user/report/select-violation" });
    expect(afterStep("violation", undefined)).toEqual({ kind: "push", route: "/user/report/add-details" });
    expect(afterStep("details", ["review"])).toEqual({ kind: "backToReview" });
    expect(afterStep("details", "elsewhere")).toEqual({ kind: "push", route: "/user/report/review" });
  });

  it("the Review screen has Change/Edit actions, shows the notes, uses the real map and the gallery", () => {
    const review = read("app/user/report/review.tsx");
    expect(review).toMatch(/action="Change" onPress=\{\(\) => edit\("violation"\)\}/);
    expect(review).toMatch(/title="Location" action="Edit" onPress=\{\(\) => edit\("details"\)\}/);
    expect(review).toMatch(/title="Additional information" action="Edit"/);
    expect(review).toMatch(/action="Edit photos" onPress=\{\(\) => edit\("photos"\)\}/);
    expect(review).toMatch(/params: \{ from: "review" \}/);
    expect(review).toMatch(/<LiveMap[^>]*reportPoint=\{view\.point\}/);
    expect(review).not.toMatch(/mapDot/);
    expect(review).toMatch(/<EvidenceThumbnails items=\{view\.gallery\}/);
    for (const step of ["select-violation.tsx", "add-details.tsx", "photos.tsx"]) {
      expect([step, /afterStep\(/.test(read(`app/user/report/${step}`))]).toEqual([step, true]);
    }
  });

  it("the review view shows notes, observed time and the point's source", () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SELECT_MAP_POINT", latitude: 60.1712, longitude: 24.9411 });
    s = draftReducer(s, { type: "SET_NOTES", notes: "  Blocking the ramp  " });
    s = draftReducer(s, { type: "ADD_ATTACHMENT", uri: "file:///extra.jpg", pickedAt: T2 });
    const v = toDraftReview(s.draft, { displayName: "Mika", reliability: "Medium", verifiedReports: 0, known: false } as never);
    expect(v.notes).toBe("Blocking the ramp");
    expect(v.pointSourceText).toBe("Set on the map");
    expect(v.point).toEqual({ latitude: 60.1712, longitude: 24.9411 });
    expect(v.observedText).toMatch(/^07\.10\.2026 · \d\d:34$/);
    expect(v.gallery.map((g) => g.caption)).toEqual(["Front", "Side", "Rear", "Attachment"]);
  });
});

describe("draft persistence after location changes", () => {
  it("a restored draft keeps the picked point, its source, the device fix and the address source", async () => {
    let s = draftReducer(withPhotos(), { type: "SET_DEVICE_FIX", fix: FIX });
    s = draftReducer(s, { type: "SELECT_MAP_POINT", latitude: 60.1712, longitude: 24.9411 });
    s = draftReducer(s, { type: "SET_GEOCODED_ADDRESS", address: "Picked street 3", point: { latitude: 60.1712, longitude: 24.9411 } });
    const storage = createMemoryStorage();
    await savePersistedDraft(storage, { userId: "user-a", draft: s.draft, uploaded: [] });
    const back = await loadPersistedDraft(storage, "user-a");
    expect(back?.draft.location).toEqual(s.draft.location);
    expect(back?.draft.addressSource).toBe("GEOCODED");
    const restored = draftReducer(newDraftState("other"), { type: "RESTORE", draft: back!.draft });
    // A later fix after restoring still does not move the picked point.
    const after = draftReducer(restored, { type: "SET_DEVICE_FIX", fix: { ...FIX, capturedAt: "2026-10-07T10:00:00.000Z" } });
    expect(after.draft.location.coordinates).toEqual({ latitude: 60.1712, longitude: 24.9411 });
  });
});
