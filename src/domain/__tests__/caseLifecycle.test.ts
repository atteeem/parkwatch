import { caseInInspection, OFFICER, T0, T1, T2 } from "./fixtures";
import {
  canTransitionCase,
  CaseStatus,
  completeCase,
  createCase,
  createEnforcementOutcome,
  errorCode,
  transitionCase,
  unwrap,
} from "./testHelpers";

const newCase = () => createCase({ id: "c-1", reportId: "r-1", priority: "HIGH", createdAt: T0 });

describe("case lifecycle: allowed transitions", () => {
  it.each<[CaseStatus, CaseStatus]>([
    ["NEW", "ASSIGNED"],
    ["ASSIGNED", "EN_ROUTE"],
    ["EN_ROUTE", "INSPECTION"],
    ["EN_ROUTE", "ON_SITE"],
    ["ON_SITE", "INSPECTION"],
    ["INSPECTION", "COMPLETED"],
  ])("%s -> %s is allowed", (from, to) => {
    expect(canTransitionCase(from, to)).toBe(true);
  });

  it("walks the full MVP path and records timestamps and events", () => {
    const c = caseInInspection();
    expect(c.status).toBe("INSPECTION");
    expect(c.assignedOfficerId).toBe(OFFICER);
    expect(c.statusTimestamps).toMatchObject({ NEW: T0, ASSIGNED: T1, EN_ROUTE: T1, INSPECTION: T1 });
    expect(c.events.map((e) => e.to)).toEqual(["NEW", "ASSIGNED", "EN_ROUTE", "INSPECTION"]);
  });

  it("INSPECTION -> COMPLETED via completeCase stores the outcome", () => {
    const outcome = createEnforcementOutcome({ code: "CHARGE_ISSUED", decidedAt: T2, officerId: OFFICER });
    const { case: done, changed } = unwrap(completeCase(caseInInspection(), outcome));
    expect(changed).toBe(true);
    expect(done.status).toBe("COMPLETED");
    expect(done.outcome?.code).toBe("CHARGE_ISSUED");
    expect(done.completedAt).toBe(T2);
  });
});

describe("case lifecycle: invalid transitions are rejected", () => {
  it.each<[CaseStatus, CaseStatus]>([
    ["NEW", "EN_ROUTE"],
    ["NEW", "INSPECTION"],
    ["NEW", "COMPLETED"],
    ["ASSIGNED", "NEW"],
    ["EN_ROUTE", "ASSIGNED"],
    ["INSPECTION", "EN_ROUTE"],
    ["INSPECTION", "NEW"],
    ["COMPLETED", "INSPECTION"],
    ["COMPLETED", "NEW"],
    ["NEW", "NEW"],
  ])("%s -> %s is not allowed", (from, to) => {
    expect(canTransitionCase(from, to)).toBe(false);
  });

  it("returns INVALID_TRANSITION and leaves the case untouched", () => {
    const c = newCase();
    const snapshot = JSON.stringify(c);
    const r = transitionCase(c, "INSPECTION", { at: T1, officerId: OFFICER });
    expect(errorCode(r)).toBe("INVALID_TRANSITION");
    expect(JSON.stringify(c)).toBe(snapshot);
  });

  it("cannot complete a case that is not in INSPECTION", () => {
    const outcome = createEnforcementOutcome({ code: "CHARGE_ISSUED", decidedAt: T2, officerId: OFFICER });
    expect(errorCode(completeCase(newCase(), outcome))).toBe("INVALID_TRANSITION");
  });

  it("assigning requires an officer id", () => {
    expect(errorCode(transitionCase(newCase(), "ASSIGNED", { at: T1 }))).toBe("MISSING_OFFICER");
  });
});

describe("case lifecycle: completion idempotency", () => {
  const outcome = (code: "CHARGE_ISSUED" | "REPORT_REJECTED") =>
    createEnforcementOutcome({ code, decidedAt: T2, officerId: OFFICER });

  it("completing twice with the same outcome adds no duplicate event", () => {
    const first = unwrap(completeCase(caseInInspection(), outcome("CHARGE_ISSUED")));
    const second = unwrap(completeCase(first.case, outcome("CHARGE_ISSUED")));
    expect(second.changed).toBe(false);
    expect(second.case).toBe(first.case);
    expect(second.case.events.filter((e) => e.to === "COMPLETED")).toHaveLength(1);
  });

  it("a different outcome on a completed case is ALREADY_COMPLETED", () => {
    const first = unwrap(completeCase(caseInInspection(), outcome("CHARGE_ISSUED")));
    expect(errorCode(completeCase(first.case, outcome("REPORT_REJECTED")))).toBe("ALREADY_COMPLETED");
  });
});
