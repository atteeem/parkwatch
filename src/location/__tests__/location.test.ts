import { createLocationStore, LocationProvider } from "../locationStore";
import { permissionFromResponse, RawPosition, toLocationFix } from "../locationState";

const POS = (lat: number, lng: number, accuracy: number | null = 12, t = Date.parse("2026-07-17T18:00:00.000Z")): RawPosition => ({
  coords: { latitude: lat, longitude: lng, accuracy },
  timestamp: t,
});

/** Controllable fake device. */
function fakeProvider(opts: { permission?: "granted" | "denied" | "undetermined"; canAskAgain?: boolean; grantOnRequest?: boolean } = {}) {
  let status = opts.permission ?? "undetermined";
  const watches: { onPosition: (p: RawPosition) => void; active: boolean }[] = [];
  const provider: LocationProvider & { emit: (p: RawPosition) => void; activeWatches: () => number; current?: RawPosition | Error } = {
    current: POS(60.1699, 24.9384),
    getPermission: async () => ({ status, canAskAgain: opts.canAskAgain ?? true }),
    requestPermission: async () => {
      status = opts.grantOnRequest === false ? "denied" : "granted";
      return { status, canAskAgain: opts.canAskAgain ?? true };
    },
    getCurrentPosition: async () => {
      if (provider.current instanceof Error) throw provider.current;
      return provider.current!;
    },
    watchPosition: async (onPosition) => {
      const w = { onPosition, active: true };
      watches.push(w);
      return () => {
        w.active = false;
      };
    },
    emit: (p) => watches.filter((w) => w.active).forEach((w) => w.onPosition(p)),
    activeWatches: () => watches.filter((w) => w.active).length,
  };
  return provider;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("location state", () => {
  it("maps OS permission responses", () => {
    expect(permissionFromResponse({ status: "granted", canAskAgain: true })).toBe("granted");
    expect(permissionFromResponse({ status: "undetermined", canAskAgain: true })).toBe("undetermined");
    expect(permissionFromResponse({ status: "denied", canAskAgain: true })).toBe("denied");
    expect(permissionFromResponse({ status: "denied", canAskAgain: false })).toBe("blocked");
  });

  it("a valid reading keeps lat/lng/accuracy/time", () => {
    expect(toLocationFix(POS(60.1699, 24.9384, 12))).toEqual({
      latitude: 60.1699,
      longitude: 24.9384,
      accuracyMeters: 12,
      capturedAt: "2026-07-17T18:00:00.000Z",
    });
    expect(toLocationFix(POS(60, 24, null))).not.toHaveProperty("accuracyMeters");
  });

  it("unusable readings never become coordinates", () => {
    expect(toLocationFix(undefined)).toBeNull();
    expect(toLocationFix(POS(Number.NaN, 24))).toBeNull();
    expect(toLocationFix(POS(95, 24))).toBeNull();
    expect(toLocationFix({ coords: undefined } as unknown as RawPosition)).toBeNull();
  });
});

describe("location store", () => {
  it("denied permission gives a denied state and no coordinates", async () => {
    const store = createLocationStore(fakeProvider({ grantOnRequest: false }));
    await store.init();
    await store.requestPermission();
    expect(store.getSnapshot()).toMatchObject({ permission: "denied" });
    expect(store.getSnapshot().fix).toBeUndefined();
    expect(await store.refreshLocation()).toBeUndefined();
  });

  it("blocked when the OS will not ask again", async () => {
    const store = createLocationStore(fakeProvider({ permission: "denied", canAskAgain: false }));
    await store.init();
    expect(store.getSnapshot().permission).toBe("blocked");
  });

  it("granted: stores the real fix", async () => {
    const store = createLocationStore(fakeProvider());
    await store.init();
    await store.requestPermission();
    expect(store.getSnapshot()).toMatchObject({ permission: "granted", loading: false, fix: { latitude: 60.1699, longitude: 24.9384, accuracyMeters: 12 } });
  });

  it("a failed / timed-out lookup sets an error and invents nothing", async () => {
    const p = fakeProvider({ permission: "granted" });
    p.current = new Error("gps off");
    const store = createLocationStore(p);
    await store.init();
    await store.refreshLocation();
    expect(store.getSnapshot().fix).toBeUndefined();
    expect(store.getSnapshot().error).toBeDefined();

    const slow = fakeProvider({ permission: "granted" });
    slow.getCurrentPosition = () => new Promise(() => undefined);
    const timed = createLocationStore(slow, { timeoutMs: 5 });
    await timed.init();
    await timed.refreshLocation();
    expect(timed.getSnapshot().loading).toBe(false);
    expect(timed.getSnapshot().fix).toBeUndefined();
    expect(timed.getSnapshot().error).toBeDefined();
  });

  it("a later failure keeps the last REAL fix rather than clearing or faking it", async () => {
    const p = fakeProvider({ permission: "granted" });
    const store = createLocationStore(p);
    await store.init();
    await store.refreshLocation();
    p.current = new Error("lost signal");
    await store.refreshLocation();
    expect(store.getSnapshot().fix?.latitude).toBe(60.1699);
  });

  it("one shared watch: starts with the first screen, stops when the last one leaves", async () => {
    const p = fakeProvider({ permission: "granted" });
    const store = createLocationStore(p);
    await store.init();
    const releaseMap = store.startForegroundWatch();
    const releaseOther = store.startForegroundWatch();
    await flush();
    expect(p.activeWatches()).toBe(1);
    p.emit(POS(60.17, 24.94, 5));
    expect(store.getSnapshot().fix).toMatchObject({ latitude: 60.17, accuracyMeters: 5 });
    releaseMap();
    expect(p.activeWatches()).toBe(1); // still needed by the other screen
    releaseOther();
    releaseOther(); // double release is harmless
    expect(p.activeWatches()).toBe(0);
    expect(store.getSnapshot().watching).toBe(false);
    expect(store.activeWatchers()).toBe(0);
  });

  it("no watch is started without permission; granting later starts it for screens still open", async () => {
    const p = fakeProvider();
    const store = createLocationStore(p);
    await store.init();
    const release = store.startForegroundWatch();
    await flush();
    expect(p.activeWatches()).toBe(0);
    await store.requestPermission();
    await flush();
    expect(p.activeWatches()).toBe(1);
    release();
    expect(p.activeWatches()).toBe(0);
  });
});
