import { calculateBalances, getRewardState } from "../../domain";
import { selectCaseDetail, selectNotifications, toInspectionView } from "../../presentation/viewModels";
import { CITIZEN, draft, expectOk, makeStore, NOW, OFFICER, snapshot, submitAndInspect } from "./helpers";

const OTHER_OFFICER = "officer-other";

async function submitted() {
  const env = await makeStore();
  const { reportId } = expectOk(env.store.submitReport(draft("d1"), CITIZEN));
  return { ...env, reportId, caseId: `c-${reportId}` };
}

const citizenNotifs = (s: ReturnType<typeof snapshot>) =>
  s.notifications.filter((n) => n.recipient.role === "CITIZEN" && n.recipient.accountId === CITIZEN);

describe("desk decisions (OFF-04 Reject / Mark as Duplicate)", () => {
  it("REPORT_REJECTED from NEW completes the case without an inspection", async () => {
    const { store, caseId, reportId } = await submitted();
    expectOk(store.completeCase(caseId, "REPORT_REJECTED", OFFICER));
    const s = snapshot(store);
    expect(s.cases[0]).toMatchObject({ status: "COMPLETED", outcome: { code: "REPORT_REJECTED" } });
    expect(s.inspections[caseId]).toBeUndefined();
    expect(s.reports[0].status).toBe("REJECTED");
    expect(getRewardState(s.ledger, reportId)).toBe("VOID");
    expect(citizenNotifs(s).map((n) => n.type)).toEqual(["REPORT_UNDER_REVIEW", "REPORT_REJECTED"]);
  });

  it("DUPLICATE from NEW: completed, citizen status unchanged, reward cancelled, no citizen notification", async () => {
    const { store, caseId, reportId } = await submitted();
    expectOk(store.completeCase(caseId, "DUPLICATE", OFFICER));
    const s = snapshot(store);
    expect(s.cases[0]).toMatchObject({ status: "COMPLETED", outcome: { code: "DUPLICATE" } });
    expect(s.reports[0].status).toBe("UNDER_REVIEW");
    expect(getRewardState(s.ledger, reportId)).toBe("VOID");
    expect(citizenNotifs(s).map((n) => n.type)).toEqual(["REPORT_UNDER_REVIEW"]);
  });

  it("a charge can never be issued from the desk", async () => {
    const { store, caseId } = await submitted();
    const r = store.completeCase(caseId, "CHARGE_ISSUED", OFFICER);
    expect(r.ok).toBe(false);
    expect(snapshot(store).cases[0].status).toBe("NEW");
  });

  it("VALID_PERMIT needs the officer on site (refused from NEW and EN_ROUTE)", async () => {
    const { store, caseId } = await submitted();
    expect(store.completeCase(caseId, "VALID_PERMIT", OFFICER).ok).toBe(false);
    expectOk(store.acceptCase(caseId, OFFICER));
    expect(store.completeCase(caseId, "VALID_PERMIT", OFFICER).ok).toBe(false);
    expect(snapshot(store).cases[0].status).toBe("EN_ROUTE");
  });
});

describe("en route (OFF-05)", () => {
  it("VEHICLE_MOVED from EN_ROUTE: status unchanged for the citizen, reward cancelled, no notification", async () => {
    const { store, caseId, reportId } = await submitted();
    expectOk(store.acceptCase(caseId, OFFICER));
    expectOk(store.completeCase(caseId, "VEHICLE_MOVED", OFFICER));
    const s = snapshot(store);
    expect(s.cases[0]).toMatchObject({ status: "COMPLETED", outcome: { code: "VEHICLE_MOVED" } });
    expect(s.reports[0].status).toBe("UNDER_REVIEW");
    expect(getRewardState(s.ledger, reportId)).toBe("VOID");
    expect(calculateBalances(s.ledger, CITIZEN).availableCents).toBe(0);
    expect(citizenNotifs(s)).toHaveLength(1);
  });

  it("start inspection moves EN_ROUTE -> INSPECTION and creates an empty inspection", async () => {
    const { store, caseId } = await submitted();
    expectOk(store.acceptCase(caseId, OFFICER));
    expectOk(store.startInspection(caseId, OFFICER));
    const s = snapshot(store);
    expect(s.cases[0].status).toBe("INSPECTION");
    expect(toInspectionView(caseId, s.inspections[caseId])).toMatchObject({ exists: true, checklistConfirmed: 0, photosCaptured: 0 });
  });
});

