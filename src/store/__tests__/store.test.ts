import { calculateBalances, EnforcementOutcomeCode, getRewardState } from "../../domain";
import { PERSIST_KEY, PERSIST_VERSION } from "../persistence";
import { CITIZEN, draft, expectOk, makeStore, OFFICER, snapshot, submitAndInspect } from "./helpers";

const citizenNotifications = (s: ReturnType<typeof snapshot>) =>
  s.notifications.filter((n) => n.recipient.role === "CITIZEN" && n.recipient.accountId === CITIZEN);

describe("report submission", () => {
  it("creates exactly one report, one linked case and one pending reward", async () => {
    const { store } = await makeStore();
    const { reportId, created } = expectOk(store.submitReport(draft("d1"), CITIZEN));
    const s = snapshot(store);

    expect(created).toBe(true);
    expect(s.reports).toHaveLength(1);
    expect(s.cases).toHaveLength(1);
    expect(s.reports[0]).toMatchObject({ id: reportId, status: "UNDER_REVIEW", caseId: `c-${reportId}` });
    expect(s.cases[0]).toMatchObject({ id: `c-${reportId}`, reportId, status: "NEW" });
    expect(s.ledger.map((e) => [e.type, e.reportId, e.amountCents])).toEqual([["REWARD_PENDING", reportId, 500]]);
    expect(citizenNotifications(s).map((n) => n.type)).toEqual(["REPORT_UNDER_REVIEW"]);
    expect(s.reports[0].vehicle?.source).toBe("MOCK_DETECTED");
  });

  it("a repeated submit of the same draft creates nothing new", async () => {
    const { store } = await makeStore();
    const first = expectOk(store.submitReport(draft("d1"), CITIZEN));
    const second = expectOk(store.submitReport(draft("d1"), CITIZEN));
    const s = snapshot(store);

    expect(second).toEqual({ reportId: first.reportId, created: false });
    expect(s.reports).toHaveLength(1);
    expect(s.cases).toHaveLength(1);
    expect(s.ledger).toHaveLength(1);
    expect(citizenNotifications(s)).toHaveLength(1);
  });

  it("different drafts get different, sequential report ids", async () => {
    const { store } = await makeStore();
    const a = expectOk(store.submitReport(draft("d1"), CITIZEN));
    const b = expectOk(store.submitReport(draft("d2"), CITIZEN));
    expect([a.reportId, b.reportId]).toEqual(["12600", "12601"]);
  });

  it("an invalid draft is refused and nothing is stored", async () => {
    const { store } = await makeStore();
    const r = store.submitReport({ ...draft("d1"), location: { address: " " } }, CITIZEN);
    expect(r.ok).toBe(false);
    expect(snapshot(store).reports).toHaveLength(0);
  });
});

describe("case flow", () => {
  it("follows NEW -> ASSIGNED -> EN_ROUTE -> INSPECTION -> COMPLETED with every status recorded", async () => {
    const { store, advance } = await makeStore();
    const { reportId } = expectOk(store.submitReport(draft("d1"), CITIZEN));
    const caseId = `c-${reportId}`;

    advance(60_000);
    expectOk(store.acceptCase(caseId, OFFICER));
    expect(snapshot(store).cases[0].status).toBe("EN_ROUTE");

    advance(60_000);
    expectOk(store.startInspection(caseId, OFFICER));
    expect(snapshot(store).cases[0].status).toBe("INSPECTION");

    for (const key of ["vehiclePresent", "plateMatches", "violationConfirmed", "restrictionVerified"] as const) {
      expectOk(store.updateChecklist(caseId, key, true));
    }
    for (const type of ["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"] as const) {
      expectOk(store.attachOfficerPhoto(caseId, type, `file:///${type}.jpg`, "CAMERA"));
    }
    advance(60_000);
    expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER));

    const c = snapshot(store).cases[0];
    expect(c.events.map((e) => e.to)).toEqual(["NEW", "ASSIGNED", "EN_ROUTE", "INSPECTION", "COMPLETED"]);
    expect(c.assignedOfficerId).toBe(OFFICER);
  });

  it("does not jump from NEW straight to INSPECTION", async () => {
    const { store } = await makeStore();
    const { reportId } = expectOk(store.submitReport(draft("d1"), CITIZEN));
    const r = store.startInspection(`c-${reportId}`, OFFICER);
    expect(r.ok).toBe(false);
    expect(snapshot(store).cases[0].status).toBe("NEW");
  });

  it("accepting a case twice is refused without changing it", async () => {
    const { store } = await makeStore();
    const { reportId } = expectOk(store.submitReport(draft("d1"), CITIZEN));
    expectOk(store.acceptCase(`c-${reportId}`, OFFICER));
    const before = snapshot(store);
    expect(store.acceptCase(`c-${reportId}`, OFFICER).ok).toBe(false);
    expect(snapshot(store)).toBe(before);
  });

  it("re-entering inspection keeps the existing inspection", async () => {
    const { store } = await makeStore();
    const { caseId } = submitAndInspect(store, "d1", { photos: true, checks: false });
    expectOk(store.startInspection(caseId, OFFICER));
    expect(Object.keys(snapshot(store).inspections[caseId].officerEvidence)).toHaveLength(4);
  });
});

