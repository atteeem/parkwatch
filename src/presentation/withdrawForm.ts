// Withdraw Money form logic (pure). Amounts are whole cents internally; the
// rules themselves (minimum, available-only, pending excluded) come from the
// domain ledger via the injected `validate`.

import { DomainError, Result } from "../domain";
import { describeDomainError } from "./errors";

/** "25", "25.5", "25,50", "€ 25.00" -> cents. Anything else (letters, >2 decimals, negative) -> null. */
export function parseEuroAmount(text: string): number | null {
  const cleaned = text.replace(/€/g, "").replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const formatAmountInput = (cents: number) => (cents / 100).toFixed(2);

/** 25% / 50% / Max of the AVAILABLE balance only, rounded down to whole cents. Never inflated to a minimum. */
export function withdrawPresets(availableCents: number): { label: string; cents: number }[] {
  const safe = Math.max(0, Math.floor(availableCents));
  return [
    { label: "25%", cents: Math.floor(safe * 0.25) },
    { label: "50%", cents: Math.floor(safe * 0.5) },
    { label: "Max", cents: safe },
  ];
}

/** Starting amount: €25 if available, otherwise the whole available balance (may be below the minimum). */
export const initialWithdrawCents = (availableCents: number) => Math.max(0, Math.min(2500, availableCents));

export type WithdrawCheck = { ok: true; cents: number } | { ok: false; message: string };

export function checkWithdrawalInput(text: string, validate: (cents: number) => Result<true>): WithdrawCheck {
  const cents = parseEuroAmount(text);
  if (cents === null || cents <= 0) return { ok: false, message: "Enter a valid amount." };
  const r = validate(cents);
  return r.ok ? { ok: true, cents } : { ok: false, message: describeDomainError(r.error).message };
}

/**
 * Confirm: validate, request, and only on success call onSuccess (which
 * navigates). A refused request calls onError and never onSuccess.
 */
export function confirmWithdrawal(
  text: string,
  deps: {
    validate: (cents: number) => Result<true>;
    withdraw: (cents: number) => Result<{ withdrawalId: string }>;
    onSuccess: (withdrawalId: string) => void;
    onError: (message: string) => void;
  }
): "requested" | "refused" {
  const check = checkWithdrawalInput(text, deps.validate);
  if (!check.ok) {
    deps.onError(check.message);
    return "refused";
  }
  const r = deps.withdraw(check.cents);
  if (!r.ok) {
    deps.onError(describeDomainError(r.error as DomainError).message);
    return "refused";
  }
  deps.onSuccess(r.value.withdrawalId);
  return "requested";
}
