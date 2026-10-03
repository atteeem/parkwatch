import { CITIZEN, T0, T1, T2 } from "./fixtures";
import {
  applyOutcomeToLedger,
  cancelPendingReward,
  calculateAvailableBalance,
  calculateBalances,
  errorCode,
  getCitizenOutcomeForEnforcementOutcome,
  Ledger,
  markWithdrawalPaid,
  MIN_WITHDRAWAL_AMOUNT_CENTS,
  MVP_REWARD_AMOUNT_CENTS,
  recordPendingReward,
  releasePendingReward,
  requestWithdrawal,
  unwrap,
  validateWithdrawal,
} from "./testHelpers";

const ctx = (reportId: string) => ({ citizenId: CITIZEN, reportId, at: T1 });

/** A ledger with `released` rewarded reports and `pending` reports awaiting outcome. */
function ledgerWith(released: number, pending: number): Ledger {
  let l: Ledger = [];
  for (let n = 0; n < released; n++) {
    l = recordPendingReward(l, { ...ctx(`r${n}`), at: T0 });
    l = unwrap(releasePendingReward(l, ctx(`r${n}`))).ledger;
  }
  for (let n = 0; n < pending; n++) l = recordPendingReward(l, { ...ctx(`p${n}`), at: T0 });
  return l;
}

describe("rewards", () => {
  const pending = () => recordPendingReward([], { ...ctx("r1"), at: T0 });

  it("a successful qualifying report releases exactly €5", () => {
    const r = unwrap(releasePendingReward(pending(), ctx("r1")));
    expect(MVP_REWARD_AMOUNT_CENTS).toBe(500);
    expect(r.creditedCents).toBe(500);
    expect(calculateBalances(r.ledger, CITIZEN)).toMatchObject({ availableCents: 500, pendingCents: 0 });
  });

  it("releases the existing pending reward rather than creating an unrelated credit", () => {
    expect(errorCode(releasePendingReward([], ctx("r1")))).toBe("NO_PENDING_REWARD");
    const r = unwrap(releasePendingReward(pending(), ctx("r1")));
    expect(r.ledger.map((e) => [e.type, e.reportId])).toEqual([
      ["REWARD_PENDING", "r1"],
      ["REWARD_RELEASED", "r1"],
    ]);
  });

  it("repeating the release cannot double-credit", () => {
    const once = unwrap(releasePendingReward(pending(), ctx("r1")));
    const twice = unwrap(releasePendingReward(once.ledger, ctx("r1")));
    expect(twice.creditedCents).toBe(0);
    expect(twice.ledger).toBe(once.ledger);
    expect(calculateAvailableBalance(twice.ledger, CITIZEN)).toBe(500);
  });

  it("recording the pending reward twice keeps one entry", () => {
    const l = recordPendingReward(pending(), { ...ctx("r1"), at: T1 });
    expect(l).toHaveLength(1);
    expect(calculateBalances(l, CITIZEN).pendingCents).toBe(500);
  });

  it("a rejected case creates €0 and cancels the pending reward", () => {
    const r = unwrap(applyOutcomeToLedger(pending(), getCitizenOutcomeForEnforcementOutcome("REPORT_REJECTED"), ctx("r1")));
    expect(r.creditedCents).toBe(0);
    expect(calculateBalances(r.ledger, CITIZEN)).toMatchObject({ availableCents: 0, pendingCents: 0 });
  });

  it.each(["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"] as const)(
    "%s creates €0 and removes the reward from pending",
    (code) => {
      const r = unwrap(applyOutcomeToLedger(pending(), getCitizenOutcomeForEnforcementOutcome(code), ctx("r1")));
      expect(r.creditedCents).toBe(0);
      expect(calculateBalances(r.ledger, CITIZEN)).toMatchObject({ availableCents: 0, pendingCents: 0 });
    }
  );

  it("a cancelled reward can never be released afterwards", () => {
    const l = unwrap(cancelPendingReward(pending(), ctx("r1")));
    expect(errorCode(releasePendingReward(l, ctx("r1")))).toBe("REWARD_VOIDED");
  });

  it("cancelling twice is a no-op; a released reward cannot be cancelled", () => {
    const once = unwrap(cancelPendingReward(pending(), ctx("r1")));
    expect(unwrap(cancelPendingReward(once, ctx("r1")))).toBe(once);
    const released = unwrap(releasePendingReward(pending(), ctx("r1"))).ledger;
    expect(errorCode(cancelPendingReward(released, ctx("r1")))).toBe("REPORT_ALREADY_RESOLVED");
  });

  it("balances are per citizen", () => {
    let l = recordPendingReward([], { citizenId: "other", reportId: "x", at: T0 });
    l = unwrap(releasePendingReward(l, { citizenId: "other", reportId: "x", at: T1 })).ledger;
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

describe("withdrawal request -> paid accounting", () => {
  it("€45 available, request €20 -> €25; mark the same withdrawal paid -> still €25, €20 paid out", () => {
    const start = ledgerWith(9, 0);
    expect(calculateBalances(start, CITIZEN)).toMatchObject({ availableCents: 4500, paidOutCents: 0 });

    const requested = unwrap(
      requestWithdrawal(start, { withdrawalId: "w-20", citizenId: CITIZEN, amountCents: 2000, at: T2 })
    ).ledger;
    expect(calculateBalances(requested, CITIZEN)).toMatchObject({
      availableCents: 2500,
      paidOutCents: 0,
      withdrawalsInFlightCents: 2000,
    });

    const paid = unwrap(markWithdrawalPaid(requested, { withdrawalId: "w-20", at: T2 }));
    expect(calculateBalances(paid, CITIZEN)).toMatchObject({
      availableCents: 2500, // NOT debited a second time
      paidOutCents: 2000,
      withdrawalsInFlightCents: 0,
    });
    // PAID is linked to the same withdrawal by its stable id
    const paidEntry = paid.find((e) => e.type === "WITHDRAWAL_PAID")!;
    expect(paidEntry.withdrawalId).toBe("w-20");
    expect(paidEntry.amountCents).toBe(2000);
  });

  it("repeating the paid confirmation is idempotent", () => {
    const requested = unwrap(
      requestWithdrawal(ledgerWith(9, 0), { withdrawalId: "w-20", citizenId: CITIZEN, amountCents: 2000, at: T2 })
    ).ledger;
    const once = unwrap(markWithdrawalPaid(requested, { withdrawalId: "w-20", at: T2 }));
    const twice = unwrap(markWithdrawalPaid(once, { withdrawalId: "w-20", at: T2 }));
    expect(twice).toBe(once);
    expect(calculateBalances(twice, CITIZEN)).toMatchObject({ availableCents: 2500, paidOutCents: 2000 });
  });

  it("cannot mark an unknown withdrawal paid", () => {
    expect(errorCode(markWithdrawalPaid(ledgerWith(9, 0), { withdrawalId: "nope", at: T2 }))).toBe(
      "INVALID_TRANSITION"
    );
  });
});
