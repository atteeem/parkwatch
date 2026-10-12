// T9.1 map-first citizen parking: flow state machine, circular dial maths,
// area rows/quotes and truthfulness of the Parking tab (simulated parking).
import * as fs from "fs";
import * as path from "path";
import { addVehicle, DEMO_PARKING_HOURLY_RATE_CENTS, DEMO_PARKING_ZONES, MAX_PARKING_DURATION_MINUTES, ParkingSession, startParking } from "../../domain";
import {
  DIAL_DEGREES_PER_MINUTE,
  accessibilityStep,
  angleAt,
  angleDelta,
  angleForMinutes,
  arcFraction,
  dialAccessibilityText,
  dialHeadline,
  dialPresets,
  moveDrag,
  snapMinutes,
  startDrag,
} from "../parkingDial";
import { canGoBackInFlow, highlightedZone, INITIAL_PARKING_FLOW, ParkingFlowAction, parkingFlowReducer, ParkingFlowState } from "../parkingFlow";
import { durationQuote, extensionQuote, parkingAreaDetail, parkingAreaRows, toActiveParkingView } from "../parkingViews";

const ROOT = path.resolve(__dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const run = (actions: ParkingFlowAction[], from: ParkingFlowState = INITIAL_PARKING_FLOW) => actions.reduce(parkingFlowReducer, from);
const NOW = new Date(2026, 9, 12, 14, 31, 0);

describe("parking flow state machine", () => {
  it("opens at Select area; a map marker and a list row are the same SELECT_ZONE action", () => {
    expect(INITIAL_PARKING_FLOW.setup).toEqual({ step: "SELECT_AREA" });
    const viaMarker = run([{ type: "SELECT_ZONE", zoneId: "A1" }]);
    expect(viaMarker.setup).toEqual({ step: "AREA_DETAIL", zoneId: "A1" });
    // choosing another area while the detail is open switches it
    expect(run([{ type: "SELECT_ZONE", zoneId: "C4" }], viaMarker).setup).toEqual({ step: "AREA_DETAIL", zoneId: "C4" });
  });

  it("area -> vehicle -> duration -> confirm, then STARTED returns to Select area (active view is derived)", () => {
    const s1 = run([{ type: "SELECT_ZONE", zoneId: "A1" }, { type: "CONTINUE", vehicleId: "v1" }]);
    expect(s1.setup).toEqual({ step: "SELECT_VEHICLE", zoneId: "A1", vehicleId: "v1" });
    const s2 = run([{ type: "CHOOSE_VEHICLE", vehicleId: "v2" }, { type: "CONTINUE" }], s1);
    // the duration step starts at 1 minute, like a parking meter
    expect(s2.setup).toEqual({ step: "SELECT_DURATION", zoneId: "A1", vehicleId: "v2", minutes: 1 });
    const s3 = run([{ type: "SET_MINUTES", minutes: 77 }, { type: "CONTINUE" }], s2);
    expect(s3.setup).toEqual({ step: "CONFIRM", zoneId: "A1", vehicleId: "v2", minutes: 77 });
    const started = run([{ type: "STARTED" }], s3);
    expect(started.setup).toEqual({ step: "SELECT_AREA" });
    // the next session starts from 1 minute again
    expect(run([{ type: "SELECT_ZONE", zoneId: "A1" }, { type: "CONTINUE", vehicleId: "v1" }, { type: "CONTINUE" }], started).setup).toMatchObject({ minutes: 1 });
  });

  it("vehicle step cannot continue without a vehicle", () => {
    const s = run([{ type: "SELECT_ZONE", zoneId: "A1" }, { type: "CONTINUE" }]);
    expect(run([{ type: "CONTINUE" }], s)).toBe(s);
  });

  it("Back: Confirm -> Duration -> Vehicle -> Area -> Select area, keeping the choices", () => {
    let s = run([{ type: "SELECT_ZONE", zoneId: "B2" }, { type: "CONTINUE", vehicleId: "v1" }, { type: "CONTINUE" }, { type: "SET_MINUTES", minutes: 90 }, { type: "CONTINUE" }]);
    const steps: string[] = [s.setup.step];
    while (canGoBackInFlow(s, false)) {
      s = parkingFlowReducer(s, { type: "BACK" });
      steps.push(s.setup.step);
    }
    expect(steps).toEqual(["CONFIRM", "SELECT_DURATION", "SELECT_VEHICLE", "AREA_DETAIL", "SELECT_AREA"]);
    // the duration is remembered when going forward again
    const again = run([{ type: "SELECT_ZONE", zoneId: "B2" }, { type: "CONTINUE", vehicleId: "v1" }, { type: "CONTINUE" }], s);
    expect(again.setup).toMatchObject({ step: "SELECT_DURATION", minutes: 90 });
    // at Select area, Back is not consumed (the tab handles it)
    expect(canGoBackInFlow(INITIAL_PARKING_FLOW, false)).toBe(false);
  });

  it("map taps do not interrupt later steps", () => {
    const s = run([{ type: "SELECT_ZONE", zoneId: "A1" }, { type: "CONTINUE", vehicleId: "v1" }]);
    expect(run([{ type: "SELECT_ZONE", zoneId: "C4" }], s)).toBe(s);
  });

  it("active session: Extend / End and back to the summary; Back is consumed only inside a sub-step", () => {
    const ext = run([{ type: "OPEN_EXTEND" }]);
    expect(ext.active).toEqual({ step: "EXTEND", minutes: 1 });
    expect(run([{ type: "SET_MINUTES", minutes: 47 }], ext).active).toEqual({ step: "EXTEND", minutes: 47 });
    expect(run([{ type: "SET_MINUTES", minutes: 0 }], ext).active).toEqual({ step: "EXTEND", minutes: 1 });
    expect(canGoBackInFlow(ext, true)).toBe(true);
    expect(run([{ type: "BACK" }], ext).active).toEqual({ step: "ACTIVE" });
    expect(run([{ type: "OPEN_END" }]).active).toEqual({ step: "END" });
    expect(canGoBackInFlow(INITIAL_PARKING_FLOW, true)).toBe(false);
    expect(run([{ type: "OPEN_END" }, { type: "ENDED" }]).active).toEqual({ step: "ACTIVE" });
  });

  it("the highlighted map area follows the flow; an active session's area wins", () => {
    expect(highlightedZone(INITIAL_PARKING_FLOW, undefined)).toBeUndefined();
    expect(highlightedZone(run([{ type: "SELECT_ZONE", zoneId: "C4" }]), undefined)).toBe("C4");
    expect(highlightedZone(run([{ type: "SELECT_ZONE", zoneId: "C4" }]), "A1")).toBe("A1");
  });
});

describe("circular duration dial", () => {
  it("angles are clockwise from 12 o'clock", () => {
    expect(angleAt(0, -10, 0, 0)).toBeCloseTo(0);
    expect(angleAt(10, 0, 0, 0)).toBeCloseTo(90);
    expect(angleAt(0, 10, 0, 0)).toBeCloseTo(180);
    expect(angleAt(-10, 0, 0, 0)).toBeCloseTo(270);
  });

  it("crossing 12 o'clock is a small step, not a jump (wraparound)", () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20);
    expect(angleDelta(10, 350)).toBeCloseTo(-20);
    expect(angleDelta(90, 270)).toBeCloseTo(180);
    // dragging from 55 min past 12 o'clock continues into the next hour
    let d = startDrag(330, 55);
    for (const a of [345, 0, 15, 30]) d = moveDrag(d, a);
    expect(d.value).toBe(65);
  });

  it("whole-minute steps: 6 degrees = 1 minute, one turn = 60 minutes, no 5-minute snapping", () => {
    expect(DIAL_DEGREES_PER_MINUTE).toBe(6);
    expect(snapMinutes(62)).toBe(62);
    expect(snapMinutes(63)).toBe(63);
    expect(snapMinutes(63.4)).toBe(63);
    expect(snapMinutes(63.6)).toBe(64);
    expect(snapMinutes(0)).toBe(1);
    expect(snapMinutes(-40)).toBe(1);
    expect(snapMinutes(10_000)).toBe(MAX_PARKING_DURATION_MINUTES);
    // from the 1-minute start: 6° -> 2, 30° -> 6, 90° -> 16, 180° -> 31, a full turn -> 61
    const turnTo = (degs: number[]) => degs.reduce((d, a) => moveDrag(d, a), startDrag(0, 1)).value;
    expect(turnTo([6])).toBe(2);
    expect(turnTo([30])).toBe(6);
    expect(turnTo([45, 90])).toBe(16);
    expect(turnTo([90, 180])).toBe(31);
    expect(turnTo([90, 180, 270, 359.9])).toBe(61);
    // every minute is reachable one by one
    let d = startDrag(0, 1);
    const seen: number[] = [];
    for (let a = 1; a <= 60; a++) {
      d = moveDrag(d, a);
      if (seen.at(-1) !== d.value) seen.push(d.value);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("multi-turn: 1 h + one tick = 61, back one tick = 59, two full turns = 2 h more", () => {
    const tick = (from: number, deg: number) => moveDrag(startDrag(0, from), deg).value;
    expect(tick(60, 6)).toBe(61);
    expect(tick(60, -6 + 360)).toBe(59); // a small counter-clockwise move from 12 o'clock
    let d = startDrag(0, 1);
    for (let a = 30; a <= 720; a += 30) d = moveDrag(d, a % 360);
    expect(d.value).toBe(121);
  });

  it("clamps at 1 minute and at the maximum; turning back from either end responds at once", () => {
    let d = startDrag(0, 1);
    d = moveDrag(d, 300); // counter-clockwise at the minimum stays at 1
    expect(d.value).toBe(1);
    d = moveDrag(d, 306); // and moves as soon as the finger turns forward
    expect(d.value).toBe(2);
    const max = { min: 1, max: 120 };
    let m = startDrag(0, 115);
    for (const a of [90, 180, 270, 0, 90]) m = moveDrag(m, a, max);
    expect(m.value).toBe(120);
    m = moveDrag(m, 60, max);
    expect(m.value).toBe(115);
  });

  it("handle angle and arc for a duration (whole hours show a full ring)", () => {
    expect(angleForMinutes(15)).toBe(90);
    expect(angleForMinutes(75)).toBe(90);
    expect(arcFraction(30)).toBe(0.5);
    expect(arcFraction(60)).toBe(1);
    expect(arcFraction(0)).toBe(0);
  });

  it("screen readers adjust by 1 minute with a spoken value", () => {
    expect(accessibilityStep(60, 1)).toBe(61);
    expect(accessibilityStep(60, -1)).toBe(59);
    expect(accessibilityStep(2, -1)).toBe(1);
    expect(accessibilityStep(1, -1)).toBe(1);
    expect(accessibilityStep(MAX_PARKING_DURATION_MINUTES, 1)).toBe(MAX_PARKING_DURATION_MINUTES);
    expect(dialAccessibilityText(37, new Date(2026, 9, 12, 14, 15))).toBe("37 minutes, ends at 14:52");
    expect(dialAccessibilityText(72, new Date(2026, 9, 12, 14, 15))).toBe("1 hour 12 minutes, ends at 15:27");
    expect(dialAccessibilityText(1, new Date(2026, 9, 12, 14, 15))).toBe("1 minute, ends at 14:16");
    expect(dialAccessibilityText(75, new Date(2026, 9, 12, 14, 30))).toBe("1 hour 15 minutes, ends at 15:45");
    expect(dialAccessibilityText(5, new Date(2026, 9, 12, 14, 30))).toBe("5 minutes, ends at 14:35");
  });

  it("headline and presets", () => {
    expect(dialHeadline(1)).toBe("1m");
    expect(dialHeadline(61)).toBe("1h 1m");
    expect(dialHeadline(75)).toBe("1h 15m");
    expect(dialHeadline(45)).toBe("45m");
    expect(dialHeadline(120)).toBe("2h");
    expect(dialPresets().map((p) => p.label)).toEqual(["30 min", "1 h", "2 h", "Max"]);
    expect(dialPresets().slice(0, 3).map((p) => p.minutes)).toEqual([30, 60, 120]);
    expect(dialPresets().at(-1)!.minutes).toBe(MAX_PARKING_DURATION_MINUTES);
  });
});

describe("demo areas and quotes", () => {
  it("every demo area has a code, name, rate, centre and a demo outline; A1/B2 keep the base demo rate", () => {
    for (const z of DEMO_PARKING_ZONES) {
      expect(z.label).toBe(`Zone ${z.id}`);
      expect(z.name.length).toBeGreaterThan(0);
      expect(z.boundary.length).toBeGreaterThanOrEqual(3);
      expect(Number.isInteger(z.hourlyRateCents) && z.hourlyRateCents > 0).toBe(true);
    }
    expect(DEMO_PARKING_ZONES.find((z) => z.id === "A1")!.hourlyRateCents).toBe(DEMO_PARKING_HOURLY_RATE_CENTS);
    expect(new Set(DEMO_PARKING_ZONES.map((z) => z.id)).size).toBe(DEMO_PARKING_ZONES.length);
  });

  it("a session captures its area's demo rate", () => {
    const v = (addVehicle([], { plate: "ABC-123" }, { id: "v1", ownerId: "me", at: NOW.toISOString() }) as { ok: true; value: Parameters<typeof startParking>[1][number] }).value;
    const r = startParking([], [v], { vehicleId: "v1", zoneId: "C4", durationMinutes: 60 }, { id: "p1", ownerId: "me", at: NOW.toISOString() });
    expect(r.ok && r.value.hourlyRateCents).toBe(300);
  });

  it("area rows: nearest first with straight-line distance only when a position exists; search by code or name", () => {
    const noFix = parkingAreaRows(undefined);
    expect(noFix.map((r) => r.id)).toEqual(DEMO_PARKING_ZONES.map((z) => z.id));
    expect(noFix.every((r) => r.distanceText === undefined)).toBe(true);
    const nearKamppi = parkingAreaRows({ latitude: 60.1684, longitude: 24.9302 });
    expect(nearKamppi[0].id).toBe("D7");
    expect(nearKamppi[0].distanceText).toMatch(/m$/);
    expect(parkingAreaRows(undefined, "esplanadi").map((r) => r.id)).toEqual(["C4"]);
    expect(parkingAreaRows(undefined, "a1").map((r) => r.id)).toEqual(["A1"]);
    expect(parkingAreaRows(undefined, "zzz")).toEqual([]);
  });

  it("area detail is truthful: flat demo rate, demo source, no invented time-of-day pricing", () => {
    const d = parkingAreaDetail(DEMO_PARKING_ZONES.find((z) => z.id === "C4")!);
    expect(d).toMatchObject({ rateText: "€3.00 / h", pricingText: "Demo rate applies at all times", sourceText: "Demo area · not official zone data" });
    expect(JSON.stringify(d)).not.toMatch(/free|Mon|Sat/);
  });

  it("minute-level prices in integer cents at the area's demo rate", () => {
    const at300 = (m: number) => durationQuote(m, NOW, 300);
    expect(at300(1)).toMatchObject({ estimateCents: 5, estimateText: "€0.05", endText: "14:32", durationText: "1 min" });
    expect(at300(30).estimateText).toBe("€1.50");
    expect(at300(61)).toMatchObject({ estimateCents: 305, estimateText: "€3.05", endText: "15:32" });
    expect(at300(2).estimateCents).toBe(10);
    // non-round rates stay whole cents (no float display errors)
    for (let m = 1; m <= 180; m++) expect(Number.isInteger(durationQuote(m, NOW, 250).estimateCents)).toBe(true);
    expect(durationQuote(1, NOW, 250).estimateText).toBe("€0.04");
  });

  it("duration quote updates price and end time live", () => {
    expect(durationQuote(75, NOW, 220)).toEqual({ durationText: "1 h 15 min", endText: "15:46", estimateCents: 275, estimateText: "€2.75" });
    expect(durationQuote(30, NOW, 300).estimateText).toBe("€1.50");
  });

  it("extension quote: from the planned end, or from now when it has passed", () => {
    const s: ParkingSession = {
      id: "p",
      ownerId: "me",
      vehicleId: "v",
      plate: { raw: "ABC-123", normalized: "ABC123", country: "FI" } as ParkingSession["plate"],
      zoneId: "A1",
      location: "x",
      startedAt: new Date(2026, 9, 12, 14, 0).toISOString(),
      plannedEndAt: new Date(2026, 9, 12, 15, 0).toISOString(),
      status: "ACTIVE",
      hourlyRateCents: 200,
      extensions: [],
      provider: "SIMULATED",
    };
    expect(extensionQuote(s, 30, NOW)).toEqual({ currentEndText: "15:00", newEndText: "15:30", addedText: "+30 min", totalEstimateText: "€3.00" });
    // minute by minute: 1 -> 15:01, 15 -> 15:15, 61 -> 16:01
    expect(extensionQuote(s, 1, NOW)).toMatchObject({ newEndText: "15:01", addedText: "+1 min" });
    expect(extensionQuote(s, 15, NOW).newEndText).toBe("15:15");
    expect(extensionQuote(s, 61, NOW).newEndText).toBe("16:01");
    expect(extensionQuote(s, 30, new Date(2026, 9, 12, 16, 0)).newEndText).toBe("16:30");
    expect(toActiveParkingView(s, NOW)).toMatchObject({ zoneId: "A1", areaName: "Railway Square" });
  });
});

describe("Parking tab truthfulness and structure", () => {
  const screen = read("app/user/parking.tsx");
  const parts = fs
    .readdirSync(path.join(ROOT, "src/components/parking"))
    .map((f) => read(`src/components/parking/${f}`))
    .join("\n");

  it("no fake parking charges, Pay Now or payment method on the Parking tab", () => {
    for (const src of [screen, parts]) {
      expect(src).not.toMatch(/Pay Now|Parking Charges|Unpaid|Due Jul|card ending|payment method/i);
      expect(src).not.toMatch(/label="Pay"|>Pay</);
    }
  });

  it("the simulated-parking disclosure is shown on review, extend and end", () => {
    expect(parts).toMatch(/No parking operator is contacted and no payment is taken\./);
    for (const f of ["ParkingConfirmation.tsx", "ActiveParkingSheet.tsx"]) expect(read(`src/components/parking/${f}`)).toMatch(/<DemoDisclosure/);
    expect(parts).toMatch(/Estimated demo cost/);
    expect(screen).toMatch(/About demo parking/);
  });

  it("no route, ETA or operator integration; foreground location only and not persisted", () => {
    expect(screen + parts).not.toMatch(/\bETA\b|minutes away|driving time|EasyPark|ParkMan|Aimo|Stripe/);
    expect(screen).toMatch(/useForegroundLocation\(\{ watch: true \}\)/);
    expect(screen).not.toMatch(/AsyncStorage|persist/);
  });

  it("the start uses the existing domain action behind a double-tap guard", () => {
    expect(screen).toMatch(/guard\.run\(\(\) => startParking\(s\.vehicleId, s\.zoneId, s\.minutes\)/);
    expect(screen).toMatch(/guard\.run\(\(\) => extendParking\(minutes\)/);
    expect(screen).toMatch(/guard\.run\(\(\) => endParking\(\)/);
  });

  it("start/end times on the duration and review steps are live (no minute-stale 'Now')", () => {
    expect(screen).toMatch(/const liveTimes = !!activeParking \|\| flow\.setup\.step === "SELECT_DURATION" \|\| flow\.setup\.step === "CONFIRM";/);
    expect(screen).toMatch(/useNow\(liveTimes \? 1000 : 15_000\)/);
  });

  it("Android Back steps back inside the sheet; vehicles/history stay reachable from the menu", () => {
    expect(screen).toMatch(/hardwareBackPress/);
    expect(screen).toMatch(/router\.push\("\/user\/parking\/vehicles"\)/);
    expect(screen).toMatch(/router\.push\("\/user\/parking\/history"\)/);
    expect(screen).toMatch(/router\.push\("\/user\/parking\/add-vehicle"\)/);
  });

  it("the dial is an adjustable control with increment/decrement", () => {
    const dial = read("src/components/parking/CircularDurationPicker.tsx");
    expect(dial).toMatch(/accessibilityRole="adjustable"/);
    expect(dial).toMatch(/name: "increment"/);
    expect(dial).toMatch(/name: "decrement"/);
  });
});
