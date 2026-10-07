import { addVehicle, endParking, ParkingSession, startParking } from "../../domain";
import {
  clampCustomDuration,
  formatCountdown,
  formatDurationMinutes,
  parkingHistory,
  parkingQuote,
  toActiveParkingView,
  vehicleViews,
} from "../parkingViews";

const OWNER = "citizen-1";
const T0 = "2026-10-04T10:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000);
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }) => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const v1 = unwrap(addVehicle([], { plate: "ABC-123", make: "Volvo", model: "XC60" }, { id: "veh-1", ownerId: OWNER, at: T0 }));
const v2 = unwrap(addVehicle([v1], { plate: "XYZ-9" }, { id: "veh-2", ownerId: OWNER, at: T0 }));
const session = (id: string, vehicleId: string, startMin: number, minutes: number): ParkingSession =>
  unwrap(startParking([], [v1, v2], { vehicleId, zoneId: "A1", durationMinutes: minutes }, { id, ownerId: OWNER, at: at(startMin).toISOString() }));

describe("active session view (derived from timestamps)", () => {
  const s = session("park-1", "veh-1", 0, 60);

  it("remaining time counts down from the planned end", () => {
    expect(toActiveParkingView(s, at(0)).remainingText).toBe("1:00:00");
    expect(toActiveParkingView(s, new Date(at(17).getTime() + 33_000)).remainingText).toBe("42:27");
    const v = toActiveParkingView(s, at(45));
    expect(v).toMatchObject({ remainingText: "15:00", elapsedText: "45 min", expired: false, currentCostText: "€1.50", zone: "Zone A1", plate: "ABC-123" });
    expect(v.progress).toBeCloseTo(0.75);
  });

  it("expired sessions show zero remaining (never negative)", () => {
    expect(toActiveParkingView(s, at(75))).toMatchObject({ remainingMs: 0, remainingText: "00:00", expired: true });
  });

  it("the same stored session gives the same view after a 'reload' (nothing stored but timestamps)", () => {
    const reloaded = JSON.parse(JSON.stringify(s)) as ParkingSession;
    expect(toActiveParkingView(reloaded, at(10))).toEqual(toActiveParkingView(s, at(10)));
  });
});

describe("start summary", () => {
  it("quote shows duration, start/end and the demo estimate", () => {
    const q = parkingQuote(90, new Date(2026, 9, 4, 10, 0));
    expect(q).toMatchObject({ durationText: "1 h 30 min", startText: "10:00", endText: "11:30", estimateText: "€3.00" });
    expect(q.rateText).toContain("demo rate");
  });

  it("custom duration snaps to 15-minute steps within 15 min .. 24 h", () => {
    expect(clampCustomDuration(100)).toBe(105);
    expect(clampCustomDuration(0)).toBe(15);
    expect(clampCustomDuration(5000)).toBe(1440);
  });

  it("formats durations and countdowns", () => {
    expect(formatDurationMinutes(45)).toBe("45 min");
    expect(formatDurationMinutes(120)).toBe("2 h");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
  });
});

describe("history", () => {
  it("completed sessions only, newest first, with plate/location/times/duration/cost", () => {
    const older = unwrap(endParking(session("park-1", "veh-1", 0, 60), at(30).toISOString()));
    const newer = unwrap(endParking(session("park-2", "veh-2", 120, 60), at(210).toISOString()));
    const active = session("park-3", "veh-1", 300, 30);
    const h = parkingHistory([older, newer, active], OWNER);
    expect(h.map((x) => x.id)).toEqual(["park-2", "park-1"]);
    expect(h[0]).toMatchObject({ plate: "XYZ-9", zone: "Zone A1", location: "Kaivokatu 12, Helsinki", durationText: "1 h 30 min", costText: "€3.00", statusText: "Completed" });
    expect(h[1]).toMatchObject({ plate: "ABC-123", durationText: "30 min", costText: "€1.00" });
  });

  it("empty when nothing has been completed", () => {
    expect(parkingHistory([session("park-1", "veh-1", 0, 60)], OWNER)).toEqual([]);
  });
});

describe("vehicle list", () => {
  it("default = most recently used vehicle, else the first registered", () => {
    expect(vehicleViews([v1, v2], [], OWNER).map((v) => v.isDefault)).toEqual([true, false]);
    expect(vehicleViews([v1, v2], [session("park-1", "veh-2", 0, 30)], OWNER).map((v) => v.isDefault)).toEqual([false, true]);
    expect(vehicleViews([v1], [], OWNER)[0]).toMatchObject({ plate: "ABC-123", title: "Volvo XC60" });
  });
});
