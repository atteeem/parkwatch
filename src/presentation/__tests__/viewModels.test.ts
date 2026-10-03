import { buildSeedState } from "../../store/seed";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../../store/session";
import { expectOk, makeStore, OFFICER, snapshot, submitAndInspect } from "../../store/__tests__/helpers";
import {
  selectCitizenReports,
  selectNotifications,
  selectOfficerCases,
  selectWallet,
  toInspectionView,
} from "../viewModels";

const now = new Date("2026-07-17T18:00:00.000Z");
const seed = buildSeedState(now);

describe("view models for the existing screens", () => {
  it("citizen reports use legacy statuses, euros and reward states", () => {
    const reports = selectCitizenReports(seed, DEV_CITIZEN_ID);
    const byId = Object.fromEntries(reports.map((r) => [r.id, r]));
    expect(reports[0].id).toBe("12564"); // newest first
    expect(byId["12564"]).toMatchObject({ status: "under-review", reward: 5, rewardState: "estimated", plate: "GHC-789", vehicle: "Volvo XC60" });
    expect(byId["12556"]).toMatchObject({ status: "verified", reward: 5, rewardState: "rewarded" });
    expect(byId["12499"]).toMatchObject({ status: "rejected", rewardState: "none" });
    expect(reports.every((r) => r.images.length === 3)).toBe(true);
  });

  it("wallet comes from the ledger", () => {
    expect(selectWallet(seed, DEV_CITIZEN_ID)).toEqual({ available: 45, pending: 10, paidOut: 55 });
  });

  it("officer cases carry legacy status, km distance, labels, relative time and charge in euros", () => {
    const cases = selectOfficerCases(seed, now);
    const first = cases[0];
    expect(first).toMatchObject({ id: "c-12564", status: "new", priority: "high", violation: "No parking zone", reportedAgo: "5 min ago", reporterName: "Mika S." });
    // No mock distance on the view: distance is computed from real GPS on screen.
    expect(first).not.toHaveProperty("distance");
    expect(first.coordinates).toBeDefined();
    expect(first.photoCount).toBeGreaterThan(0);
    expect(cases.find((c) => c.id === "c-12484")).toMatchObject({ status: "completed", chargeAmount: 60, outcomeCode: "CHARGE_ISSUED" });
    expect(cases.find((c) => c.id === "c-12568")?.status).toBe("en-route");
  });

  it("inspection view maps slots and checklist keys", () => {
    const v = toInspectionView("c-12484", seed.inspections["c-12484"]);
    expect(Object.keys(v.officerPhotos).sort()).toEqual(["context", "overview", "plate", "sign"]);
    expect(v).toMatchObject({ plateMatched: true, result: "charge" });
    expect(toInspectionView("c-none", undefined)).toMatchObject({ vehiclePresent: null, officerPhotos: {} });
  });

  it("notifications are recipient-scoped, newest first, with formatted copy", () => {
    const citizen = selectNotifications(seed, { role: "CITIZEN", accountId: DEV_CITIZEN_ID }, now);
    expect(citizen[0]).toMatchObject({ title: "Report under review", group: "Today", unread: true, kind: "pending" });
    const verified = citizen.find((n) => n.title === "Report verified")!;
    expect(verified.body).toContain("+ €5.00 added to your balance");
    const officer = selectNotifications(seed, { role: "OFFICER", accountId: DEV_OFFICER_ID }, now);
    expect(officer.some((n) => n.title === "Parking Charge Issued" && n.body.includes("€60.00"))).toBe(true);
    expect(officer.every((n) => !n.title.startsWith("Report "))).toBe(true);
  });

  it("an unresolved outcome keeps the citizen report shown as under review with no reward", async () => {
    const { store } = await makeStore();
    const { caseId, reportId } = submitAndInspect(store, "d1");
    expectOk(store.completeCase(caseId, "VEHICLE_MOVED", OFFICER));
    const s = snapshot(store);
    const report = selectCitizenReports(s, "citizen-test").find((r) => r.id === reportId)!;
    expect(report).toMatchObject({ status: "under-review", rewardState: "none" });
    expect(selectOfficerCases(s, now).find((c) => c.id === caseId)).toMatchObject({ status: "completed", outcomeCode: "VEHICLE_MOVED", chargeAmount: undefined });
  });
});
