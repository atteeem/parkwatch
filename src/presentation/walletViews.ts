// Wallet / Earnings view models derived ONLY from the reward ledger.
// No hardcoded transactions, no invented growth figures.

import { getRewardState, RewardLedgerEntry } from "../domain";
import { ParkWatchState } from "../store/state";
import { formatDateTime } from "./time";
import { formatEuros } from "./viewModels";

export type WalletActivityItem = {
  id: string;
  kind: "REWARD_AVAILABLE" | "REWARD_PENDING" | "REWARD_CANCELLED" | "WITHDRAWAL_REQUESTED" | "WITHDRAWAL_PAID" | "OPENING_BALANCE";
  title: string;
  subtitle: string;
  amountText: string;
  statusText: string;
  tone: "positive" | "negative" | "pending" | "neutral";
  at: string;
};

/**
 * One row per reward lifecycle (its current state) and per withdrawal (its
 * current state), plus any opening balance. Newest first.
 */
export function selectWalletActivity(state: ParkWatchState, citizenId: string): WalletActivityItem[] {
  const mine = state.ledger.filter((e) => e.citizenId === citizenId);
  const items: WalletActivityItem[] = [];
  const plateOf = (reportId?: string) =>
    state.reports.find((r) => r.id === reportId)?.vehicle?.plate.raw ?? (reportId ? `#${reportId}` : "");

  for (const pending of mine.filter((e) => e.type === "REWARD_PENDING")) {
    const reportId = pending.reportId!;
    const rewardState = getRewardState(mine, reportId);
    const latest = [...mine].reverse().find((e) => e.reportId === reportId)!;
    const amount = formatEuros(pending.amountCents);
    if (rewardState === "AVAILABLE") {
      items.push({ id: latest.id, kind: "REWARD_AVAILABLE", title: "Reward added", subtitle: `${plateOf(reportId)} • Verified report`, amountText: `+${amount}`, statusText: "Available", tone: "positive", at: latest.createdAt });
    } else if (rewardState === "PENDING") {
      items.push({ id: latest.id, kind: "REWARD_PENDING", title: "Reward pending", subtitle: `${plateOf(reportId)} • Under review`, amountText: amount, statusText: "Pending", tone: "pending", at: latest.createdAt });
    } else {
      items.push({ id: latest.id, kind: "REWARD_CANCELLED", title: "No reward", subtitle: `${plateOf(reportId)} • Not eligible`, amountText: "—", statusText: "Cancelled", tone: "neutral", at: latest.createdAt });
    }
  }

  for (const req of mine.filter((e) => e.type === "WITHDRAWAL_REQUESTED")) {
    const paid = mine.find((e) => e.type === "WITHDRAWAL_PAID" && e.withdrawalId === req.withdrawalId);
    const amount = `-${formatEuros(req.amountCents)}`;
    items.push(
      paid
        ? { id: paid.id, kind: "WITHDRAWAL_PAID", title: "Withdrawal completed", subtitle: "Bank account", amountText: amount, statusText: "Paid out", tone: "negative", at: paid.createdAt }
        : { id: req.id, kind: "WITHDRAWAL_REQUESTED", title: "Withdrawal requested", subtitle: "Bank account", amountText: amount, statusText: "Requested", tone: "pending", at: req.createdAt }
    );
  }

  for (const o of mine.filter((e) => e.type === "OPENING_BALANCE")) {
    items.push({ id: o.id, kind: "OPENING_BALANCE", title: "Opening balance", subtitle: "Carried over", amountText: `+${formatEuros(o.amountCents)}`, statusText: "Available", tone: "positive", at: o.createdAt });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export const activityDateLabel = (item: WalletActivityItem) => formatDateTime(item.at);

export type EarningsPeriod = "ALL_TIME" | "TODAY" | "THIS_WEEK" | "THIS_MONTH";

export const EARNINGS_PERIODS: { key: EarningsPeriod; label: string }[] = [
  { key: "ALL_TIME", label: "All time" },
  { key: "TODAY", label: "Today" },
  { key: "THIS_WEEK", label: "This week" },
  { key: "THIS_MONTH", label: "This month" },
];

export type EarningsSummary = {
  totalCents: number;
  totalText: string;
  verifiedCount: number;
  /** Released reward cents per equal time bucket across the period (oldest first). */
  buckets: number[];
};

function periodStart(period: EarningsPeriod, now: Date, released: RewardLedgerEntry[]): Date {
  const d = new Date(now);
  if (period === "TODAY") return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === "THIS_WEEK") {
    const day = (d.getDay() + 6) % 7; // Monday = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  }
  if (period === "THIS_MONTH") return new Date(d.getFullYear(), d.getMonth(), 1);
  const earliest = released.map((e) => Date.parse(e.createdAt)).sort((a, b) => a - b)[0];
  return new Date(earliest ?? now.getTime() - 30 * 24 * 3600_000);
}

/** Rewards that became AVAILABLE within the period (opening balances are not earnings). */
export function selectEarnings(
  state: ParkWatchState,
  citizenId: string,
  period: EarningsPeriod,
  now: Date,
  bucketCount = 12
): EarningsSummary {
  const released = state.ledger.filter((e) => e.citizenId === citizenId && e.type === "REWARD_RELEASED");
  const start = periodStart(period, now, released).getTime();
  const end = now.getTime();
  const inPeriod = released.filter((e) => {
    const t = Date.parse(e.createdAt);
    return t >= start && t <= end;
  });
  const span = Math.max(end - start, 1);
  const buckets = Array.from({ length: bucketCount }, () => 0);
  for (const e of inPeriod) {
    const idx = Math.min(bucketCount - 1, Math.floor(((Date.parse(e.createdAt) - start) / span) * bucketCount));
    buckets[idx] += e.amountCents;
  }
  const totalCents = inPeriod.reduce((s, e) => s + e.amountCents, 0);
  return { totalCents, totalText: formatEuros(totalCents), verifiedCount: inPeriod.length, buckets };
}
