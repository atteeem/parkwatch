// Core ParkWatch domain types (MVP).
//
// Conventions:
// - Timestamps are ISO-8601 strings (`IsoTimestamp`). UI strings such as
//   "2m ago" or "Today" are produced by the presentation layer only.
// - Money is integer cents.
// - Ids are opaque strings supplied by the caller, so domain functions stay
//   pure and deterministic.

export type IsoTimestamp = string;
export type Cents = number;

export type GeoPoint = { latitude: number; longitude: number; accuracyMeters?: number };

// ---------------------------------------------------------------------------
// Evidence

export const CITIZEN_EVIDENCE_TYPES = ["FRONT", "SIDE", "REAR"] as const;
export const OFFICER_EVIDENCE_TYPES = [
  "VEHICLE_OVERVIEW",
  "LICENSE_PLATE",
  "PARKING_SIGN",
  "VIOLATION_CONTEXT",
] as const;

/** Required citizen photo angles. */
export type CitizenEvidenceType = (typeof CITIZEN_EVIDENCE_TYPES)[number];
/** Required officer photo targets. */
export type OfficerEvidenceType = (typeof OFFICER_EVIDENCE_TYPES)[number];

export type EvidenceSource = "CITIZEN" | "OFFICER";

/** Optional citizen extras from the Add Details step (not required evidence). */
export type CitizenAttachmentType = "ATTACHMENT";

export type Evidence =
  | {
      id: string;
      source: "CITIZEN";
      type: CitizenEvidenceType | CitizenAttachmentType;
      uri: string;
      capturedAt: IsoTimestamp;
      /** Optional; not captured in the MVP. */
      location?: GeoPoint;
    }
  | {
      id: string;
      source: "OFFICER";
      type: OfficerEvidenceType;
      uri: string;
      capturedAt: IsoTimestamp;
      location?: GeoPoint;
    };

export type CitizenEvidence = Extract<Evidence, { source: "CITIZEN" }>;
export type OfficerEvidence = Extract<Evidence, { source: "OFFICER" }>;

// ---------------------------------------------------------------------------
// Vehicle (MVP: mock-detected; later OCR + citizen confirmation)

export type VehicleInfoSource = "MOCK_DETECTED" | "OCR_DETECTED" | "CITIZEN_CONFIRMED";

export type VehicleInfo = {
  plate: string;
  make?: string;
  model?: string;
  color?: string;
  source: VehicleInfoSource;
};

// ---------------------------------------------------------------------------
// Citizen report

/** The only Citizen-visible statuses in the current MVP designs. */
export type CitizenReportStatus = "UNDER_REVIEW" | "VERIFIED" | "REJECTED";

export type ReportLocation = { address: string; coordinates?: GeoPoint };

export type ReportDraft = {
  /** Stable per draft; used to make submission idempotent. */
  draftId: string;
  photos: Partial<Record<CitizenEvidenceType, CitizenEvidence>>;
  violationId?: string;
  location: ReportLocation;
  /** When the citizen observed the violation; defaults to capture time. */
  observedAt?: IsoTimestamp;
  notes: string;
  attachments: CitizenEvidence[];
};

export type ReportPriority = "NORMAL" | "MEDIUM" | "HIGH";

export type Report = {
  id: string;
  /** The draft this report was created from (submission idempotency). */
  sourceDraftId: string;
  citizenId: string;
  status: CitizenReportStatus;
  violationId: string;
  location: ReportLocation;
  observedAt: IsoTimestamp;
  submittedAt: IsoTimestamp;
  notes: string;
  evidence: CitizenEvidence[];
  vehicle?: VehicleInfo;
  priority: ReportPriority;
  caseId?: string;
  /** Set when a resolved enforcement outcome changed the citizen status. */
  resolvedAt?: IsoTimestamp;
};

// ---------------------------------------------------------------------------
// Enforcement outcome

export const ENFORCEMENT_OUTCOME_CODES = [
  "CHARGE_ISSUED",
  "REPORT_REJECTED",
  "VEHICLE_MOVED",
  "VALID_PERMIT",
  "DUPLICATE",
  "OTHER",
] as const;

export type EnforcementOutcomeCode = (typeof ENFORCEMENT_OUTCOME_CODES)[number];

export type EnforcementOutcome = {
  code: EnforcementOutcomeCode;
  decidedAt: IsoTimestamp;
  officerId: string;
  /** Present only for CHARGE_ISSUED. */
  chargeAmountCents?: Cents;
  notes?: string;
};

