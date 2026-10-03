// Investor-demo golden path, end to end on the real demo seed, using the same
// draft reducer, store actions and view models the screens use:
// citizen submits -> officer accepts, inspects, issues a parking charge ->
// citizen sees the SAME report verified with the €5 reward available.

import { calculateBalances, getRewardState, MVP_MOCK_DETECTED_VEHICLE } from "../../domain";
import { draftReducer, newDraftState } from "../../presentation/reportDraft";
import { filterQueue, toCompletionSummary, withDistances } from "../../presentation/officerViews";
import {
  selectCitizenReports,
  selectNotifications,
  selectOfficerCases,
  toInspectionView,
} from "../../presentation/viewModels";
import { selectCitizenReportById } from "../../presentation/citizenViews";
import { buildSeedState } from "../seed";
import { violationLabel } from "../../data/types";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../session";
import { expectOk, makeStore, NOW, snapshot } from "./helpers";

const CITIZEN = DEV_CITIZEN_ID;
const OFFICER = DEV_OFFICER_ID;
const SPOT = { latitude: 60.1699, longitude: 24.9384, accuracyMeters: 6 };

/** The citizen wizard: 3 camera photos, violation, address + device GPS. */
function citizenDraft() {
  const at = new Date(NOW.getTime() - 60_000).toISOString();
  let s = newDraftState("demo-draft-1");
  for (const slot of ["FRONT", "SIDE", "REAR"] as const) {
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot, uri: `file:///demo-${slot}.jpg`, capturedAt: at });
  }
  s = draftReducer(s, { type: "SET_VIOLATION", violationId: "no-parking" });
  s = draftReducer(s, { type: "SET_LOCATION", address: "Mannerheimintie 45, Helsinki" });
  s = draftReducer(s, { type: "SET_COORDINATES", coordinates: SPOT });
  return s.draft;
}

const citizenNotifs = (state: ReturnType<typeof snapshot>, reportId: string) =>
  selectNotifications(state, { role: "CITIZEN", accountId: CITIZEN }, NOW).filter((n) =>
    state.notifications.some((d) => d.id === n.id && d.reportId === reportId)
  );

