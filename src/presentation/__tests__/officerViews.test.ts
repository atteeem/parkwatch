import { OfficerCase } from "../../data/types";
import {
  canDecideAtDesk,
  caseChip,
  casesStats,
  filterCasesTab,
  filterQueue,
  myCases,
  officerHomeSummary,
  primaryCaseAction,
  queueEmptyMessage,
  queueSummary,
  sortQueue,
  systemChecks,
  toCompletionSummary,
  withDistances,
} from "../officerViews";
import { InspectionView } from "../viewModels";

const ME = "officer-me";
const OTHER = "officer-other";
const HERE = { latitude: 60.1699, longitude: 24.9384 };
/** ~111 m north per 0.001 deg latitude. */
const north = (deg: number) => ({ latitude: HERE.latitude + deg, longitude: HERE.longitude });

let n = 0;
function oc(p: Partial<OfficerCase> = {}): OfficerCase {
  n += 1;
  return {
    id: `c-${n}`,
    reportId: `${n}`,
    plate: "ABC-123",
    violation: "No parking zone",
    location: "Street 1",
    priority: "normal",
    status: "new",
    reporterReliability: "High",
    reporterName: "Test R.",
    reporterAcceptanceRate: 90,
    reporterVerifiedReports: 3,
    images: [],
    reportedAgo: "1 min ago",
    photoCount: 3,
    submittedAt: `2026-07-17T10:${String(n % 60).padStart(2, "0")}:00.000Z`,
    ...p,
  } as OfficerCase;
}

const inspection = (p: Partial<InspectionView>): InspectionView =>
  ({
    caseId: "x",
    vehiclePresent: null,
    plateMatched: null,
    violationConfirmed: null,
    restrictionVerified: null,
    officerPhotos: {},
    notes: "",
    exists: true,
    checklistConfirmed: 0,
    photosCaptured: 0,
    evidenceComplete: false,
    readyForCharge: false,
    plateConfirmedBySimulatedScan: false,
    ...p,
  }) as InspectionView;

describe("queue (OFF-02)", () => {
  const far = oc({ id: "far", coordinates: north(0.01) });
  const near = oc({ id: "near", coordinates: north(0.001) });
  const high = oc({ id: "high", priority: "high", coordinates: north(0.005) });
  const mine = oc({ id: "mine", status: "en-route", assignedOfficerId: ME, coordinates: north(0.002) });
  const theirs = oc({ id: "theirs", status: "assigned", assignedOfficerId: OTHER });
  const done = oc({ id: "done", status: "completed", assignedOfficerId: ME, outcomeCode: "CHARGE_ISSUED" });
  const all = [far, near, high, mine, theirs, done];

  it("filters open cases: All / New / High Priority / Assigned (to me)", () => {
    const ids = (f: Parameters<typeof filterQueue>[1]) => filterQueue(withDistances(all, HERE), f, ME).map((c) => c.id).sort();
    expect(ids("All")).toEqual(["far", "high", "mine", "near", "theirs"]);
    expect(ids("New")).toEqual(["far", "high", "near"]);
    expect(ids("High Priority")).toEqual(["high"]);
    expect(ids("Assigned")).toEqual(["mine"]);
  });

  it("Nearest sorts by real straight-line distance; unknown positions go last", () => {
    const sorted = sortQueue(filterQueue(withDistances(all, HERE), "All", ME));
    expect(sorted.map((c) => c.id)).toEqual(["near", "mine", "high", "far", "theirs"]);
    expect(sorted[0].distanceMeters).toBeGreaterThan(100);
    expect(sorted[0].distanceMeters).toBeLessThan(120);
    expect(sorted[4].distanceMeters).toBeNull();
  });

  it("without officer GPS: no distances at all and a deterministic priority/newest order", () => {
    const sorted = sortQueue(withDistances([far, near, high], undefined));
    expect(sorted.every((c) => c.distanceMeters === null)).toBe(true);
    expect(sorted[0].id).toBe("high");
    expect(sortQueue(withDistances([near, far, high], undefined)).map((c) => c.id)).toEqual(sorted.map((c) => c.id));
  });

  it("summary counts and empty-state messages", () => {
    expect(queueSummary(all, ME)).toEqual({ newCount: 3, highPriorityCount: 1, assignedToMeCount: 1 });
    expect(queueEmptyMessage("All", 0, 0)).toBe("No nearby reports right now.");
    expect(queueEmptyMessage("High Priority", 5, 0)).toBe("No reports in this category.");
    expect(queueEmptyMessage("All", 5, 5)).toBeNull();
  });

  it("home: open/high counts, nearest new case with its real distance, my active cases", () => {
    const s = officerHomeSummary(withDistances(all, HERE), ME);
    expect(s.openCount).toBe(5);
    expect(s.highPriorityCount).toBe(1);
    expect(s.nearest?.id).toBe("near");
    expect(s.active.map((c) => c.id)).toEqual(["mine"]);
    expect(officerHomeSummary(withDistances(all, undefined), ME).nearest?.distanceMeters).toBeNull();
  });
});