describe("inspection isolation", () => {
  it("case A's photos and checklist never appear in case B", async () => {
    const { store } = await makeStore();
    const a = submitAndInspect(store, "dA");
    const b = submitAndInspect(store, "dB", { photos: false, checks: false });
    const s = snapshot(store);

    expect(Object.keys(s.inspections[a.caseId].officerEvidence)).toHaveLength(4);
    expect(s.inspections[a.caseId].checklist.vehiclePresent).toBe(true);
    expect(s.inspections[b.caseId].officerEvidence).toEqual({});
    expect(s.inspections[b.caseId].checklist.vehiclePresent).toBeNull();
    expect(s.inspections[a.caseId].caseId).toBe(a.caseId);
    expect(s.inspections[b.caseId].caseId).toBe(b.caseId);
  });

  it("officer photos are officer evidence; the citizen report's evidence is untouched", async () => {
    const { store } = await makeStore();
    const { caseId, reportId } = submitAndInspect(store, "d1");
    const s = snapshot(store);
    expect(Object.values(s.inspections[caseId].officerEvidence).every((e) => e?.source === "OFFICER")).toBe(true);
    const report = s.reports.find((r) => r.id === reportId)!;
    expect(report.evidence.every((e) => e.source === "CITIZEN")).toBe(true);
    expect(report.evidence).toHaveLength(3);
  });
});

describe("outcomes through the store", () => {
  it("CHARGE_ISSUED: completed, outcome stored, VERIFIED, €5 pending -> €5 available, verified notification once", async () => {
    const { store } = await makeStore();
    const { caseId, reportId } = submitAndInspect(store, "d1");
    expect(calculateBalances(snapshot(store).ledger, CITIZEN)).toMatchObject({ pendingCents: 500, availableCents: 0 });

    expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER, "Confirmed on site"));
    const again = expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER));
    const s = snapshot(store);

    expect(again.changed).toBe(false);
    const c = s.cases.find((x) => x.id === caseId)!;
    expect(c.status).toBe("COMPLETED");
    expect(c.outcome).toMatchObject({ code: "CHARGE_ISSUED", chargeAmountCents: 6000, notes: "Confirmed on site" });
    expect(s.inspections[caseId]).toMatchObject({ notes: "Confirmed on site", completedAt: c.completedAt });
    expect(s.reports.find((r) => r.id === reportId)!.status).toBe("VERIFIED");
    expect(calculateBalances(s.ledger, CITIZEN)).toMatchObject({ pendingCents: 0, availableCents: 500 });
    expect(citizenNotifications(s).filter((n) => n.type === "REPORT_VERIFIED")).toHaveLength(1);
  });

  it("REPORT_REJECTED: completed, REJECTED, pending cancelled, nothing available, rejection notification once", async () => {
    const { store } = await makeStore();
    const { caseId, reportId } = submitAndInspect(store, "d1");
    expectOk(store.completeCase(caseId, "REPORT_REJECTED", OFFICER));
    expectOk(store.completeCase(caseId, "REPORT_REJECTED", OFFICER));
    const s = snapshot(store);

    expect(s.cases.find((x) => x.id === caseId)!.outcome?.code).toBe("REPORT_REJECTED");
    expect(s.reports.find((r) => r.id === reportId)!.status).toBe("REJECTED");
    expect(getRewardState(s.ledger, reportId)).toBe("VOID");
    expect(calculateBalances(s.ledger, CITIZEN)).toMatchObject({ pendingCents: 0, availableCents: 0 });
    expect(citizenNotifications(s).filter((n) => n.type === "REPORT_REJECTED")).toHaveLength(1);
  });

  it.each<EnforcementOutcomeCode>(["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"])(
    "%s: completed with exact outcome, citizen status unchanged, pending cancelled, no citizen outcome notification",
    async (code) => {
      const { store } = await makeStore();
      const { caseId, reportId } = submitAndInspect(store, "d1");
      expectOk(store.completeCase(caseId, code, OFFICER));
      const s = snapshot(store);

      const c = s.cases.find((x) => x.id === caseId)!;
      expect(c.status).toBe("COMPLETED");
      expect(c.outcome?.code).toBe(code);
      expect(s.reports.find((r) => r.id === reportId)!.status).toBe("UNDER_REVIEW");
      expect(getRewardState(s.ledger, reportId)).toBe("VOID");
      expect(calculateBalances(s.ledger, CITIZEN)).toMatchObject({ pendingCents: 0, availableCents: 0 });
      expect(citizenNotifications(s).map((n) => n.type)).toEqual(["REPORT_UNDER_REVIEW"]);
    }
  );

  it("a charge is refused while the inspection is incomplete", async () => {
    const { store } = await makeStore();
    const { caseId } = submitAndInspect(store, "d1", { photos: false, checks: true });
    const r = store.completeCase(caseId, "CHARGE_ISSUED", OFFICER);
    expect(r.ok).toBe(false);
    expect(snapshot(store).cases.find((x) => x.id === caseId)!.status).toBe("INSPECTION");
  });
});

