// Operations console (T9.0) data contract. READ-ONLY oversight for active
// SUPERVISOR/ADMIN members, scoped to their own organization(s).
//
// Both implementations return these shapes:
//   * BACKEND: server functions admin_* (scope derived from auth.uid()),
//     server-side filtering and pagination; evidence via signed URLs.
//   * LOCAL_DEMO: computed from the complete local store (one demo org).
//
// Citizens appear only as a pseudonymous reference ("C-xxxxxxxx").

import type { CaseStatus, CitizenReportStatus, EnforcementOutcomeCode, ReportPriority, Result } from "../domain";
import type { GalleryItem } from "../presentation/evidenceGallery";

export type ActorRole = "CITIZEN" | "OFFICER" | "SUPERVISOR" | "ADMIN" | "SYSTEM";
export type RewardEntryType = "OPENING_BALANCE" | "REWARD_PENDING" | "REWARD_RELEASED" | "REWARD_VOIDED" | "WITHDRAWAL_REQUESTED" | "WITHDRAWAL_PAID";
/** One reward per report, derived from its ledger entries (never a sum of rows). */
export type RewardState = "NONE" | "PENDING" | "AVAILABLE" | "VOIDED";
export type AuditEntityType = "report" | "officer_case" | "inspection" | "evidence" | "outcome" | "reward";

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_AUDIT_PAGE_SIZE = 50;

export type AdminPage<T> = { rows: T[]; total: number; nextOffset: number | null };

export type AdminIdentity = {
  role: "SUPERVISOR" | "ADMIN";
  displayName: string;
  organizations: { id: string; name: string; memberRole: string }[];
};

export type AdminOverview = {
  reportsUnderReview: number;
  reportsReceivedToday: number;
  casesActive: number;
  casesNew: number;
  casesAssigned: number;
  casesEnRoute: number;
  /** ON_SITE + INSPECTION */
  casesOnSite: number;
  casesHighPriorityOpen: number;
  completedToday: number;
  chargesToday: number;
  rejectedToday: number;
  noChargeToday: number;
  rewardsPendingCount: number;
  rewardsPendingCents: number;
  rewardsAvailableCount: number;
  rewardsAvailableCents: number;
  /** Oldest first; "YYYY-MM-DD" in the console's time zone. */
  last7Days: { day: string; received: number; completed: number }[];
};

export type AdminReportFilter = {
  status?: CitizenReportStatus;
  priority?: ReportPriority;
  caseState?: "active" | "completed";
  from?: string;
  to?: string;
  /** Report number (e.g. "100023" or "#100023") or a plate fragment. */
  search?: string;
};

export type AdminReportRow = {
  id: string;
  publicNumber: number;
  status: CitizenReportStatus;
  priority: ReportPriority;
  submittedAt: string;
  receivedAt?: string;
  plate?: string;
  violationType: string;
  locationAddress: string;
  caseId?: string;
  caseStatus?: CaseStatus;
  outcomeCode?: EnforcementOutcomeCode;
  assignedOfficerName?: string;
};

export type AdminAuditEvent = {
  id: string;
  createdAt: string;
  actorRole: ActorRole;
  actorLabel: string;
  source: string;
  entityType: AuditEntityType;
  eventType: string;
  publicNumber?: number;
  metadata: Record<string, unknown>;
};

export type AdminLedgerEntry = { id: string; entryType: RewardEntryType; amountCents: number; createdAt: string };

export type AdminCaseTimeline = {
  createdAt: string;
  assignedAt?: string;
  enRouteAt?: string;
  onSiteAt?: string;
  inspectionStartedAt?: string;
  completedAt?: string;
};

export type AdminOutcome = {
  code: EnforcementOutcomeCode;
  decidedAt: string;
  decidedByName?: string;
  /** Present only for CHARGE_ISSUED. */
  parkingChargeCents?: number;
  notes?: string;
};

