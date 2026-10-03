import { CITIZEN, T0, T1, T2 } from "./fixtures";
import {
  applyOutcomeToLedger,
  calculateAvailableBalance,
  calculateBalances,
  createRewardForSuccessfulReport,
  errorCode,
  getCitizenOutcomeForEnforcementOutcome,
  Ledger,
  markWithdrawalPaid,
  MIN_WITHDRAWAL_AMOUNT_CENTS,
  MVP_REWARD_AMOUNT_CENTS,
  recordPendingReward,
  requestWithdrawal,
  unwrap,
  validateWithdrawal,
  voidPendingReward,
} from "./testHelpers";

const ctx = (reportId: string) => ({ citizenId: CITIZEN, reportId, at: T1 });

/** A ledger with `released` rewarded reports and `pending` reports awaiting outcome. */
function ledgerWith(released: number, pending: number): Ledger {
  let l: Ledger = [];
  for (let n = 0; n < released; n++) l = unwrap(createRewardForSuccessfulReport(l, ctx(`r${n}`))).ledger;
  for (let n = 0; n < pending; n++) l = recordPendingReward(l, { ...ctx(`p${n}`), at: T0 });
  return l;
}

describe("rewards", () => {
  it("a successful qualifying report creates exactly €5", () => {
    const l = recordPendingReward([], { ...ctx("r1"), at: T0 });
    const r = unwrap(createRewardForSuccessfulReport(l, ctx("r1")));
    expect(MVP_REWARD_AMOUNT_CENTS).toBe(500);
    expect(r.creditedCents).toBe(500);
    expect(calculateBalances(r.ledger, CITIZEN)).toMatchObject({ availableCents: 500, pendingCents: 0 });
  });

  it("credits correctly even without a prior pending entry, still exactly once", () => {
    const r = unwrap(createRewardForSuccessfulReport([], ctx("r1")));
    expect(r.creditedCents).toBe(500);
    expect(r.ledger.filter((e) => e.type === "REWARD_RELEASED")).toHaveLength(1);
  });

  it("repeating the reward operation cannot double-credit", () => {
    const once = unwrap(createRewardForSuccessfulReport([], ctx("r1")));
    const twice = unwrap(createRewardForSuccessfulReport(once.ledger, ctx("r1")));
    expect(twice.creditedCents).toBe(0);
    expect(twice.ledger).toBe(once.ledger);
    expect(calculateAvailableBalance(twice.ledger, CITIZEN)).toBe(500);
  });

  it("recording the pending reward twice keeps one entry", () => {
    const l = recordPendingReward(recordPendingReward([], { ...ctx("r1"), at: T0 }), { ...ctx("r1"), at: T1 });
    expect(l).toHaveLength(1);
    expect(calculateBalances(l, CITIZEN).pendingCents).toBe(500);
  });

  it("a rejected case creates €0 and voids the pending reward", () => {
    const l = recordPendingReward([], { ...ctx("r1"), at: T0 });
    const r = unwrap(applyOutcomeToLedger(l, getCitizenOutcomeForEnforcementOutcome("REPORT_REJECTED"), ctx("r1")));
    expect(r.creditedCents).toBe(0);
    expect(calculateBalances(r.ledger, CITIZEN)).toMatchObject({ availableCents: 0, pendingCents: 0 });
  });

  it("a voided reward can never be released afterwards", () => {
    const l = unwrap(voidPendingReward(recordPendingReward([], { ...ctx("r1"), at: T0 }), ctx("r1")));
    expect(errorCode(createRewardForSuccessfulReport(l, ctx("r1")))).toBe("REWARD_VOIDED");
  });

  it("an unresolved outcome creates €0 and leaves the ledger untouched", () => {
    const l = recordPendingReward([], { ...ctx("r1"), at: T0 });
    for (const code of ["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"] as const) {
      const r = unwrap(applyOutcomeToLedger(l, getCitizenOutcomeForEnforcementOutcome(code), ctx("r1")));
      expect(r.creditedCents).toBe(0);
      expect(r.ledger).toBe(l);
      expect(calculateAvailableBalance(r.ledger, CITIZEN)).toBe(0);
    }
  });

  it("balances are per citizen", () => {
    const l = unwrap(createRewardForSuccessfulReport([], { citizenId: "other", reportId: "x", at: T1 })).ledger;
    expect(calculateAvailableBalance(l, CITIZEN)).toBe(0);
    expect(calculateAvailableBalance(l, "other")).toBe(500);
  });
});

