import { MIN_WITHDRAWAL_AMOUNT_CENTS, MVP_REWARD_AMOUNT_CENTS } from "./config";
import { CitizenConsequence } from "./outcomes";
import { fail, ok, Result } from "./result";
import { Cents, IsoTimestamp, RewardLedgerEntry, RewardLedgerEntryType } from "./types";

/**
 * Append-only reward ledger.
 *
 * Entries are never edited or deleted; balances are always derived by
 * summing entries. Every entry has an idempotency key unique to its logical
 * operation (e.g. "reward-released:<reportId>"), and appending an existing key
 * is a no-op. This is what makes repeated outcome processing safe, and it is
 * the same model a real payout provider integration can append to later.
 *
 * Per-report reward lifecycle (exactly one per report):
 *                               (none) -> PENDING -> AVAILABLE   (released)
 *                                                 -> VOID        (cancelled)
 * Withdrawals:                  REQUESTED -> PAID (PAID is future/provider-driven)
 */
export type Ledger = readonly RewardLedgerEntry[];

export type RewardState = "NONE" | "PENDING" | "AVAILABLE" | "VOID";

export type Balances = {
  /** Released rewards minus all requested withdrawals. Withdrawable. */
  availableCents: Cents;
  /** Estimated rewards awaiting an outcome. Not withdrawable. */
  pendingCents: Cents;
  /** Withdrawals confirmed paid by a provider. */
  paidOutCents: Cents;
  /** Requested withdrawals not yet confirmed paid. */
  withdrawalsInFlightCents: Cents;
};

const key = {
  pending: (reportId: string) => `reward-pending:${reportId}`,
  released: (reportId: string) => `reward-released:${reportId}`,
  voided: (reportId: string) => `reward-voided:${reportId}`,
  withdrawalRequested: (withdrawalId: string) => `withdrawal-requested:${withdrawalId}`,
  withdrawalPaid: (withdrawalId: string) => `withdrawal-paid:${withdrawalId}`,
};

function hasKey(ledger: Ledger, idempotencyKey: string): boolean {
  return ledger.some((e) => e.idempotencyKey === idempotencyKey);
}

function findByKey(ledger: Ledger, idempotencyKey: string): RewardLedgerEntry | undefined {
  return ledger.find((e) => e.idempotencyKey === idempotencyKey);
}

/** Append unless an entry with the same idempotency key already exists. */
export function appendOnce(ledger: Ledger, entry: RewardLedgerEntry): { ledger: Ledger; appended: boolean } {
  if (hasKey(ledger, entry.idempotencyKey)) return { ledger, appended: false };
  return { ledger: [...ledger, entry], appended: true };
}

function entry(
  type: RewardLedgerEntryType,
  idempotencyKey: string,
  fields: { citizenId: string; amountCents: Cents; createdAt: IsoTimestamp; reportId?: string; withdrawalId?: string }
): RewardLedgerEntry {
  // The idempotency key is unique per operation, so it doubles as the entry id.
  return { id: idempotencyKey, idempotencyKey, type, ...fields };
}

export function getRewardState(ledger: Ledger, reportId: string): RewardState {
  if (hasKey(ledger, key.voided(reportId))) return "VOID";
  if (hasKey(ledger, key.released(reportId))) return "AVAILABLE";
  if (hasKey(ledger, key.pending(reportId))) return "PENDING";
  return "NONE";
}

/** Record the estimated reward when a report is submitted. Idempotent per report. */
export function recordPendingReward(
  ledger: Ledger,
  input: { citizenId: string; reportId: string; at: IsoTimestamp; amountCents?: Cents }
): Ledger {
  return appendOnce(
    ledger,
    entry("REWARD_PENDING", key.pending(input.reportId), {
      citizenId: input.citizenId,
      reportId: input.reportId,
      amountCents: input.amountCents ?? MVP_REWARD_AMOUNT_CENTS,
      createdAt: input.at,
    })
  ).ledger;
}

/**
 * Release a report's existing pending reward to available.
 *
 * There is exactly one reward lifecycle per report: this never creates an
 * unrelated credit. It requires the pending entry recorded at submission.
 * Already AVAILABLE -> no-op (creditedCents 0). VOID -> cannot be revived.
 */
export function releasePendingReward(
  ledger: Ledger,
  input: { citizenId: string; reportId: string; at: IsoTimestamp }
): Result<{ ledger: Ledger; creditedCents: Cents }> {
  const state = getRewardState(ledger, input.reportId);
  if (state === "VOID") return fail("REWARD_VOIDED", `Reward for report ${input.reportId} was cancelled.`);
  if (state === "AVAILABLE") return ok({ ledger, creditedCents: 0 });
  if (state === "NONE") {
    return fail("NO_PENDING_REWARD", `Report ${input.reportId} has no pending reward to release.`);
  }
  const pending = findByKey(ledger, key.pending(input.reportId))!;
  const released = appendOnce(
    ledger,
    entry("REWARD_RELEASED", key.released(input.reportId), {
      citizenId: input.citizenId,
      reportId: input.reportId,
      amountCents: pending.amountCents,
      createdAt: input.at,
    })
  );
  return ok({ ledger: released.ledger, creditedCents: pending.amountCents });
}

/**
 * Cancel a report's pending reward: it stops counting as pending and can
 * never become available. No pending reward / already cancelled -> no-op.
 * A released reward cannot be cancelled here.
 */
