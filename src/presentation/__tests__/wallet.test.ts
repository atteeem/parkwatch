import { calculateBalances, validateWithdrawal } from "../../domain";
import { buildSeedState } from "../../store/seed";
import { DEV_CITIZEN_ID } from "../../store/session";
import { CITIZEN, expectOk, makeStore, OFFICER, snapshot, submitAndInspect } from "../../store/__tests__/helpers";
import { selectEarnings, selectWalletActivity } from "../walletViews";
import {
  checkWithdrawalInput,
  confirmWithdrawal,
  initialWithdrawCents,
  parseEuroAmount,
  withdrawPresets,
} from "../withdrawForm";

describe("withdraw form parsing and presets", () => {
  it.each([
    ["25", 2500],
    ["25.5", 2550],
    ["25,50", 2550],
    ["€ 5.00", 500],
    ["0.99", 99],
  ])("parses %p as %p cents", (text, cents) => expect(parseEuroAmount(text)).toBe(cents));

  it.each(["", "abc", "-5", "5.001", "5..0", "1e3"])("rejects %p", (text) => expect(parseEuroAmount(text)).toBeNull());

  it("presets derive from AVAILABLE only and are never bumped up to the minimum", () => {
    expect(withdrawPresets(4500).map((p) => p.cents)).toEqual([1125, 2250, 4500]);
    expect(withdrawPresets(300).map((p) => p.cents)).toEqual([75, 150, 300]);
    expect(withdrawPresets(0).map((p) => p.cents)).toEqual([0, 0, 0]);
  });

  it("starting amount is EUR 25 or the whole available balance if smaller", () => {
    expect(initialWithdrawCents(4500)).toBe(2500);
    expect(initialWithdrawCents(300)).toBe(300);
  });
});

describe("withdraw validation against the ledger (seeded EUR 45 available / EUR 10 pending)", () => {
  const seed = buildSeedState(new Date("2026-07-17T18:00:00.000Z"));
  const validate = (cents: number) => validateWithdrawal(seed.ledger, DEV_CITIZEN_ID, cents);

  it("a valid amount passes", () => {
    expect(checkWithdrawalInput("25.00", validate)).toEqual({ ok: true, cents: 2500 });
    expect(checkWithdrawalInput("45", validate)).toEqual({ ok: true, cents: 4500 });
  });

  it("below EUR 5, zero and non-numeric are refused with friendly messages", () => {
    expect(checkWithdrawalInput("4.99", validate)).toEqual({ ok: false, message: "The minimum withdrawal is €5.00." });
    expect(checkWithdrawalInput("0", validate)).toMatchObject({ ok: false, message: "Enter a valid amount." });
    expect(checkWithdrawalInput("ten", validate)).toMatchObject({ ok: false });
  });

  it("over the available balance is refused, and pending money is excluded", () => {
    // 45 available + 10 pending: 50 must still be refused
    const r = checkWithdrawalInput("50", validate);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.message).toMatch(/available balance/);
    expect(r.ok ? "" : r.message).not.toMatch(/INSUFFICIENT/);
  });
});

describe("confirm withdrawal", () => {
  async function storeWith(euros: number) {
    const ctx = await makeStore();
    for (let i = 0; i < euros / 5; i++) {
      const { caseId } = submitAndInspect(ctx.store, `w${i}`);
      expectOk(ctx.store.completeCase(caseId, "CHARGE_ISSUED", OFFICER));
    }
    const deps = {
      validate: (c: number) => validateWithdrawal(snapshot(ctx.store).ledger, CITIZEN, c),
      withdraw: (c: number) => ctx.store.requestWithdrawal(CITIZEN, c),
    };
    return { ...ctx, deps };
  }

  it("a valid request reduces available and navigates", async () => {
    const { store, deps } = await storeWith(15);
    const onSuccess = jest.fn();
    const onError = jest.fn();
    expect(confirmWithdrawal("10", { ...deps, onSuccess, onError })).toBe("requested");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(calculateBalances(snapshot(store).ledger, CITIZEN)).toMatchObject({ availableCents: 500, paidOutCents: 0 });
  });

  it("a refused request does NOT navigate and leaves the ledger untouched", async () => {
    const { store, deps } = await storeWith(5);
    const before = snapshot(store).ledger;
    const onSuccess = jest.fn();
    const onError = jest.fn();
    expect(confirmWithdrawal("10", { ...deps, onSuccess, onError })).toBe("refused");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/available balance/));
    expect(snapshot(store).ledger).toBe(before);
  });

  it("with less than EUR 5 available nothing can be withdrawn (no manufactured EUR 5)", async () => {
    const { deps } = await storeWith(0);
    const onSuccess = jest.fn();
    expect(confirmWithdrawal("5", { ...deps, onSuccess, onError: jest.fn() })).toBe("refused");
    expect(withdrawPresets(0).every((p) => p.cents === 0)).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("a domain refusal at request time (e.g. balance changed) also does not navigate", () => {
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const result = confirmWithdrawal("10", {
      validate: () => ({ ok: true, value: true }),
      withdraw: () => ({ ok: false, error: { code: "INSUFFICIENT_AVAILABLE_BALANCE", message: "x" } }),
      onSuccess,
      onError,
    });
    expect(result).toBe("refused");
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("wallet activity and earnings come from the ledger", () => {
  const now = new Date("2026-07-17T18:00:00.000Z");
  const seed = buildSeedState(now);

  it("activity lists real reward/withdrawal lifecycles with plates", () => {
    const items = selectWalletActivity(seed, DEV_CITIZEN_ID);
    const kinds = items.map((i) => i.kind);
    expect(kinds.filter((k) => k === "REWARD_AVAILABLE")).toHaveLength(3);
    expect(kinds.filter((k) => k === "REWARD_PENDING")).toHaveLength(2);
    expect(kinds.filter((k) => k === "REWARD_CANCELLED")).toHaveLength(1);
    expect(kinds.filter((k) => k === "WITHDRAWAL_PAID")).toHaveLength(2);
    expect(items.find((i) => i.kind === "REWARD_AVAILABLE")!.subtitle).toMatch(/^[A-Z]{3}-\d{3} • Verified report$/);
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort().reverse());
  });

  it("a requested (not yet paid) withdrawal is shown as requested, never as completed", async () => {
    const { store } = await makeStore({ seed: buildSeedState });
    expectOk(store.requestWithdrawal(DEV_CITIZEN_ID, 1000));
    const top = selectWalletActivity(snapshot(store), DEV_CITIZEN_ID)[0];
    expect(top).toMatchObject({ kind: "WITHDRAWAL_REQUESTED", title: "Withdrawal requested", amountText: "-€10.00" });
  });

  it("earnings totals count released rewards in the period (opening balance is not earnings)", () => {
    const all = selectEarnings(seed, DEV_CITIZEN_ID, "ALL_TIME", now);
    expect(all).toMatchObject({ totalCents: 1500, verifiedCount: 3, totalText: "€15.00" });
    expect(all.buckets.reduce((a, b) => a + b, 0)).toBe(1500);
    expect(selectEarnings(seed, DEV_CITIZEN_ID, "TODAY", now).totalCents).toBeLessThanOrEqual(1500);
  });
});
