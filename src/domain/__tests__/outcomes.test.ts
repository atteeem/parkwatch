import { CITIZEN, enforcementState, OFFICER, T2 } from "./fixtures";
import {
  calculateBalances,
  completeCaseWithOutcome,
  createEnforcementOutcome,
  DEFAULT_MOCK_CHARGE_AMOUNT_CENTS,
  EnforcementOutcomeCode,
  getCitizenOutcomeForEnforcementOutcome,
  getRewardState,
  MVP_REWARD_AMOUNT_CENTS,
  unwrap,
} from "./testHelpers";

const UNRESOLVED: EnforcementOutcomeCode[] = ["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"];

describe("outcome mapping (pure table)", () => {
  it("CHARGE_ISSUED -> citizen VERIFIED, reward eligible, verified notification", () => {
    expect(getCitizenOutcomeForEnforcementOutcome("CHARGE_ISSUED")).toEqual({
      resolution: "RESOLVED",
      citizenStatus: "VERIFIED",
      rewardEligible: true,
      citizenNotification: "REPORT_VERIFIED",
    });
  });

  it("REPORT_REJECTED -> citizen REJECTED, not reward eligible, rejected notification", () => {
    expect(getCitizenOutcomeForEnforcementOutcome("REPORT_REJECTED")).toEqual({
      resolution: "RESOLVED",
      citizenStatus: "REJECTED",
      rewardEligible: false,
      citizenNotification: "REPORT_REJECTED",
    });
  });

  it.each(UNRESOLVED)("%s -> explicitly UNRESOLVED, no reward, no citizen notification", (code) => {
    const c = getCitizenOutcomeForEnforcementOutcome(code);
    expect(c.resolution).toBe("UNRESOLVED");
    expect(c.rewardEligible).toBe(false);
    expect(c.citizenNotification).toBeNull();
    expect(c.resolution === "UNRESOLVED" && c.todo.length > 0).toBe(true);
    expect(c).not.toHaveProperty("citizenStatus");
  });

  it("only CHARGE_ISSUED carries a charge amount, defaulting to config", () => {
    const charge = createEnforcementOutcome({ code: "CHARGE_ISSUED", decidedAt: T2, officerId: OFFICER });
    const moved = createEnforcementOutcome({ code: "VEHICLE_MOVED", decidedAt: T2, officerId: OFFICER });
    expect(charge.chargeAmountCents).toBe(DEFAULT_MOCK_CHARGE_AMOUNT_CENTS);
    expect(moved.chargeAmountCents).toBeUndefined();
  });
});

describe("outcome applied end-to-end (completeCaseWithOutcome)", () => {
  const run = (code: EnforcementOutcomeCode) =>
    unwrap(completeCaseWithOutcome(enforcementState(), { code, officerId: OFFICER, decidedAt: T2, notes: "n" }));

  it("CHARGE_ISSUED: case completed, report VERIFIED, €5 available, verified notification", () => {
    const r = run("CHARGE_ISSUED");
    expect(r.state.officerCase.status).toBe("COMPLETED");
    expect(r.state.officerCase.outcome?.chargeAmountCents).toBe(DEFAULT_MOCK_CHARGE_AMOUNT_CENTS);
    expect(r.state.report.status).toBe("VERIFIED");
    expect(r.creditedCents).toBe(MVP_REWARD_AMOUNT_CENTS);
    expect(getRewardState(r.state.ledger, "12600")).toBe("AVAILABLE");
    const citizenNotes = r.state.notifications.filter((n) => n.recipient.role === "CITIZEN");
    expect(citizenNotes.map((n) => n.type)).toEqual(["REPORT_VERIFIED"]);
    expect(citizenNotes[0].amountCents).toBe(MVP_REWARD_AMOUNT_CENTS);
  });

  it("REPORT_REJECTED: report REJECTED, €0, pending voided, rejected notification", () => {
    const r = run("REPORT_REJECTED");
    expect(r.state.report.status).toBe("REJECTED");
    expect(r.creditedCents).toBe(0);
    expect(getRewardState(r.state.ledger, "12600")).toBe("VOID");
    expect(calculateBalances(r.state.ledger, CITIZEN)).toMatchObject({ availableCents: 0, pendingCents: 0 });
    expect(r.state.notifications.filter((n) => n.recipient.role === "CITIZEN").map((n) => n.type)).toEqual([
      "REPORT_REJECTED",
    ]);
  });

  it.each(UNRESOLVED)(
    "%s: case completes with exact outcome, report unchanged, €0, no citizen notification",
    (code) => {
      const before = enforcementState();
      const r = run(code);
      expect(r.state.officerCase.status).toBe("COMPLETED");
      expect(r.state.officerCase.outcome?.code).toBe(code);
      expect(r.state.inspection.outcome?.code).toBe(code);
      expect(r.state.inspection.notes).toBe("n");
      expect(r.state.report.status).toBe("UNDER_REVIEW");
      expect(r.state.report).toEqual(before.report);
      expect(r.state.report.status).not.toBe("REJECTED");
      expect(r.creditedCents).toBe(0);
      expect(r.state.ledger).toEqual(before.ledger);
      expect(calculateBalances(r.state.ledger, CITIZEN).availableCents).toBe(0);
      expect(r.state.notifications.filter((n) => n.recipient.role === "CITIZEN")).toHaveLength(0);
    }
  );
});
