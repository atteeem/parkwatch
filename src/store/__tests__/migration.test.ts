// v1 -> v2 migration, using a GENUINE v1 envelope captured from the v1 code
// (fixtures/v1-envelope.json): full seed + a user-submitted report driven
// through the officer flow to CHARGE_ISSUED + a requested withdrawal.

import { calculateBalances, getRewardState, MVP_DEFAULT_JURISDICTION_ID } from "../../domain";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../session";
import { deserializeState, PERSIST_KEY, PERSIST_VERSION } from "../persistence";
import { MIGRATION_SYSTEM_ACTOR, migrateV1toV2, V1State } from "../migrations";
import { createMemoryStorage } from "../persistence";
import { makeStore, snapshot } from "./helpers";
import v1Envelope from "./fixtures/v1-envelope.json";

const v1 = v1Envelope.state;
/** The v1 -> v2 step on its own (later steps are tested in migrationV3.test.ts). */
const migrate = () => ({ state: migrateV1toV2(v1 as unknown as V1State) });
/** The whole chain, as the app loads it. */
const load = () => {
  const r = deserializeState(JSON.stringify(v1Envelope));
  if (r.status !== "ok") throw new Error(`migration failed: ${JSON.stringify(r)}`);
  return r;
};

describe("v1 -> v2 migration", () => {
  it("the fixture really is v1 and loads through the whole migration chain", () => {
    expect(v1Envelope.version).toBe(1);
    expect(PERSIST_VERSION).toBe(5);
    expect(load().migratedFrom).toBe(1);
  });

  it("keeps every record, id and link", () => {
    const s = migrate().state;
    expect(s.reports.map((r) => r.id)).toEqual(v1.reports.map((r) => r.id));
    expect(s.cases.map((c) => [c.id, c.reportId])).toEqual(v1.cases.map((c) => [c.id, c.reportId]));
    expect(s.reports.map((r) => r.caseId)).toEqual(v1.reports.map((r) => r.caseId));
    expect(Object.keys(s.inspections)).toEqual(Object.keys(v1.inspections));
    expect(s.ledger).toEqual(v1.ledger);
    expect(s.notifications).toEqual(v1.notifications);
    expect([s.seq, s.nextReportNumber]).toEqual([v1.seq, v1.nextReportNumber]);
  });

  it("keeps every existing field value unchanged (only adds/upgrades the new ones)", () => {
    const s = migrate().state;
    v1.reports.forEach((old, i) => {
      const { vehicle, evidence, events, jurisdictionId, ...rest } = s.reports[i];
      const { vehicle: oldVehicle, evidence: oldEvidence, ...oldRest } = old as typeof old & { vehicle?: { plate: string } };
      expect(rest).toEqual(oldRest);
      expect(vehicle?.plate.raw).toBe(oldVehicle?.plate);
      expect(evidence.map(({ captureSource, ...e }) => e)).toEqual(oldEvidence);
    });
    v1.cases.forEach((old, i) => {
      const c = s.cases[i];
      expect({ ...c, events: undefined, jurisdictionId: undefined }).toEqual({ ...old, events: undefined, jurisdictionId: undefined });
      expect(c.events.map((e) => [e.type, e.at, e.from, e.to])).toEqual(old.events.map((e) => [e.type, e.at, (e as { from?: string }).from, e.to]));
    });
  });

  it("preserves balances, withdrawals and reward states exactly", () => {
    const s = migrate().state;
    const before = calculateBalances(v1.ledger as never, DEV_CITIZEN_ID);
    expect(calculateBalances(s.ledger, DEV_CITIZEN_ID)).toEqual(before);
    expect(before.withdrawalsInFlightCents).toBe(1000); // the v1 user's requested €10 withdrawal survives
    for (const r of s.reports) expect(getRewardState(s.ledger, r.id)).toBe(getRewardState(v1.ledger as never, r.id));
  });

  it("adds jurisdiction, plate value objects and capture sources deterministically", () => {
    const s = migrate().state;
    expect(s.reports.every((r) => r.jurisdictionId === MVP_DEFAULT_JURISDICTION_ID)).toBe(true);
    expect(s.cases.every((c) => c.jurisdictionId === MVP_DEFAULT_JURISDICTION_ID)).toBe(true);

    const ghc = s.reports.find((r) => r.id === "12564")!;
    expect(ghc.vehicle?.plate).toEqual({ raw: "GHC-789", normalized: "GHC789" }); // no invented country

    // seed images -> SEED; the user's real camera captures -> CAMERA
    expect(ghc.evidence.every((e) => e.captureSource === "SEED")).toBe(true);
    const user = s.reports.find((r) => r.id === "12600")!;
    expect(user.evidence.every((e) => e.captureSource === "CAMERA")).toBe(true);
    expect(Object.values(s.inspections["c-12600"].officerEvidence).every((e) => e?.captureSource === "CAMERA")).toBe(true);
    expect(Object.values(s.inspections["c-12484"].officerEvidence).every((e) => e?.captureSource === "SEED")).toBe(true);
  });

  it("reconstructs history honestly: source MIGRATION, real ids as actors, no fake server time", () => {
    const s = migrate().state;
    const user = s.reports.find((r) => r.id === "12600")!;
    expect(user.receivedAt).toBeUndefined();
    expect(user.incidentId).toBeUndefined();
    expect(user.events).toEqual([
      { type: "SUBMITTED", at: user.submittedAt, actor: { role: "CITIZEN", accountId: DEV_CITIZEN_ID }, source: "MIGRATION" },
      {
        type: "STATUS_RESOLVED",
        at: user.resolvedAt,
        actor: { role: "OFFICER", accountId: DEV_OFFICER_ID },
        source: "MIGRATION",
        from: "UNDER_REVIEW",
        to: "VERIFIED",
        outcomeCode: "CHARGE_ISSUED",
      },
    ]);
    // under-review reports get only SUBMITTED
    expect(s.reports.find((r) => r.id === "12564")!.events.map((e) => e.type)).toEqual(["SUBMITTED"]);

    const c = s.cases.find((x) => x.id === "c-12600")!;
    expect(c.events.every((e) => e.source === "MIGRATION")).toBe(true);
    expect(c.events[0].actor).toEqual({ role: "CITIZEN", accountId: DEV_CITIZEN_ID });
    expect(c.events.slice(1).every((e) => e.actor.role === "OFFICER" && e.actor.accountId === DEV_OFFICER_ID)).toBe(true);
    expect(s.cases.flatMap((x) => x.events).some((e) => "officerId" in e)).toBe(false);
    expect(s.cases.flatMap((x) => x.events).every((e) => e.actor.accountId !== MIGRATION_SYSTEM_ACTOR.accountId)).toBe(true);
  });

  it("hydrating a stored v1 envelope migrates it, writes v2 back, and the app keeps working", async () => {
    const storage = createMemoryStorage({ [PERSIST_KEY]: JSON.stringify(v1Envelope) });
    const { store } = await makeStore({ storage, seed: () => { throw new Error("must not reseed"); } });
    await store.flush();
    expect(JSON.parse(storage.data[PERSIST_KEY]).version).toBe(PERSIST_VERSION);
    expect(snapshot(store).reports).toHaveLength(v1.reports.length);

    // a migrated in-progress case can still be driven forward
    const accept = store.acceptCase("c-12572", "officer-x");
    expect(accept.ok).toBe(true);
    const c = snapshot(store).cases.find((x) => x.id === "c-12572")!;
    expect(c.events.at(-1)).toMatchObject({ to: "EN_ROUTE", source: "USER_ACTION", actor: { role: "OFFICER", accountId: "officer-x" } });
  });

  it("future or unknown versions are still discarded, not mis-migrated", () => {
    expect(deserializeState(JSON.stringify({ ...v1Envelope, version: 3 })).status).toBe("discarded");
    expect(deserializeState(JSON.stringify({ ...v1Envelope, version: 0 })).status).toBe("discarded");
  });
});
