import { CITIZEN, enforcementState, OFFICER, readyInspection, T2 } from "./fixtures";
import { calculateBalances, completeCaseWithOutcome, errorCode, unwrap } from "./testHelpers";

const charge = { code: "CHARGE_ISSUED" as const, officerId: OFFICER, decidedAt: T2 };

describe("completeCaseWithOutcome idempotency", () => {
  it("completing the same case twice creates no second reward, event or notification", () => {
    const first = unwrap(completeCaseWithOutcome(enforcementState(), charge));
    const second = unwrap(completeCaseWithOutcome(first.state, { ...charge, decidedAt: "2026-07-17T19:00:00.000Z" }));

    expect(second.changed).toBe(false);
    expect(second.creditedCents).toBe(0);
    expect(second.state).toBe(first.state);
    expect(calculateBalances(second.state.ledger, CITIZEN).availableCents).toBe(500);
    expect(second.state.ledger.filter((e) => e.type === "REWARD_RELEASED")).toHaveLength(1);
    expect(second.state.officerCase.events.filter((e) => e.to === "COMPLETED")).toHaveLength(1);
    expect(second.state.notifications.filter((n) => n.type === "REPORT_VERIFIED")).toHaveLength(1);
  });

  it("a conflicting second outcome is refused and changes nothing", () => {
    const first = unwrap(completeCaseWithOutcome(enforcementState(), charge));
    const r = completeCaseWithOutcome(first.state, { ...charge, code: "REPORT_REJECTED" });
    expect(errorCode(r)).toBe("ALREADY_COMPLETED");
    expect(first.state.report.status).toBe("VERIFIED");
  });
});

describe("completeCaseWithOutcome guards", () => {
  it("refuses a charge when the inspection is incomplete, leaving all state untouched", () => {
    const state = enforcementState();
    const { VIOLATION_CONTEXT: _missing, ...three } = readyInspection().officerEvidence;
    const incomplete = { ...state, inspection: { ...state.inspection, officerEvidence: three } };
    const snapshot = JSON.stringify(incomplete);

    expect(errorCode(completeCaseWithOutcome(incomplete, charge))).toBe("INSPECTION_NOT_READY");
    expect(JSON.stringify(incomplete)).toBe(snapshot);
  });

  it("refuses mismatched case/report/inspection", () => {
    const state = enforcementState();
    const wrong = { ...state, report: { ...state.report, id: "other" } };
    expect(errorCode(completeCaseWithOutcome(wrong, charge))).toBe("CASE_REPORT_MISMATCH");
  });

  it("refuses to complete a case that never reached INSPECTION", () => {
    const state = enforcementState();
    const early = { ...state, officerCase: { ...state.officerCase, status: "EN_ROUTE" as const } };
    expect(errorCode(completeCaseWithOutcome(early, charge))).toBe("INVALID_TRANSITION");
  });
});
