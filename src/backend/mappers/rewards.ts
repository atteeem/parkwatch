// Reward ledger and notifications: domain <-> backend. The ledger stays
// append-only and idempotent: the domain idempotency key is stored as-is, so
// replaying an operation hits the unique constraint instead of paying twice.

import { Notification, RewardLedgerEntry } from "../../domain";
import { backendFail, backendOk, BackendResult } from "../result";
import { AppRole, BackendLedgerInsert, BackendLedgerRow, BackendNotificationInsert, BackendNotificationRow, Uuid } from "../types";
import { isUuid, opt, requireCents } from "./common";

/** Reverse lookup used when reading rows that reference reports by uuid. */
export type ReportIdLookup = (reportUuid: Uuid) => string | undefined;

export function ledgerEntryToInsert(
  entry: RewardLedgerEntry,
  refs: { citizenUuid: Uuid; reportUuid?: Uuid; withdrawalUuid?: Uuid }
): BackendResult<BackendLedgerInsert> {
  const cents = requireCents(entry.amountCents, "Ledger amount");
  if (!cents.ok) return cents;
  if (!isUuid(refs.citizenUuid)) return backendFail("INVALID_DATA", "Unknown citizen.");
  const isReward = entry.type === "REWARD_PENDING" || entry.type === "REWARD_RELEASED" || entry.type === "REWARD_VOIDED";
  const isWithdrawal = entry.type === "WITHDRAWAL_REQUESTED" || entry.type === "WITHDRAWAL_PAID";
  if (isReward && !isUuid(refs.reportUuid)) return backendFail("INVALID_DATA", "A reward entry needs its report.");
  if (isWithdrawal && !isUuid(refs.withdrawalUuid)) return backendFail("INVALID_DATA", "A withdrawal entry needs its withdrawal id.");
  if (!entry.idempotencyKey.trim()) return backendFail("INVALID_DATA", "Missing idempotency key.");
  return backendOk({
    citizen_id: refs.citizenUuid,
    entry_type: entry.type,
    amount_cents: cents.value,
    report_id: isReward ? refs.reportUuid! : null,
    withdrawal_id: isWithdrawal ? refs.withdrawalUuid! : null,
    idempotency_key: entry.idempotencyKey,
    created_at: entry.createdAt,
  });
}

export function ledgerEntryFromRow(row: BackendLedgerRow, reportIdOf: ReportIdLookup): RewardLedgerEntry {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    citizenId: row.citizen_id,
    type: row.entry_type,
    amountCents: row.amount_cents,
    ...(row.report_id ? { reportId: reportIdOf(row.report_id) ?? row.report_id } : {}),
    ...(row.withdrawal_id ? { withdrawalId: row.withdrawal_id } : {}),
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Notifications

export function notificationToInsert(
  n: Notification,
  refs: { recipientUuid: Uuid; reportUuid?: Uuid; caseUuid?: Uuid }
): BackendResult<BackendNotificationInsert> {
  if (!isUuid(refs.recipientUuid)) return backendFail("INVALID_DATA", "Unknown recipient.");
  if (n.reportId && !isUuid(refs.reportUuid)) return backendFail("INVALID_DATA", "Notification report link is missing.");
  if (n.caseId && !isUuid(refs.caseUuid)) return backendFail("INVALID_DATA", "Notification case link is missing.");
  if (n.amountCents !== undefined) {
    const cents = requireCents(n.amountCents, "Notification amount");
    if (!cents.ok) return cents;
  }
  const system = n.type === "SYSTEM";
  return backendOk({
    recipient_id: refs.recipientUuid,
    recipient_role: n.recipient.role as AppRole,
    type: n.type,
    report_id: n.reportId ? refs.reportUuid! : null,
    case_id: n.caseId ? refs.caseUuid! : null,
    amount_cents: n.amountCents ?? null,
    title: system ? n.title ?? null : null,
    body: system ? n.body ?? null : null,
    display_hint: system ? n.displayHint ?? null : null,
    idempotency_key: n.idempotencyKey,
    created_at: n.createdAt,
  });
}

export function notificationFromRow(row: BackendNotificationRow, reportIdOf: ReportIdLookup): Notification {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    recipient: { role: row.recipient_role === "CITIZEN" ? "CITIZEN" : "OFFICER", accountId: row.recipient_id },
    type: row.type,
    createdAt: row.created_at,
    readAt: opt(row.read_at),
    ...(row.report_id ? { reportId: reportIdOf(row.report_id) ?? row.report_id } : {}),
    ...(row.case_id ? { caseId: row.case_id } : {}),
    ...(row.amount_cents !== null ? { amountCents: row.amount_cents } : {}),
    ...(row.title !== null ? { title: row.title } : {}),
    ...(row.body !== null ? { body: row.body } : {}),
    ...(row.display_hint !== null ? { displayHint: row.display_hint } : {}),
  };
}
