import {
  activeParkingSession,
  addVehicle,
  DEMO_PARKING_HOURLY_RATE_CENTS,
  endParking,
  estimateParkingCostCents,
  extendParking,
  ParkingSession,
  parkingCostCents,
  startParking,
  Vehicle,
} from "../index";
import { unwrap, errorCode } from "./testHelpers";

const OWNER = "citizen-1";
const T0 = "2026-10-04T10:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

const car = (id = "veh-1", plate = "ABC-123"): Vehicle => unwrap(addVehicle([], { plate, make: "Volvo", model: "XC60" }, { id, ownerId: OWNER, at: T0 }));

function started(minutes = 60, vehicles = [car()], sessions: ParkingSession[] = []) {
  return unwrap(startParking(sessions, vehicles, { vehicleId: vehicles[0].id, zoneId: "B2", durationMinutes: minutes }, { id: "park-1", ownerId: OWNER, at: T0 }));
}

describe("vehicles", () => {
  it("adds a vehicle with a normalized FI plate and trimmed optional fields", () => {
    const v = unwrap(addVehicle([], { plate: " abc-123 ", make: " Volvo ", model: "", color: "Black" }, { id: "veh-1", ownerId: OWNER, at: T0 }));
    expect(v).toEqual({
      id: "veh-1",
      ownerId: OWNER,
      plate: { raw: "ABC-123", normalized: "ABC123", country: "FI" },
      make: "Volvo",
      model: undefined,
      color: "Black",
      createdAt: T0,
    });
  });

  it("a blank plate is refused", () => {
    expect(errorCode(addVehicle([], { plate: "  - " }, { id: "v", ownerId: OWNER, at: T0 }))).toBe("INVALID_PLATE");
  });

  it("the same normalized plate cannot be added twice (ABC-123 == abc 123)", () => {
    const first = car();
    expect(errorCode(addVehicle([first], { plate: "abc 123" }, { id: "veh-2", ownerId: OWNER, at: T0 }))).toBe("DUPLICATE_VEHICLE");
    // another owner may register the same plate
    expect(addVehicle([first], { plate: "abc 123" }, { id: "veh-2", ownerId: "someone-else", at: T0 }).ok).toBe(true);
  });
});

describe("start parking", () => {
  it.each([
    [30, "2026-10-04T10:30:00.000Z"],
    [60, "2026-10-04T11:00:00.000Z"],
    [120, "2026-10-04T12:00:00.000Z"],
    [180, "2026-10-04T13:00:00.000Z"],
    [240, "2026-10-04T14:00:00.000Z"],
    [95, "2026-10-04T11:35:00.000Z"], // custom
  ])("%i minutes ends at %s", (minutes, end) => {
    const s = started(minutes);
    expect(s).toMatchObject({ status: "ACTIVE", startedAt: T0, plannedEndAt: end, zoneId: "B2", plate: { raw: "ABC-123" }, provider: "SIMULATED" });
    expect(s.hourlyRateCents).toBe(DEMO_PARKING_HOURLY_RATE_CENTS);
  });

  it("cannot start without a (own) vehicle", () => {
    const r = startParking([], [], { vehicleId: "veh-1", zoneId: "B2", durationMinutes: 60 }, { id: "p", ownerId: OWNER, at: T0 });
    expect(errorCode(r)).toBe("NOT_FOUND");
    const theirs = unwrap(addVehicle([], { plate: "XYZ-1" }, { id: "veh-9", ownerId: "other", at: T0 }));
    expect(errorCode(startParking([], [theirs], { vehicleId: "veh-9", zoneId: "B2", durationMinutes: 60 }, { id: "p", ownerId: OWNER, at: T0 }))).toBe("NOT_FOUND");
  });

  it("refuses invalid durations and unknown zones", () => {
    const v = [car()];
    for (const d of [0, -30, 1.5, 24 * 60 + 1]) {
      expect(errorCode(startParking([], v, { vehicleId: "veh-1", zoneId: "B2", durationMinutes: d }, { id: "p", ownerId: OWNER, at: T0 }))).toBe("INVALID_DURATION");
    }
    expect(errorCode(startParking([], v, { vehicleId: "veh-1", zoneId: "ZZ", durationMinutes: 60 }, { id: "p", ownerId: OWNER, at: T0 }))).toBe("NOT_FOUND");
  });

  it("a second active session is refused (never overwritten)", () => {
    const first = started();
    const r = startParking([first], [car()], { vehicleId: "veh-1", zoneId: "A1", durationMinutes: 30 }, { id: "park-2", ownerId: OWNER, at: at(5) });
    expect(errorCode(r)).toBe("PARKING_ALREADY_ACTIVE");
    expect(activeParkingSession([first], OWNER)?.id).toBe("park-1");
  });
});

describe("extend / end", () => {
  it("extension adds to the planned end", () => {
    const s = unwrap(extendParking(started(60), 30, at(20)));
    expect(s.plannedEndAt).toBe(at(90));
    expect(s.extensions).toEqual([{ at: at(20), addedMinutes: 30 }]);
  });

  it("extending an expired session counts from now", () => {
    expect(unwrap(extendParking(started(30), 15, at(45))).plannedEndAt).toBe(at(60));
  });

  it("ending completes the session with the actual parked time's demo cost", () => {
    const ended = unwrap(endParking(started(120), at(45)));
    expect(ended).toMatchObject({ status: "COMPLETED", endedAt: at(45), finalCostCents: 150 }); // 0.75 h x €2.00
    expect(activeParkingSession([ended], OWNER)).toBeUndefined();
    expect(errorCode(endParking(ended, at(50)))).toBe("NO_ACTIVE_PARKING");
    expect(errorCode(extendParking(ended, 30, at(50)))).toBe("NO_ACTIVE_PARKING");
  });

  it("cost = duration x demo rate", () => {
    expect(estimateParkingCostCents(90)).toBe(300);
    expect(parkingCostCents(200, T0, at(30))).toBe(100);
    expect(parkingCostCents(200, T0, at(-5))).toBe(0);
  });
});