describe("investor demo golden path", () => {
  it("citizen -> officer -> citizen on the same report, with exactly one reward", async () => {
    const { store, advance } = await makeStore({ seed: buildSeedState });
    const start = snapshot(store);
    const balanceBefore = calculateBalances(start.ledger, CITIZEN);

    // --- CITIZEN: submit ---------------------------------------------------
    const draft = citizenDraft();
    const { reportId, created } = expectOk(store.submitReport(draft, CITIZEN));
    expect(created).toBe(true);
    const caseId = `c-${reportId}`;
    let s = snapshot(store);
    const report = s.reports.find((r) => r.id === reportId)!;
    expect(report.status).toBe("UNDER_REVIEW");
    expect(report.evidence.filter((e) => e.captureSource === "CAMERA").map((e) => e.type)).toEqual(["FRONT", "SIDE", "REAR"]);
    expect(report.location.coordinates).toMatchObject({ latitude: SPOT.latitude, longitude: SPOT.longitude });
    expect(report.vehicle?.plate.raw).toBe(MVP_MOCK_DETECTED_VEHICLE.plate.raw);
    expect(s.cases.find((c) => c.id === caseId)?.status).toBe("NEW");
    expect(getRewardState(s.ledger, reportId)).toBe("PENDING");
    expect(citizenNotifs(s, reportId).map((n) => n.title)).toEqual(["Report under review"]);
    // The submitted demo report is unique: no seeded report shares its plate.
    expect(s.reports.filter((r) => r.vehicle?.plate.raw === MVP_MOCK_DETECTED_VEHICLE.plate.raw)).toHaveLength(1);

    // Double submit of the same draft creates nothing.
    expect(expectOk(store.submitReport(draft, CITIZEN))).toEqual({ reportId, created: false });

    // --- OFFICER: same report in the queue --------------------------------
    const queued = filterQueue(withDistances(selectOfficerCases(s, NOW), SPOT), "New", OFFICER).find((c) => c.id === caseId)!;
    const citizenView = selectCitizenReportById(s, CITIZEN, reportId)!;
    expect(queued).toMatchObject({ reportId, plate: citizenView.plate, location: citizenView.location, violation: violationLabel(citizenView.violation) });
    expect(queued.distanceMeters).toBe(0);

    advance(60_000);
    expectOk(store.acceptCase(caseId, OFFICER));
    expect(snapshot(store).cases.find((c) => c.id === caseId)?.status).toBe("EN_ROUTE");
    expect(store.acceptCase(caseId, OFFICER).ok).toBe(false); // no double accept

    advance(5 * 60_000);
    expectOk(store.startInspection(caseId, OFFICER));
    expect(snapshot(store).cases.find((c) => c.id === caseId)?.status).toBe("INSPECTION");
    expect(toInspectionView(caseId, snapshot(store).inspections[caseId]).hasActivity).toBe(false);

    for (const key of ["vehiclePresent", "violationConfirmed", "restrictionVerified"] as const) {
      expectOk(store.updateChecklist(caseId, key, true));
    }
    expectOk(store.confirmPlateBySimulatedScan(caseId));
    for (const type of ["VEHICLE_OVERVIEW", "LICENSE_PLATE", "PARKING_SIGN", "VIOLATION_CONTEXT"] as const) {
      expectOk(store.attachOfficerPhoto(caseId, type, `file:///officer-${type}.jpg`, "CAMERA"));
    }
    expect(toInspectionView(caseId, snapshot(store).inspections[caseId])).toMatchObject({ readyForCharge: true, photosCaptured: 4 });

    advance(60_000);
    expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER, "Demo: clear violation"));
    expect(expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER))).toMatchObject({ changed: false });

    s = snapshot(store);
    const done = s.cases.find((c) => c.id === caseId)!;
    expect(done).toMatchObject({ status: "COMPLETED", outcome: { code: "CHARGE_ISSUED", chargeAmountCents: 6000 } });
    const inspection = s.inspections[caseId];
    expect(Object.values(inspection.officerEvidence).map((e) => e!.captureSource)).toEqual(["CAMERA", "CAMERA", "CAMERA", "CAMERA"]);
    const summary = toCompletionSummary(selectOfficerCases(s, NOW).find((c) => c.id === caseId)!, toInspectionView(caseId, inspection));
    expect(summary).toMatchObject({ reportId, plate: citizenView.plate, chargeText: "€60.00", photosText: "4 / 4" });

    // --- CITIZEN again ------------------------------------------------------
    const mine = selectCitizenReports(s, CITIZEN).find((r) => r.id === reportId)!;
    expect(mine).toMatchObject({ status: "verified", rewardState: "rewarded", reward: 5, plate: citizenView.plate });
    expect(getRewardState(s.ledger, reportId)).toBe("AVAILABLE");
    const verified = citizenNotifs(s, reportId).filter((n) => n.title === "Report verified");
    expect(verified).toHaveLength(1);
    expect(verified[0].body).toContain("parking charge");
    const balanceAfter = calculateBalances(s.ledger, CITIZEN);
    expect(balanceAfter.availableCents - balanceBefore.availableCents).toBe(500);
    expect(s.ledger.filter((e) => e.reportId === reportId).map((e) => e.type)).toEqual(["REWARD_PENDING", "REWARD_RELEASED"]);
  });

  it("running the officer side twice never pays twice or changes the outcome", async () => {
    const { store } = await makeStore({ seed: buildSeedState });
    const { reportId } = expectOk(store.submitReport(citizenDraft(), CITIZEN));
    const caseId = `c-${reportId}`;
    const runOfficer = () => {
      store.acceptCase(caseId, OFFICER);
      store.startInspection(caseId, OFFICER);
      for (const key of ["vehiclePresent", "plateMatches", "violationConfirmed", "restrictionVerified"] as const) store.updateChecklist(caseId, key, true);
      for (const type of ["VEHICLE_OVERVIEW", "LICENSE_PLATE", "PARKING_SIGN", "VIOLATION_CONTEXT"] as const) {
        store.attachOfficerPhoto(caseId, type, `file:///${type}.jpg`, "CAMERA");
      }
      return store.completeCase(caseId, "CHARGE_ISSUED", OFFICER);
    };
    expectOk(runOfficer());
    const after1 = snapshot(store);
    runOfficer();
    expect(store.completeCase(caseId, "REPORT_REJECTED", OFFICER).ok).toBe(false);
    const after2 = snapshot(store);
    expect(after2.ledger).toEqual(after1.ledger);
    expect(after2.notifications).toEqual(after1.notifications);
    expect(after2.reports).toEqual(after1.reports);
    expect(after2.cases.find((c) => c.id === caseId)?.outcome?.code).toBe("CHARGE_ISSUED");
  });

  it("reset gives the same deterministic demo start every time", async () => {
    const { store } = await makeStore({ seed: buildSeedState });
    const fresh = snapshot(store);
    expectOk(store.submitReport(citizenDraft(), CITIZEN));
    expectOk(store.requestWithdrawal(CITIZEN, 1000));
    await store.resetToSeed();
    const reset = snapshot(store);
    expect(reset).toEqual(fresh);
    expect(Object.values(reset.inspections).every((i) => Object.values(i.officerEvidence).every((e) => e!.captureSource === "SEED"))).toBe(true);
    expect(calculateBalances(reset.ledger, CITIZEN)).toMatchObject({ availableCents: 4500, withdrawalsInFlightCents: 0 });
    expect(reset.cases.map((c) => [c.id, c.status])).toEqual(fresh.cases.map((c) => [c.id, c.status]));
    expect(reset.nextReportNumber).toBe(fresh.nextReportNumber);
  });
});
