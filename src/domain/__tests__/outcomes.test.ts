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
  it("CHARGE_ISSUED -> VERIFIED, releases the pending reward, verified notification", () => {
    expect(getCitizenOutcomeForEnforcementOutcome("CHARGE_ISSUED")).toEqual({
      citizenStatus: { resolution: "RESOLVED", status: "VERIFIED" },
      reward: "RELEASE_PENDING",
      citizenNotification: "REPORT_VERIFIED",
    });
  });

  it("REPORT_REJECTED -> REJECTED, cancels the pending reward, rejected notification", () => {
    expect(getCitizenOutcomeForEnforcementOutcome("REPORT_REJECTED")).toEqual({
      citizenStatus: { resolution: "RESOLVED", status: "REJECTED" },
      reward: "CANCEL_PENDING",
      citizenNotification: "REPORT_REJECTED",
    });
  });

  it.each(UNRESOLVED)(
    "%s -> citizen STATUS explicitly unresolved, but reward resolved as cancelled; no notification",
    (code) => {
      const c = getCitizenOutcomeForEnforcementOutcome(code);
      expect(c.citizenStatus.resolution).toBe("UNRESOLVED");
      expect(c.citizenStatus.resolution === "UNRESOLVED" && c.citizenStatus.todo.length > 0).toBe(true);
      expect(c.citizenStatus).not.toHaveProperty("status");
      expect(c.reward).toBe("CANCEL_PENDING");
      expect(c.citizenNotification).toBeNull();
    }
  );

  it("only CHARGE_ISSUED releases a reward", () => {
    const releasing = (["CHARGE_ISSUED", "REPORT_REJECTED", ...UNRESOLVED] as EnforcementOutcomeCode[]).filter(
      (code) => getCitizenOutcomeForEnforcementOutcome(code).reward === "RELEASE_PENDING"
    );
    expect(releasing).toEqual(["CHARGE_ISSUED"]);
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
  const citizenNotes = (r: ReturnType<typeof run>) =>
    r.state.notifications.filter((n) => n.recipient.role === "CITIZEN");

  it("starts with €5 pending for the report", () => {
    expect(calculateBalances(enforcementState().ledger, CITIZEN)).toMatchObject({
      pendingCents: MVP_REWARD_AMOUNT_CENTS,
      availableCents: 0,
    });
  });

  it("CHARGE_ISSUED: case completed, VERIFIED, the existing €5 pending becomes €5 available", () => {
    const r = run("CHARGE_ISSUED");
    expect(r.state.officerCase.status).toBe("COMPLETED");
    expect(r.state.officerCase.outcome?.chargeAmountCents).toBe(DEFAULT_MOCK_CHARGE_AMOUNT_CENTS);
    expect(r.state.report.status).toBe("VERIFIED");
    expect(r.creditedCents).toBe(MVP_REWARD_AMOUNT_CENTS);
    expect(getRewardState(r.state.ledger, "12600")).toBe("AVAILABLE");
    expect(calculateBalances(r.state.ledger, CITIZEN)).toMatchObject({ pendingCents: 0, availableCents: 500 });
    // one reward lifecycle: exactly one pending entry and one release entry
    expect(r.state.ledger.map((e) => e.type)).toEqual(["REWARD_PENDING", "REWARD_RELEASED"]);
    expect(citizenNotes(r).map((n) => n.type)).toEqual(["REPORT_VERIFIED"]);
    expect(citizenNotes(r)[0].amountCents).toBe(MVP_REWARD_AMOUNT_CENTS);
  });

  it("REPORT_REJECTED: REJECTED, pending cancelled, nothing available, rejected notification", () => {
    const r = run("REPORT_REJECTED");
    expect(r.state.report.status).toBe("REJECTED");
    expect(r.creditedCents).toBe(0);
    expect(getRewardState(r.state.ledger, "12600")).toBe("VOID");
    expect(calculateBalances(r.state.ledger, CITIZEN)).toMatchObject({ availableCents: 0, pendingCents: 0 });
    expect(citizenNotes(r).map((n) => n.type)).toEqual(["REPORT_REJECTED"]);
  });

  it.each(UNRESOLVED)(
    "%s: case completed with exact outcome, status unchanged, pending cancelled, €0, no citizen notification",
    (code) => {
      const before = enforcementState();
      const r = run(code);
      // officer side
      expect(r.state.officerCase.status).toBe("COMPLETED");
      expect(r.state.officerCase.outcome?.code).toBe(code);
      expect(r.state.inspection!.outcome?.code).toBe(code);
      expect(r.state.inspection!.notes).toBe("n");
      // citizen status untouched (neither REJECTED nor VERIFIED)
      expect(r.state.report).toEqual(before.report);
      expect(r.state.report.status).toBe("UNDER_REVIEW");
      // reward resolved as cancelled
      expect(r.creditedCents).toBe(0);
      expect(getRewardState(r.state.ledger, "12600")).toBe("VOID");
      expect(calculateBalances(r.state.ledger, CITIZEN)).toMatchObject({ pendingCents: 0, availableCents: 0 });
      // no citizen outcome notification
      expect(citizenNotes(r)).toHaveLength(0);
    }
  );
});