describe("wallet", () => {
  it("available balance is derived from the ledger", () => {
    const l = ledgerWith(9, 2); // €45 available, €10 pending (the Figma figures)
    expect(calculateBalances(l, CITIZEN)).toEqual({
      availableCents: 4500,
      pendingCents: 1000,
      paidOutCents: 0,
      withdrawalsInFlightCents: 0,
    });
  });

  it("a withdrawal decreases the available balance (and what can be withdrawn next)", () => {
    const l = ledgerWith(9, 0);
    const after = unwrap(requestWithdrawal(l, { withdrawalId: "w1", citizenId: CITIZEN, amountCents: 2500, at: T2 }));
    expect(after.changed).toBe(true);
    expect(calculateBalances(after.ledger, CITIZEN)).toMatchObject({
      availableCents: 2000,
      withdrawalsInFlightCents: 2500,
      paidOutCents: 0,
    });
    expect(errorCode(validateWithdrawal(after.ledger, CITIZEN, 2500))).toBe("INSUFFICIENT_AVAILABLE_BALANCE");
    expect(validateWithdrawal(after.ledger, CITIZEN, 2000).ok).toBe(true);
  });

  it("a repeated withdrawal request with the same id is not applied twice", () => {
    const l = ledgerWith(9, 0);
    const once = unwrap(requestWithdrawal(l, { withdrawalId: "w1", citizenId: CITIZEN, amountCents: 2500, at: T2 }));
    const twice = unwrap(
      requestWithdrawal(once.ledger, { withdrawalId: "w1", citizenId: CITIZEN, amountCents: 2500, at: T2 })
    );
    expect(twice.changed).toBe(false);
    expect(calculateAvailableBalance(twice.ledger, CITIZEN)).toBe(2000);
  });

  it("cannot withdraw more than available", () => {
    expect(errorCode(validateWithdrawal(ledgerWith(1, 0), CITIZEN, 600))).toBe("INSUFFICIENT_AVAILABLE_BALANCE");
  });

  it("cannot withdraw pending balance", () => {
    const l = ledgerWith(1, 4); // €5 available, €20 pending
    expect(errorCode(validateWithdrawal(l, CITIZEN, 1000))).toBe("INSUFFICIENT_AVAILABLE_BALANCE");
    expect(validateWithdrawal(l, CITIZEN, 500).ok).toBe(true);
  });

  it("cannot withdraw below the €5 minimum", () => {
    expect(MIN_WITHDRAWAL_AMOUNT_CENTS).toBe(500);
    expect(errorCode(validateWithdrawal(ledgerWith(9, 0), CITIZEN, 499))).toBe("BELOW_MINIMUM");
  });

  it.each([0, -500, 250.5, Number.NaN])("cannot withdraw invalid amount %p", (amount) => {
    expect(errorCode(validateWithdrawal(ledgerWith(9, 0), CITIZEN, amount))).toBe("INVALID_AMOUNT");
  });

  it("a refused withdrawal leaves the ledger unchanged", () => {
    const l = ledgerWith(1, 0);
    const r = requestWithdrawal(l, { withdrawalId: "w1", citizenId: CITIZEN, amountCents: 5000, at: T2 });
    expect(r.ok).toBe(false);
    expect(calculateAvailableBalance(l, CITIZEN)).toBe(500);
  });

  it("future payout confirmation moves in-flight money to paid out", () => {
    const requested = unwrap(
      requestWithdrawal(ledgerWith(9, 0), { withdrawalId: "w1", citizenId: CITIZEN, amountCents: 2500, at: T2 })
    ).ledger;
    const paid = unwrap(markWithdrawalPaid(requested, { withdrawalId: "w1", at: T2 }));
    expect(calculateBalances(paid, CITIZEN)).toMatchObject({
      availableCents: 2000,
      paidOutCents: 2500,
      withdrawalsInFlightCents: 0,
    });
  });
});
