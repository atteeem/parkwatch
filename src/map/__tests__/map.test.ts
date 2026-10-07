import { formatDistance, haversineMeters, straightLineDistance } from "../../geo/distance";
import { draftReducer, newDraftState } from "../../presentation/reportDraft";
import { isDraftValid } from "../../domain";
import { buildSeedState } from "../../store/seed";
import { selectOfficerCases } from "../../presentation/viewModels";
import {
  citizenReportMarkers,
  followReducer,
  gpsStatusText,
  INITIAL_FOLLOW_STATE,
  initialRegion,
  nearestNewCase,
  officerCaseMarkers,
  shouldFollowCamera,
} from "../mapLogic";

const report = (id: string, status: "under-review" | "verified" | "rejected", coordinates?: { latitude: number; longitude: number }) =>
  ({ id, status, coordinates, plate: id }) as never;

describe("follow mode", () => {
  it("starts ON, a user pan turns it OFF, Recenter turns it back ON", () => {
    expect(INITIAL_FOLLOW_STATE.following).toBe(true);
    const panned = followReducer(INITIAL_FOLLOW_STATE, { type: "USER_GESTURE" });
    expect(panned.following).toBe(false);
    expect(followReducer(panned, { type: "USER_GESTURE" })).toBe(panned);
    expect(followReducer(panned, { type: "RECENTER" }).following).toBe(true);
  });

  it("follows only meaningful moves, never while follow is OFF", () => {
    const at = { latitude: 60.1699, longitude: 24.9384 };
    const fix = (dLat: number) => ({ latitude: 60.1699 + dLat, longitude: 24.9384, capturedAt: "x" });
    expect(shouldFollowCamera(true, undefined, fix(0))).toBe(true); // first fix
    expect(shouldFollowCamera(true, at, fix(0.00002))).toBe(false); // ~2 m jitter
    expect(shouldFollowCamera(true, at, fix(0.0002))).toBe(true); // ~22 m
    expect(shouldFollowCamera(false, at, fix(0.01))).toBe(false); // user panned away
    expect(shouldFollowCamera(true, at, undefined)).toBe(false);
  });
});