export type AdminReportDetail = {
  id: string;
  publicNumber: number;
  status: CitizenReportStatus;
  priority: ReportPriority;
  violationType: string;
  plate?: string;
  vehicle?: string;
  locationAddress: string;
  point?: { latitude: number; longitude: number };
  locationSource?: "GPS" | "MAP_SELECTED";
  accuracyMeters?: number;
  notes: string;
  observedAt: string;
  submittedAt: string;
  receivedAt?: string;
  citizenRef: string;
  evidence: GalleryItem[];
  caseInfo?: { id: string; status: CaseStatus; priority: ReportPriority; assignedOfficerName?: string } & AdminCaseTimeline;
  outcome?: AdminOutcome;
  rewardState: RewardState;
  ledger: AdminLedgerEntry[];
  audit: AdminAuditEvent[];
};

export type AdminCaseFilter = {
  status?: CaseStatus;
  officerId?: string;
  outcome?: EnforcementOutcomeCode;
  priority?: ReportPriority;
  from?: string;
  to?: string;
  search?: string;
};

export type AdminCaseRow = {
  id: string;
  publicNumber: number;
  status: CaseStatus;
  priority: ReportPriority;
  assignedOfficerId?: string;
  assignedOfficerName?: string;
  locationAddress: string;
  plate?: string;
  violationType: string;
  createdAt: string;
  completedAt?: string;
  outcomeCode?: EnforcementOutcomeCode;
  decidedAt?: string;
  parkingChargeCents?: number;
};

export type AdminCheck = { key: string; answer: boolean | null; answeredAt?: string };

export type AdminCaseDetail = {
  id: string;
  status: CaseStatus;
  priority: ReportPriority;
  assignedOfficerName?: string;
  timeline: AdminCaseTimeline;
  report: {
    id: string;
    publicNumber: number;
    status: CitizenReportStatus;
    violationType: string;
    plate?: string;
    vehicle?: string;
    locationAddress: string;
    point?: { latitude: number; longitude: number };
    locationSource?: "GPS" | "MAP_SELECTED";
    notes: string;
    observedAt: string;
    receivedAt?: string;
    citizenRef: string;
  };
  citizenEvidence: GalleryItem[];
  officerEvidence: GalleryItem[];
  inspection?: { startedAt: string; completedAt?: string; notes: string; plateConfirmedAt?: string; checks: AdminCheck[] };
  outcome?: AdminOutcome;
  rewardState: RewardState;
  audit: AdminAuditEvent[];
};

export type AdminOfficer = {
  userId: string;
  displayName?: string;
  profileRole: string;
  memberRole: "OFFICER" | "SUPERVISOR" | "ADMIN";
  active: boolean;
  organizationName: string;
  activeCases: number;
  completedThisMonth: number;
};

export type AdminRewardFilter = { entryType?: RewardEntryType; state?: Exclude<RewardState, "NONE">; search?: string; from?: string; to?: string };

export type AdminRewardRow = {
  id: string;
  createdAt: string;
  entryType: RewardEntryType;
  amountCents: number;
  publicNumber: number;
  citizenRef: string;
  rewardState: RewardState;
};

export type AdminRewardSummary = {
  pendingCount: number;
  availableCount: number;
  voidedCount: number;
  pendingCents: number;
  availableCents: number;
};

export type AdminAuditFilter = { actorRole?: ActorRole; entityType?: AuditEntityType; eventType?: string; ref?: string; from?: string; to?: string };

/** The console's data access. Every call is read-only. */
export type AdminApi = {
  whoami(): Promise<Result<AdminIdentity>>;
  overview(): Promise<Result<AdminOverview>>;
  pageReports(filter: AdminReportFilter, offset: number): Promise<Result<AdminPage<AdminReportRow>>>;
  /** null = not found OR outside the caller's organization (indistinguishable). */
  getReport(publicNumber: number): Promise<Result<AdminReportDetail | null>>;
  pageCases(filter: AdminCaseFilter, offset: number): Promise<Result<AdminPage<AdminCaseRow>>>;
  getCase(caseId: string): Promise<Result<AdminCaseDetail | null>>;
  listOfficers(): Promise<Result<AdminOfficer[]>>;
  pageRewards(filter: AdminRewardFilter, offset: number): Promise<Result<AdminPage<AdminRewardRow> & { summary: AdminRewardSummary }>>;
  pageAudit(filter: AdminAuditFilter, offset: number): Promise<Result<AdminPage<AdminAuditEvent>>>;
};