describe("report details (OFF-04)", () => {
  it("primary action follows the case stage and ownership", () => {
    expect(primaryCaseAction(oc(), ME)).toBe("ACCEPT");
    expect(primaryCaseAction(oc({ status: "assigned", assignedOfficerId: ME }), ME)).toBe("START_ROUTE");
    expect(primaryCaseAction(oc({ status: "en-route", assignedOfficerId: ME }), ME)).toBe("CONTINUE_ROUTE");
    expect(primaryCaseAction(oc({ status: "on-site", assignedOfficerId: ME }), ME)).toBe("START_INSPECTION");
    expect(primaryCaseAction(oc({ status: "inspection", assignedOfficerId: ME }), ME)).toBe("CONTINUE_INSPECTION");
    expect(primaryCaseAction(oc({ status: "en-route", assignedOfficerId: OTHER }), ME)).toBe("TAKEN");
    expect(primaryCaseAction(oc({ status: "completed" }), ME)).toBe("VIEW_RESULT");
  });

  it("desk decisions only for open cases that are not someone else's", () => {
    expect(canDecideAtDesk(oc(), ME)).toBe(true);
    expect(canDecideAtDesk(oc({ status: "en-route", assignedOfficerId: ME }), ME)).toBe(true);
    expect(canDecideAtDesk(oc({ status: "en-route", assignedOfficerId: OTHER }), ME)).toBe(false);
    expect(canDecideAtDesk(oc({ status: "completed" }), ME)).toBe(false);
  });

  it("system checks never claim GPS matching, plate recognition or duplicate detection", () => {
    const withGps = systemChecks({ coordinates: { accuracyMeters: 7.6 }, plateSource: "MOCK_DETECTED" });
    const text = withGps.map((c) => c.label).join(" | ");
    expect(text).toContain("Device GPS attached (±8 m)");
    expect(text).toContain("not server-verified");
    expect(text).toContain("Plate not verified");
    expect(text).toContain("Duplicate check: not performed");
    expect(text).not.toMatch(/GPS matched|plate detected|no match/i);
    expect(systemChecks({})[0]).toEqual({ label: "No device GPS (address only)", state: "unavailable" });
  });
});

describe("inspection completed (OFF-09)", () => {
  const completed = (code: string, chargeAmount?: number) =>
    oc({ status: "completed", outcomeCode: code, chargeAmount, completedAt: "2026-07-17T12:00:00.000Z" });

  it("shows €60 and the real photo count only for CHARGE_ISSUED", () => {
    const s = toCompletionSummary(completed("CHARGE_ISSUED", 60), inspection({ photosCaptured: 4 }), "ok");
    expect(s).toMatchObject({ outcomeLabel: "Parking charge issued", chargeText: "€60.00", photosText: "4 / 4", notes: "ok" });
  });

  it.each(["REPORT_REJECTED", "VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"])("%s has no charge line", (code) => {
    const s = toCompletionSummary(completed(code), inspection({ photosCaptured: 2 }));
    expect(s?.chargeText).toBeUndefined();
    expect(s?.photosText).toBe("2 / 4");
  });

  it("desk decisions (no inspection) show no photo line; open cases have no summary", () => {
    expect(toCompletionSummary(completed("REPORT_REJECTED"), inspection({ exists: false }))?.photosText).toBeUndefined();
    expect(toCompletionSummary(oc(), undefined)).toBeNull();
  });
});

describe("my cases (OFF-10)", () => {
  const issued = oc({ status: "completed", outcomeCode: "CHARGE_ISSUED", chargeAmount: 60, decidedBy: ME, assignedOfficerId: ME });
  const rejected = oc({ status: "completed", outcomeCode: "REPORT_REJECTED", decidedBy: ME });
  const moved = oc({ status: "completed", outcomeCode: "VEHICLE_MOVED", decidedBy: ME, assignedOfficerId: ME });
  const active = oc({ status: "en-route", assignedOfficerId: ME });
  const notMine = oc({ status: "completed", outcomeCode: "REPORT_REJECTED", decidedBy: OTHER });
  const mine = myCases([issued, rejected, moved, active, notMine], ME);

  it("only this officer's cases", () => {
    expect(mine.map((c) => c.id)).toEqual([issued.id, rejected.id, moved.id, active.id]);
  });

  it("Completed = all completed; Issued = CHARGE_ISSUED only; Rejected = REPORT_REJECTED only", () => {
    expect(filterCasesTab(mine, "Completed").map((c) => c.id)).toEqual([issued.id, rejected.id, moved.id]);
    expect(filterCasesTab(mine, "Issued").map((c) => c.id)).toEqual([issued.id]);
    expect(filterCasesTab(mine, "Rejected").map((c) => c.id)).toEqual([rejected.id]);
    expect(casesStats(mine)).toEqual({ total: 4, completed: 3, issued: 1, rejected: 1 });
  });

  it("chips show the exact outcome (a moved vehicle is not 'Rejected')", () => {
    expect(caseChip(issued)).toMatchObject({ label: "Charge issued" });
    expect(caseChip(rejected)).toMatchObject({ label: "Rejected" });
    expect(caseChip(moved)).toMatchObject({ label: "Vehicle moved" });
    expect(caseChip(active)).toEqual({ status: "en-route" });
  });
});