describe("report markers", () => {
  const reports = [
    report("a", "under-review", { latitude: 60.17, longitude: 24.94 }),
    report("b", "verified", { latitude: 60.16, longitude: 24.93 }),
    report("c", "rejected", { latitude: 60.165, longitude: 24.95 }),
    report("d", "verified"), // no GPS
  ];

  it("only reports with real coordinates become markers (no substitutes)", () => {
    const markers = citizenReportMarkers(reports, "all");
    expect(markers.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(markers[0]).toMatchObject({ latitude: 60.17, longitude: 24.94, kind: "under-review" });
  });

  it("status filters change the marker set", () => {
    expect(citizenReportMarkers(reports, "verified").map((m) => m.id)).toEqual(["b"]);
    expect(citizenReportMarkers(reports, "rejected").map((m) => m.id)).toEqual(["c"]);
    expect(citizenReportMarkers(reports, "under-review").map((m) => m.id)).toEqual(["a"]);
  });

  it("officer markers: open cases with coordinates, completed ones excluded", () => {
    const seed = buildSeedState(new Date("2026-07-17T18:00:00.000Z"));
    const cases = selectOfficerCases(seed, new Date("2026-07-17T18:00:00.000Z"));
    const markers = officerCaseMarkers(cases);
    const open = cases.filter((c) => c.status !== "completed");
    expect(markers).toHaveLength(open.length);
    expect(markers.find((m) => m.id === "c-12564")?.kind).toBe("case-high");
    expect(markers.some((m) => m.id === "c-12484")).toBe(false); // completed
  });

  it("the starting camera prefers the user, then the markers; it is never stored as data", () => {
    expect(initialRegion({ latitude: 61, longitude: 25 }, [])).toMatchObject({ latitude: 61, longitude: 25 });
    const r = initialRegion(undefined, [
      { latitude: 60.16, longitude: 24.93 },
      { latitude: 60.18, longitude: 24.95 },
    ]);
    expect(r.latitude).toBeCloseTo(60.17);
    expect(r.longitude).toBeCloseTo(24.94);
  });
});

describe("straight-line distance", () => {
  it("known pairs give the expected distance", () => {
    // Helsinki Central Station -> Senate Square: ~0.6 km
    const station = { latitude: 60.1719, longitude: 24.9414 };
    const senate = { latitude: 60.1694, longitude: 24.9522 };
    expect(haversineMeters(station, senate)).toBeGreaterThan(560);
    expect(haversineMeters(station, senate)).toBeLessThan(680);
    // Helsinki -> Tallinn: ~80-90 km
    expect(haversineMeters({ latitude: 60.1699, longitude: 24.9384 }, { latitude: 59.437, longitude: 24.7536 }) / 1000).toBeCloseTo(82, -1);
    expect(haversineMeters(station, station)).toBe(0);
  });

  it("missing coordinates give no distance, not a fake 0", () => {
    expect(straightLineDistance(undefined, { latitude: 60, longitude: 24 })).toBeNull();
    expect(straightLineDistance({ latitude: 60, longitude: 24 }, null)).toBeNull();
    expect(straightLineDistance({ latitude: Number.NaN, longitude: 24 }, { latitude: 60, longitude: 24 })).toBeNull();
  });

  it("formats metres and kilometres", () => {
    expect(formatDistance(347)).toBe("350 m");
    expect(formatDistance(1234)).toBe("1.2 km");
  });

  it("nearest new case uses real distance when the officer position is known", () => {
    const seed = buildSeedState(new Date("2026-07-17T18:00:00.000Z"));
    const cases = selectOfficerCases(seed, new Date("2026-07-17T18:00:00.000Z"));
    // Officer standing at Elielinaukio: the Elielinaukio bus-stop case is nearest
    const result = nearestNewCase(cases, { latitude: 60.1716, longitude: 24.94 });
    expect(result?.item.location).toBe("Elielinaukio 5, Helsinki");
    expect(result?.distanceMeters).toBeLessThan(5);
    // Without a position: a case, but no distance
    const noFix = nearestNewCase(cases, undefined);
    expect(noFix?.item.status).toBe("new");
    expect(noFix?.distanceMeters).toBeNull();
  });
});

describe("report draft GPS", () => {
  const T = "2026-07-17T18:00:00.000Z";
  const withPhotos = () => {
    let s = newDraftState("d");
    for (const slot of ["FRONT", "SIDE", "REAR"] as const) s = draftReducer(s, { type: "CAPTURE_PHOTO", slot, uri: slot, capturedAt: T });
    return draftReducer(s, { type: "SET_VIOLATION", violationId: "no-parking" });
  };

  it("a real fix populates coordinates with accuracy and time", () => {
    const s = draftReducer(withPhotos(), {
      type: "SET_DEVICE_FIX",
      fix: { latitude: 60.1699, longitude: 24.9384, accuracyMeters: 9, capturedAt: T },
    });
    expect(s.draft.location.coordinates).toEqual({ latitude: 60.1699, longitude: 24.9384, accuracyMeters: 9, capturedAt: T });
  });

  it("GPS updates never overwrite the typed address (and vice versa)", () => {
    let s = draftReducer(withPhotos(), { type: "SET_LOCATION", address: "Mannerheimintie 45, Helsinki" });
    s = draftReducer(s, { type: "SET_DEVICE_FIX", fix: { latitude: 60.17, longitude: 24.94, capturedAt: T } });
    expect(s.draft.location.address).toBe("Mannerheimintie 45, Helsinki");
    s = draftReducer(s, { type: "SET_LOCATION", address: "Kaivokatu 12, Helsinki" });
    expect(s.draft.location.coordinates).toMatchObject({ latitude: 60.17 });
  });

  it("denied GPS does not block the manual-address workflow (no coordinates invented)", () => {
    const s = draftReducer(withPhotos(), { type: "SET_LOCATION", address: "Kaivokatu 12, Helsinki" });
    expect(s.draft.location.coordinates).toBeUndefined();
    expect(isDraftValid(s.draft, "SUBMIT")).toBe(true);
  });

  it("the GPS status line is honest", () => {
    expect(gpsStatusText("granted", false, { accuracyMeters: 9.4 })).toEqual({ ok: true, text: "GPS location attached (accurate to about 9 m)" });
    expect(gpsStatusText("granted", true, undefined).text).toMatch(/Getting/);
    expect(gpsStatusText("denied", false, undefined)).toMatchObject({ ok: false, text: expect.stringMatching(/unavailable/) });
    expect(gpsStatusText("blocked", false, undefined).ok).toBe(false);
  });

  it("every seed report has stored coordinates (so each can have a map marker)", () => {
    const seed = buildSeedState(new Date(T));
    expect(seed.reports.every((r) => r.location.coordinates)).toBe(true);
  });
});