export function cancelPendingReward(
  ledger: Ledger,
  input: { citizenId: string; reportId: string; at: IsoTimestamp }
): Result<Ledger> {
  const state = getRewardState(ledger, input.reportId);
  if (state === "AVAILABLE") {
    return fail("REPORT_ALREADY_RESOLVED", `Reward for report ${input.reportId} was already released.`);
  }
  if (state !== "PENDING") return ok(ledger);
  const pending = findByKey(ledger, key.pending(input.reportId))!;
  return ok(
    appendOnce(
      ledger,
      entry("REWARD_VOIDED", key.voided(input.reportId), {
        citizenId: input.citizenId,
        reportId: input.reportId,
        amountCents: pending.amountCents,
        createdAt: input.at,
      })
    ).ledger
  );
}

/**
 * Apply an enforcement outcome's reward effect to the ledger.
 * RELEASE_PENDING (CHARGE_ISSUED): pending -> available, once.
 * CANCEL_PENDING (every other outcome, including the ones whose citizen
 * STATUS is unresolved): pending cancelled, €0 credited.
 */
export function applyOutcomeToLedger(
  ledger: Ledger,
  consequence: CitizenConsequence,
  input: { citizenId: string; reportId: string; at: IsoTimestamp }
): Result<{ ledger: Ledger; creditedCents: Cents }> {
  if (consequence.reward === "RELEASE_PENDING") return releasePendingReward(ledger, input);
  const cancelled = cancelPendingReward(ledger, input);
  return cancelled.ok ? ok({ ledger: cancelled.value, creditedCents: 0 }) : cancelled;
}

export function calculateBalances(ledger: Ledger, citizenId: string): Balances {
  const mine = ledger.filter((e) => e.citizenId === citizenId);
  const sum = (type: RewardLedgerEntryType) =>
    mine.filter((e) => e.type === type).reduce((total, e) => total + e.amountCents, 0);

  const pendingCents = mine
    .filter((e) => e.type === "REWARD_PENDING" && e.reportId && getRewardState(mine, e.reportId) === "PENDING")
    .reduce((total, e) => total + e.amountCents, 0);
  const requested = sum("WITHDRAWAL_REQUESTED");
  const paid = sum("WITHDRAWAL_PAID");

  return {
    availableCents: sum("REWARD_RELEASED") - requested,
    pendingCents,
    paidOutCents: paid,
    withdrawalsInFlightCents: requested - paid,
  };
}

export function calculateAvailableBalance(ledger: Ledger, citizenId: string): Cents {
  return calculateBalances(ledger, citizenId).availableCents;
}

/** Withdrawal rules from the Withdraw Money spec. Pending money is never withdrawable. */
export function validateWithdrawal(ledger: Ledger, citizenId: string, amountCents: Cents): Result<true> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return fail("INVALID_AMOUNT", "Withdrawal amount must be a positive amount in whole cents.");
  }
  if (amountCents < MIN_WITHDRAWAL_AMOUNT_CENTS) {
    return fail("BELOW_MINIMUM", `Minimum withdrawal is ${MIN_WITHDRAWAL_AMOUNT_CENTS} cents.`);
  }
  if (amountCents > calculateAvailableBalance(ledger, citizenId)) {
    return fail("INSUFFICIENT_AVAILABLE_BALANCE", "Withdrawal exceeds the available balance.");
  }
  return ok(true);
}

/**
 * Request a (simulated) withdrawal. Reduces available immediately; it is NOT
 * marked paid, because no real transfer happens in the MVP.
 * Idempotent per withdrawalId.
 */
export function requestWithdrawal(
  ledger: Ledger,
  input: { withdrawalId: string; citizenId: string; amountCents: Cents; at: IsoTimestamp }
): Result<{ ledger: Ledger; changed: boolean }> {
  const existing = findByKey(ledger, key.withdrawalRequested(input.withdrawalId));
  if (existing) {
    return existing.amountCents === input.amountCents
      ? ok({ ledger, changed: false })
      : fail("INVALID_AMOUNT", `Withdrawal ${input.withdrawalId} already exists with a different amount.`);
  }
  const valid = validateWithdrawal(ledger, input.citizenId, input.amountCents);
  if (!valid.ok) return valid;
  return ok({
    ledger: appendOnce(
      ledger,
      entry("WITHDRAWAL_REQUESTED", key.withdrawalRequested(input.withdrawalId), {
        citizenId: input.citizenId,
        withdrawalId: input.withdrawalId,
        amountCents: input.amountCents,
        createdAt: input.at,
      })
    ).ledger,
    changed: true,
  });
}

/** Future: called by a payout-provider integration once a transfer is confirmed. */
export function markWithdrawalPaid(ledger: Ledger, input: { withdrawalId: string; at: IsoTimestamp }): Result<Ledger> {
  const requested = findByKey(ledger, key.withdrawalRequested(input.withdrawalId));
  if (!requested) return fail("INVALID_TRANSITION", `Withdrawal ${input.withdrawalId} was never requested.`);
  return ok(
    appendOnce(
      ledger,
      entry("WITHDRAWAL_PAID", key.withdrawalPaid(input.withdrawalId), {
        citizenId: requested.citizenId,
        withdrawalId: input.withdrawalId,
        amountCents: requested.amountCents,
        createdAt: input.at,
      })
    ).ledger
  );
}