// ---------------------------------------------------------------------------
// Officer case

/**
 * Officer-side case lifecycle. Deliberately separate from
 * CitizenReportStatus: internal officer states are never shown to citizens.
 * There is no case-level REJECTED status; a rejected report is a COMPLETED
 * case whose outcome code is REPORT_REJECTED.
 */
export type CaseStatus = "NEW" | "ASSIGNED" | "EN_ROUTE" | "ON_SITE" | "INSPECTION" | "COMPLETED";

export type CaseEvent = {
  type: "CREATED" | "STATUS_CHANGED";
  at: IsoTimestamp;
  from?: CaseStatus;
  to: CaseStatus;
  officerId?: string;
};

export type OfficerCase = {
  id: string;
  reportId: string;
  status: CaseStatus;
  priority: ReportPriority;
  /** Mock in the MVP; real routing later. */
  distanceMeters?: number;
  assignedOfficerId?: string;
  createdAt: IsoTimestamp;
  /** First time the case entered each status. */
  statusTimestamps: Partial<Record<CaseStatus, IsoTimestamp>>;
  outcome?: EnforcementOutcome;
  completedAt?: IsoTimestamp;
  /** Append-only audit trail. */
  events: CaseEvent[];
};

// ---------------------------------------------------------------------------
// Inspection

export type ChecklistKey = "vehiclePresent" | "plateMatches" | "violationConfirmed" | "restrictionVerified";

export const CHECKLIST_KEYS: readonly ChecklistKey[] = [
  "vehiclePresent",
  "plateMatches",
  "violationConfirmed",
  "restrictionVerified",
];

/** null = not yet answered; false = officer explicitly answered "no". */
export type InspectionChecklist = Record<ChecklistKey, boolean | null>;

export type Inspection = {
  id: string;
  caseId: string;
  startedAt: IsoTimestamp;
  checklist: InspectionChecklist;
  /** Officer evidence by required slot. "Evidence captured" is derived. */
  officerEvidence: Partial<Record<OfficerEvidenceType, OfficerEvidence>>;
  /** Plate check was confirmed via the (simulated) scan control. */
  plateScanSimulatedAt?: IsoTimestamp;
  notes: string;
  outcome?: EnforcementOutcome;
  completedAt?: IsoTimestamp;
};

// ---------------------------------------------------------------------------
// Reward ledger (append-only)

export type RewardLedgerEntryType =
  /** Estimated reward recorded at submission; counts as "pending". */
  | "REWARD_PENDING"
  /** Pending reward released to available after a qualifying outcome. */
  | "REWARD_RELEASED"
  /** Pending reward cancelled (e.g. report rejected). */
  | "REWARD_VOIDED"
  /** Citizen requested a payout; reduces available immediately. */
  | "WITHDRAWAL_REQUESTED"
  /** Payout confirmed by a payment provider (future; not produced by the MVP). */
  | "WITHDRAWAL_PAID";

export type RewardLedgerEntry = {
  id: string;
  /** Unique per logical operation; appending a duplicate key is a no-op. */
  idempotencyKey: string;
  citizenId: string;
  type: RewardLedgerEntryType;
  /** Always positive; the entry type determines the effect on balances. */
  amountCents: Cents;
  reportId?: string;
  withdrawalId?: string;
  createdAt: IsoTimestamp;
};

// ---------------------------------------------------------------------------
// Notifications

export type NotificationRecipient = { role: "CITIZEN" | "OFFICER"; accountId: string };

export type NotificationType =
  | "REPORT_UNDER_REVIEW"
  | "REPORT_VERIFIED"
  | "REPORT_REJECTED"
  | "WITHDRAWAL_REQUESTED"
  | "CASE_ACCEPTED"
  | "PARKING_CHARGE_ISSUED"
  | "CASE_CLOSED_WITHOUT_CHARGE"
  /** Free-form/system messages from seed data (title/body provided). */
  | "SYSTEM";

export type Notification = {
  id: string;
  /** Prevents duplicates when the same domain event is processed twice. */
  idempotencyKey: string;
  recipient: NotificationRecipient;
  type: NotificationType;
  createdAt: IsoTimestamp;
  readAt?: IsoTimestamp;
  reportId?: string;
  caseId?: string;
  amountCents?: Cents;
  /** Only for SYSTEM notifications; other types get copy from presentation. */
  title?: string;
  body?: string;
};
