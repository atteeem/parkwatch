// Simulated parking through the store: persistence, reload, reset and the
// v3 -> v4 migration (which must not lose any existing ParkWatch data).

import { activeParkingSession, calculateBalances } from "../../domain";
import { deserializeState, PERSIST_KEY, PERSIST_VERSION, serializeState } from "../persistence";
import { migrateV3toV4, V3State } from "../migrations";
import { buildSeedState } from "../seed";
import { DEV_CITIZEN_ID } from "../session";
import { createMemoryStorage } from "../persistence";
import { CITIZEN, draft, expectOk, makeStore, NOW, snapshot, submitAndInspect } from "./helpers";

describe("vehicles and parking through the store", () => {
  it("add vehicle -> start -> extend -> end; history and no active session afterwards", async () => {
    const { store, advance } = await makeStore();
    expect(store.startParking(CITIZEN, "veh-x", "B2", 60).ok).toBe(false); // no vehicle yet

    const { vehicleId } = expectOk(store.addVehicle(CITIZEN, { plate: "ABC-123", make: "Volvo" }));
    expect(store.addVehicle(CITIZEN, { plate: "abc 123" })).toMatchObject({ ok: false, error: { code: "DUPLICATE_VEHICLE" } });
    expect(snapshot(store).vehicles).toHaveLength(1);

    expectOk(store.startParking(CITIZEN, vehicleId, "B2", 60));
    expect(store.startParking(CITIZEN, vehicleId, "A1", 30)).toMatchObject({ ok: false, error: { code: "PARKING_ALREADY_ACTIVE" } });

    advance(20 * 60_000);
    expectOk(store.extendParking(CITIZEN, 30));
    const active = activeParkingSession(snapshot(store).parkingSessions, CITIZEN)!;
    expect(Date.parse(active.plannedEndAt) - Date.parse(active.startedAt)).toBe(90 * 60_000);

    advance(25 * 60_000);
    expectOk(store.endParking(CITIZEN));
    const s = snapshot(store);
    expect(activeParkingSession(s.parkingSessions, CITIZEN)).toBeUndefined();
    expect(s.parkingSessions).toHaveLength(1);
    expect(s.parkingSessions[0]).toMatchObject({ status: "COMPLETED", finalCostCents: 150, vehicleId });
    expect(store.endParking(CITIZEN).ok).toBe(false);
  });

  it("vehicles, the active session and history survive a reload", async () => {
    const storage = createMemoryStorage();
    const first = await makeStore({ storage });
    const { vehicleId } = expectOk(first.store.addVehicle(CITIZEN, { plate: "XYZ-9" }));
    expectOk(first.store.startParking(CITIZEN, vehicleId, "C4", 45));
    first.advance(10 * 60_000);
    expectOk(first.store.endParking(CITIZEN));
    expectOk(first.store.startParking(CITIZEN, vehicleId, "A1", 120));
    await first.store.flush();
    const before = snapshot(first.store);

    const second = await makeStore({ storage });
    const after = snapshot(second.store);
    expect(after.vehicles).toEqual(before.vehicles);
    expect(after.parkingSessions).toEqual(before.parkingSessions);
    expect(activeParkingSession(after.parkingSessions, CITIZEN)?.plannedEndAt).toBe(activeParkingSession(before.parkingSessions, CITIZEN)?.plannedEndAt);
    expect(JSON.parse(storage.data[PERSIST_KEY]).version).toBe(PERSIST_VERSION);
  });

  it("reset restores the known demo parking state (two vehicles, no session, no history)", async () => {
    const { store } = await makeStore({ seed: buildSeedState });
    const fresh = snapshot(store);
    expect(fresh.vehicles.map((v) => v.plate.raw)).toEqual(["JSK-306", "HOF-782"]);
    expect(fresh.parkingSessions).toEqual([]);
    expectOk(store.startParking(DEV_CITIZEN_ID, fresh.vehicles[0].id, "B2", 60));
    expectOk(store.addVehicle(DEV_CITIZEN_ID, { plate: "NEW-1" }));
    await store.resetToSeed();
    expect(snapshot(store).vehicles).toEqual(fresh.vehicles);
    expect(snapshot(store).parkingSessions).toEqual([]);
  });
});

describe("v3 -> v4 migration", () => {
  async function v3Envelope() {
    const { store } = await makeStore({ seed: buildSeedState });
    const { caseId } = submitAndInspect(store, "d1");
    expectOk(store.completeCase(caseId, "CHARGE_ISSUED", "officer-test"));
    expectOk(store.requestWithdrawal(DEV_CITIZEN_ID, 1000));
    const { vehicles: _v, parkingSessions: _p, ...v3 } = snapshot(store);
    const env = JSON.parse(serializeState(v3 as never, NOW.toISOString()));
    env.version = 3;
    return { env, v3: v3 as V3State };
  }

  it("adds the demo vehicles and no sessions; every existing record is unchanged", async () => {
    const { env, v3 } = await v3Envelope();
    const r = deserializeState(JSON.stringify(env));
    if (r.status !== "ok") throw new Error(JSON.stringify(r));
    expect(r.migratedFrom).toBe(3);
    const s = r.state;
    expect(s.reports).toEqual(v3.reports);
    expect(s.cases).toEqual(v3.cases);
    expect(s.inspections).toEqual(v3.inspections);
    expect(s.ledger).toEqual(v3.ledger);
    expect(s.notifications).toEqual(v3.notifications);
    expect(calculateBalances(s.ledger, DEV_CITIZEN_ID)).toEqual(calculateBalances(v3.ledger, DEV_CITIZEN_ID));
    expect(s.nextReportNumber).toBe(v3.nextReportNumber);
    expect(s.vehicles.map((v) => [v.plate.raw, v.plate.normalized, v.ownerId])).toEqual([
      ["JSK-306", "JSK306", DEV_CITIZEN_ID],
      ["HOF-782", "HOF782", DEV_CITIZEN_ID],
    ]);
    expect(s.parkingSessions).toEqual([]);
  });

  it("new vehicle ids come from the persisted counter, so later ids never collide", async () => {
    const { v3 } = await v3Envelope();
    const s = migrateV3toV4(v3, NOW.toISOString());
    expect(s.vehicles.map((v) => v.id)).toEqual([`veh-${v3.seq}`, `veh-${v3.seq + 1}`]);
    expect(s.seq).toBe(v3.seq + 2);
  });

  it("an unchanged citizen report draft path still works after migrating (store keeps going)", async () => {
    const { env } = await v3Envelope();
    const storage = createMemoryStorage({ [PERSIST_KEY]: JSON.stringify(env) });
    const { store } = await makeStore({ storage });
    expectOk(store.submitReport(draft("after-migration"), CITIZEN));
    const { vehicleId } = expectOk(store.addVehicle(DEV_CITIZEN_ID, { plate: "MIG-4" }));
    expect(snapshot(store).vehicles.find((v) => v.id === vehicleId)?.plate.raw).toBe("MIG-4");
  });
});