describe("persistence", () => {
  it("saves and hydrates reports, cases, inspections, ledger and notifications intact", async () => {
    const { store, storage } = await makeStore();
    const a = submitAndInspect(store, "dA");
    expectOk(store.completeCase(a.caseId, "CHARGE_ISSUED", OFFICER));
    submitAndInspect(store, "dB", { photos: true, checks: false });
    await store.flush();
    const saved = snapshot(store);

    const { store: reloaded } = await makeStore({ storage, seed: () => { throw new Error("should not reseed"); } });
    const s = snapshot(reloaded);
    expect(s).toEqual(saved);
    expect(s.cases.every((c) => s.reports.some((r) => r.id === c.reportId && r.caseId === c.id))).toBe(true);
    expect(calculateBalances(s.ledger, CITIZEN)).toEqual(calculateBalances(saved.ledger, CITIZEN));
  });

  it("ids keep counting after reload (no collisions)", async () => {
    const { store, storage } = await makeStore();
    expectOk(store.submitReport(draft("d1"), CITIZEN));
    await store.flush();
    const { store: reloaded } = await makeStore({ storage });
    expect(expectOk(reloaded.submitReport(draft("d2"), CITIZEN)).reportId).toBe("12601");
  });

  it("stores a versioned envelope", async () => {
    const { store, storage } = await makeStore();
    expectOk(store.submitReport(draft("d1"), CITIZEN));
    await store.flush();
    const envelope = JSON.parse(storage.data[PERSIST_KEY]);
    expect(envelope.version).toBe(PERSIST_VERSION);
    expect(typeof envelope.savedAt).toBe("string");
    expect(envelope.state.reports).toHaveLength(1);
  });

  it("corrupt or unknown-version data is discarded and reseeded", async () => {
    for (const raw of ["{not json", JSON.stringify({ version: 99, state: {} })]) {
      const { storage } = await makeStore();
      storage.data[PERSIST_KEY] = raw;
      const { store } = await makeStore({ storage });
      expect(snapshot(store).reports).toEqual([]);
      // the unusable payload was replaced by a valid current-version envelope
      expect(JSON.parse(storage.data[PERSIST_KEY]).version).toBe(PERSIST_VERSION);
    }
  });

  it("dev reset wipes persisted state back to seed", async () => {
    const { store, storage } = await makeStore();
    expectOk(store.submitReport(draft("d1"), CITIZEN));
    await store.resetToSeed();
    expect(snapshot(store).reports).toEqual([]);
    expect(JSON.parse(storage.data[PERSIST_KEY]).state.reports).toEqual([]);
  });
});

describe("withdrawal", () => {
  async function storeWithAvailable(euros: number) {
    const ctx = await makeStore();
    for (let i = 0; i < euros / 5; i++) {
      const { caseId } = submitAndInspect(ctx.store, `d${i}`);
      expectOk(ctx.store.completeCase(caseId, "CHARGE_ISSUED", OFFICER));
    }
    return ctx;
  }

  it("requesting a withdrawal reduces the available balance", async () => {
    const { store } = await storeWithAvailable(15);
    expectOk(store.requestWithdrawal(CITIZEN, 1000));
    expect(calculateBalances(snapshot(store).ledger, CITIZEN)).toMatchObject({ availableCents: 500, paidOutCents: 0 });
    expect(store.requestWithdrawal(CITIZEN, 1000).ok).toBe(false);
  });

  it("rehydration does not restore already-spent available funds", async () => {
    const { store, storage } = await storeWithAvailable(15);
    expectOk(store.requestWithdrawal(CITIZEN, 1000));
    await store.flush();
    const { store: reloaded } = await makeStore({ storage });
    expect(calculateBalances(snapshot(reloaded).ledger, CITIZEN).availableCents).toBe(500);
    expect(reloaded.requestWithdrawal(CITIZEN, 1000).ok).toBe(false);
  });
});