describe("ownership and double actions", () => {
  it("accept is refused the second time and nothing changes", async () => {
    const { store, caseId } = await submitted();
    expectOk(store.acceptCase(caseId, OFFICER));
    const before = snapshot(store);
    expect(store.acceptCase(caseId, OFFICER).ok).toBe(false);
    expect(snapshot(store).cases).toEqual(before.cases);
    expect(snapshot(store).notifications).toEqual(before.notifications);
  });

  it("another officer cannot act on a case that is assigned to someone else", async () => {
    const { store, caseId } = await submitted();
    expectOk(store.acceptCase(caseId, OFFICER));
    for (const r of [
      store.acceptCase(caseId, OTHER_OFFICER),
      store.startInspection(caseId, OTHER_OFFICER),
      store.completeCase(caseId, "REPORT_REJECTED", OTHER_OFFICER),
    ]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("CASE_TAKEN");
    }
    expect(snapshot(store).cases[0]).toMatchObject({ status: "EN_ROUTE", assignedOfficerId: OFFICER });
  });

  it("completing again is a no-op (same outcome) or refused (different outcome); ledger/notifications unchanged", async () => {
    const { store } = await makeStore();
    const { caseId } = submitAndInspect(store, "d1");
    expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER));
    const before = snapshot(store);
    expect(expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER))).toMatchObject({ changed: false });
    expect(store.completeCase(caseId, "REPORT_REJECTED", OFFICER).ok).toBe(false);
    expect(snapshot(store).ledger).toEqual(before.ledger);
    expect(snapshot(store).notifications).toEqual(before.notifications);
    expect(snapshot(store).cases[0].outcome?.code).toBe("CHARGE_ISSUED");
  });
});

describe("inspection (OFF-06 / OFF-07 / OFF-08)", () => {
  it("a charge needs all four checks AND all four photos; no-charge outcomes need neither", async () => {
    const { store } = await makeStore();
    const noPhotos = submitAndInspect(store, "d1", { photos: false, checks: true });
    expect(store.completeCase(noPhotos.caseId, "CHARGE_ISSUED", OFFICER).ok).toBe(false);
    expectOk(store.completeCase(noPhotos.caseId, "VALID_PERMIT", OFFICER));

    const noChecks = submitAndInspect(store, "d2", { photos: true, checks: false });
    expect(store.completeCase(noChecks.caseId, "CHARGE_ISSUED", OFFICER).ok).toBe(false);
    expectOk(store.completeCase(noChecks.caseId, "OTHER", OFFICER));
  });

  it("CHARGE_ISSUED stores the configured €60 and makes the €5 reward available", async () => {
    const { store } = await makeStore();
    const { caseId, reportId } = submitAndInspect(store, "d1");
    expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER, "Clear violation"));
    const s = snapshot(store);
    expect(s.cases[0].outcome).toMatchObject({ code: "CHARGE_ISSUED", chargeAmountCents: 6000, notes: "Clear violation" });
    expect(s.reports[0].status).toBe("VERIFIED");
    expect(getRewardState(s.ledger, reportId)).toBe("AVAILABLE");
    expect(calculateBalances(s.ledger, CITIZEN).availableCents).toBe(500);
    const verified = selectNotifications(s, { role: "CITIZEN", accountId: CITIZEN }, NOW).find((v) => v.title === "Report verified")!;
    expect(verified.body).toContain("a parking charge has been issued");
    expect(verified.body).not.toMatch(/fine/i);
  });

  it("an officer photo goes only into the requested slot of the requested case, as CAMERA with its capture time", async () => {
    const { store } = await makeStore();
    const a = submitAndInspect(store, "a", { photos: false, checks: false });
    const b = submitAndInspect(store, "b", { photos: false, checks: false });
    const takenAt = new Date(NOW.getTime() - 5_000).toISOString();
    expectOk(store.attachOfficerPhoto(a.caseId, "PARKING_SIGN", "file:///sign.jpg", "CAMERA", takenAt));
    const s = snapshot(store);
    const sign = s.inspections[a.caseId].officerEvidence.PARKING_SIGN;
    expect(sign).toMatchObject({ uri: "file:///sign.jpg", captureSource: "CAMERA", capturedAt: takenAt });
    expect(Object.keys(s.inspections[a.caseId].officerEvidence)).toEqual(["PARKING_SIGN"]);
    expect(s.inspections[b.caseId].officerEvidence).toEqual({});
  });

  it("a photo for a case without an inspection is refused and stores nothing", async () => {
    const { store, caseId } = await submitted();
    const r = store.attachOfficerPhoto(caseId, "LICENSE_PLATE", "file:///x.jpg", "CAMERA");
    expect(r.ok).toBe(false);
    expect(snapshot(store).inspections).toEqual({});
  });

  it("the simulated scan only confirms the plate check (no recognised plate, no confidence)", async () => {
    const { store } = await makeStore();
    const { caseId } = submitAndInspect(store, "d1", { photos: false, checks: false });
    expectOk(store.confirmPlateBySimulatedScan(caseId));
    const s = snapshot(store);
    const view = toInspectionView(caseId, s.inspections[caseId]);
    expect(view).toMatchObject({ plateMatched: true, plateConfirmedBySimulatedScan: true, checklistConfirmed: 1 });
    expect(JSON.stringify(s.inspections[caseId])).not.toMatch(/confidence|ocr/i);
    expect(s.reports[0].vehicle?.plate).toEqual(snapshot(store).reports[0].vehicle?.plate);
  });
});

describe("direct opening never mutates", () => {
  it("reading case details / inspection views leaves state identical", async () => {
    const { store, caseId } = await submitted();
    const before = snapshot(store);
    expect(selectCaseDetail(before, caseId, NOW)?.case.id).toBe(caseId);
    expect(selectCaseDetail(before, "c-unknown", NOW)).toBeUndefined();
    expect(toInspectionView(caseId, before.inspections[caseId]).exists).toBe(false);
    expect(snapshot(store)).toBe(before);
  });
});
