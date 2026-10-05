// Backend repositories: read-only table queries (RLS-limited). Since T8.3 the
// app reads core data through get_core_snapshot() (src/backend/operations) and
// every write is a server function; these remain for targeted reads.
//
// There are deliberately NO write methods here: reports, cases, outcomes,
// rewards and notifications can only be changed by server functions that
// apply the domain rules atomically. Clients are denied direct writes.

import { EnforcementOutcome, Notification, Report, RewardLedgerEntry } from "../../domain";
import { getSupabaseClient } from "../supabase";
import { backendOk, BackendResult } from "../result";
import { MappedReport, reportFromRow } from "../mappers/reports";
import { caseFromRow, outcomeFromRow } from "../mappers/enforcement";
import { ledgerEntryFromRow, notificationFromRow } from "../mappers/rewards";
import {
  BackendBalanceRow,
  BackendCaseRow,
  BackendCitizenEvidenceRow,
  BackendLedgerRow,
  BackendNotificationRow,
  BackendOutcomeRow,
  BackendReportRow,
} from "../types";
import { ClientProvider, fromResponse, withSession } from "./base";

// ---------------------------------------------------------------------------
// Interfaces (what later milestones program against)

export interface ReportRepository {
  /** The signed-in citizen's reports, newest first, with their evidence. */
  listMine(): Promise<BackendResult<MappedReport[]>>;
  getByPublicNumber(publicNumber: number): Promise<BackendResult<MappedReport>>;
}

export type MappedCase = { uuid: string; reportUuid: string; case: ReturnType<typeof caseFromRow> };

export interface CaseRepository {
  /** Open cases the signed-in officer may see (RLS: active organization membership only). */
  listOpen(jurisdictionId: string): Promise<BackendResult<MappedCase[]>>;
  getById(caseUuid: string): Promise<BackendResult<MappedCase>>;
}

export interface NotificationRepository {
  listMine(): Promise<BackendResult<Notification[]>>;
  markRead(notificationIds: string[], at: string): Promise<BackendResult<{ updated: number }>>;
}

export type Balances = { pendingCents: number; availableCents: number; paidOutCents: number };

export interface RewardRepository {
  listMyLedger(): Promise<BackendResult<RewardLedgerEntry[]>>;
  getMyBalances(): Promise<BackendResult<Balances>>;
}

// ---------------------------------------------------------------------------
// Supabase implementations

type ReportWithEvidence = BackendReportRow & { report_evidence: BackendCitizenEvidenceRow[] | null };
const REPORT_SELECT = "*, report_evidence(*)";
const mapReport = (r: ReportWithEvidence) => reportFromRow(r, r.report_evidence ?? []);

export function createReportRepository(provider: ClientProvider = getSupabaseClient): ReportRepository {
  return {
    listMine: () =>
      withSession(provider, async ({ client, userId }) => {
        const res = fromResponse<ReportWithEvidence[]>(
          await client.from("reports").select(REPORT_SELECT).eq("citizen_id", userId).order("submitted_at", { ascending: false })
        );
        return res.ok ? backendOk(res.value.map(mapReport)) : res;
      }),
    getByPublicNumber: (publicNumber) =>
      withSession(provider, async ({ client }) => {
        const res = fromResponse<ReportWithEvidence>(
          await client.from("reports").select(REPORT_SELECT).eq("public_report_number", publicNumber).maybeSingle()
        );
        return res.ok ? backendOk(mapReport(res.value)) : res;
      }),
  };
}

type CaseWithLinks = BackendCaseRow & {
  reports: { public_report_number: number } | null;
  enforcement_outcomes: BackendOutcomeRow[] | BackendOutcomeRow | null;
};
const CASE_SELECT = "*, reports(public_report_number), enforcement_outcomes(*)";
function mapCase(row: CaseWithLinks): MappedCase {
  const raw = Array.isArray(row.enforcement_outcomes) ? row.enforcement_outcomes[0] : row.enforcement_outcomes;
  const outcome: EnforcementOutcome | undefined = raw ? outcomeFromRow(raw) : undefined;
  const reportId = row.reports ? String(row.reports.public_report_number) : row.report_id;
  return { uuid: row.id, reportUuid: row.report_id, case: caseFromRow(row, { reportId, outcome }) };
}

export function createCaseRepository(provider: ClientProvider = getSupabaseClient): CaseRepository {
  return {
    listOpen: (jurisdictionId) =>
      withSession(provider, async ({ client }) => {
        const res = fromResponse<CaseWithLinks[]>(
          await client.from("officer_cases").select(CASE_SELECT).eq("jurisdiction_id", jurisdictionId).neq("status", "COMPLETED").order("created_at", { ascending: false })
        );
        return res.ok ? backendOk(res.value.map(mapCase)) : res;
      }),
    getById: (caseUuid) =>
      withSession(provider, async ({ client }) => {
        const res = fromResponse<CaseWithLinks>(await client.from("officer_cases").select(CASE_SELECT).eq("id", caseUuid).maybeSingle());
        return res.ok ? backendOk(mapCase(res.value)) : res;
      }),
  };
}

type NotificationWithReport = BackendNotificationRow & { reports: { public_report_number: number } | null };

export function createNotificationRepository(provider: ClientProvider = getSupabaseClient): NotificationRepository {
  return {
    listMine: () =>
      withSession(provider, async ({ client, userId }) => {
        const res = fromResponse<NotificationWithReport[]>(
          await client.from("notifications").select("*, reports(public_report_number)").eq("recipient_id", userId).order("created_at", { ascending: false })
        );
        if (!res.ok) return res;
        return backendOk(
          res.value.map((n) => notificationFromRow(n, () => (n.reports ? String(n.reports.public_report_number) : undefined)))
        );
      }),
    markRead: (ids, at) =>
      withSession(provider, async ({ client, userId }) => {
        if (ids.length === 0) return backendOk({ updated: 0 });
        const res = fromResponse<{ id: string }[]>(
          await client.from("notifications").update({ read_at: at }).in("id", ids).eq("recipient_id", userId).is("read_at", null).select("id")
        );
        return res.ok ? backendOk({ updated: res.value.length }) : res;
      }),
  };
}

type LedgerWithReport = BackendLedgerRow & { reports: { public_report_number: number } | null };

export function createRewardRepository(provider: ClientProvider = getSupabaseClient): RewardRepository {
  return {
    listMyLedger: () =>
      withSession(provider, async ({ client, userId }) => {
        const res = fromResponse<LedgerWithReport[]>(
          await client.from("reward_ledger").select("*, reports(public_report_number)").eq("citizen_id", userId).order("created_at", { ascending: true })
        );
        if (!res.ok) return res;
        return backendOk(res.value.map((e) => ledgerEntryFromRow(e, () => (e.reports ? String(e.reports.public_report_number) : undefined))));
      }),
    getMyBalances: () =>
      withSession(provider, async ({ client, userId }) => {
        const res = await client.from("reward_balances").select("*").eq("citizen_id", userId).maybeSingle();
        if (res.error) return fromResponse(res as never);
        const row = res.data as BackendBalanceRow | null;
        // No ledger rows yet -> zero balances (not an error).
        return backendOk({
          pendingCents: Number(row?.pending_cents ?? 0),
          availableCents: Number(row?.available_cents ?? 0),
          paidOutCents: Number(row?.paid_out_cents ?? 0),
        });
      }),
  };
}
