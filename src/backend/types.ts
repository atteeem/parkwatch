// Backend row types: exact mirrors of supabase/migrations (snake_case).
// They stay inside src/backend; the rest of the app uses domain types and the
// mappers in src/backend/mappers convert between the two.

import {
  CaptureSource,
  CaseStatus,
  ChecklistKey,
  CitizenReportStatus,
  EnforcementOutcomeCode,
  EventSource,
  NotificationType,
  OfficerEvidenceType,
  ReportPriority,
  RewardLedgerEntryType,
  VehicleInfoSource,
} from "../domain";

export type Uuid = string;
export type Timestamptz = string;

export type AppRole = "CITIZEN" | "OFFICER" | "SUPERVISOR" | "ADMIN";
export type BackendActorRole = AppRole | "SYSTEM";

export type BackendProfileRow = {
  id: Uuid;
  role: AppRole;
  display_name: string;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type BackendReportRow = {
  id: Uuid;
  /** Human-readable number shown to citizens; NOT the primary key. */
  public_report_number: number;
  citizen_id: Uuid;
  source_draft_id: string;
  jurisdiction_id: string;
  status: CitizenReportStatus;
  priority: ReportPriority;
  violation_type: string;
  plate_raw: string | null;
  plate_normalized: string | null;
  plate_country: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_source: VehicleInfoSource | null;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  location_captured_at: Timestamptz | null;
  notes: string;
  observed_at: Timestamptz;
  submitted_at: Timestamptz;
  /** Trusted server receipt time (set by the database). */
  received_at: Timestamptz;
  resolved_at: Timestamptz | null;
  incident_id: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

/** Columns a citizen may insert (matches the column-level GRANT). */
export type BackendReportInsert = Pick<
  BackendReportRow,
  | "citizen_id" | "source_draft_id" | "jurisdiction_id" | "violation_type"
  | "plate_raw" | "plate_normalized" | "plate_country"
  | "vehicle_make" | "vehicle_model" | "vehicle_color" | "vehicle_source"
  | "location_address" | "latitude" | "longitude" | "location_accuracy_m" | "location_captured_at"
  | "notes" | "observed_at" | "submitted_at"
>;

export type CitizenEvidenceSlot = "FRONT" | "SIDE" | "REAR" | "ATTACHMENT";

/** Citizen report evidence. Distinct from officer evidence by table AND by the `slot` field. */
export type BackendCitizenEvidenceRow = {
  id: Uuid;
  report_id: Uuid;
  slot: CitizenEvidenceSlot;
  capture_source: CaptureSource;
  storage_path: string;
  captured_at: Timestamptz;
  created_at: Timestamptz;
};
export type BackendCitizenEvidenceInsert = Pick<BackendCitizenEvidenceRow, "report_id" | "slot" | "capture_source" | "storage_path" | "captured_at">;

/** Officer inspection evidence. Uses `evidence_type` (never `slot`) and only CAMERA/SEED. */
export type BackendOfficerEvidenceRow = {
  id: Uuid;
  inspection_id: Uuid;
  case_id: Uuid;
  evidence_type: OfficerEvidenceType;
  capture_source: Exclude<CaptureSource, "LIBRARY">;
  storage_path: string;
  captured_at: Timestamptz;
  created_at: Timestamptz;
};
export type BackendOfficerEvidenceInsert = Pick<
  BackendOfficerEvidenceRow,
  "inspection_id" | "case_id" | "evidence_type" | "capture_source" | "storage_path" | "captured_at"
>;

export type BackendCaseRow = {
  id: Uuid;
  report_id: Uuid;
  jurisdiction_id: string;
  status: CaseStatus;
  priority: ReportPriority;
  assigned_officer_id: Uuid | null;
  assigned_at: Timestamptz | null;
  en_route_at: Timestamptz | null;
  on_site_at: Timestamptz | null;
  inspection_started_at: Timestamptz | null;
  completed_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

export type BackendInspectionRow = {
  id: Uuid;
  case_id: Uuid;
  started_at: Timestamptz;
  notes: string;
  plate_confirmed_via_scan_at: Timestamptz | null;
  completed_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
};

/** answer: true = yes, false = no, null = unanswered. */
export type BackendInspectionCheckRow = {
  inspection_id: Uuid;
  check_key: ChecklistKey;
  answer: boolean | null;
  answered_at: Timestamptz | null;
};

export type BackendOutcomeRow = {
  id: Uuid;
  case_id: Uuid;
  inspection_id: Uuid | null;
  code: EnforcementOutcomeCode;
  decided_by: Uuid;
  decided_at: Timestamptz;
  notes: string | null;
  /** Private parking charge in cents; only for CHARGE_ISSUED. */
  parking_charge_amount_cents: number | null;
  created_at: Timestamptz;
};
export type BackendOutcomeInsert = Omit<BackendOutcomeRow, "id" | "created_at">;

export type BackendLedgerRow = {
  id: Uuid;
  citizen_id: Uuid;
  entry_type: RewardLedgerEntryType;
  amount_cents: number;
  report_id: Uuid | null;
  withdrawal_id: Uuid | null;
  idempotency_key: string;
  created_at: Timestamptz;
};
export type BackendLedgerInsert = Omit<BackendLedgerRow, "id" | "created_at"> & { created_at?: Timestamptz };

export type BackendBalanceRow = { citizen_id: Uuid; pending_cents: number; available_cents: number; paid_out_cents: number };

export type BackendNotificationRow = {
  id: Uuid;
  recipient_id: Uuid;
  recipient_role: AppRole;
  type: NotificationType;
  report_id: Uuid | null;
  case_id: Uuid | null;
  amount_cents: number | null;
  title: string | null;
  body: string | null;
  display_hint: string | null;
  idempotency_key: string;
  created_at: Timestamptz;
  read_at: Timestamptz | null;
};
export type BackendNotificationInsert = Omit<BackendNotificationRow, "id" | "created_at" | "read_at"> & { created_at?: Timestamptz };

export const AUDIT_ENTITY_TYPES = ["report", "officer_case", "inspection", "evidence", "outcome", "reward", "withdrawal", "notification", "profile"] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export type AuditEventType =
  | "REPORT_SUBMITTED"
  | "REPORT_STATUS_RESOLVED"
  | "CASE_CREATED"
  | "CASE_ACCEPTED"
  | "EN_ROUTE_STARTED"
  | "ON_SITE_ARRIVED"
  | "INSPECTION_STARTED"
  | "CASE_COMPLETED"
  | "EVIDENCE_ADDED"
  | "CHECK_CHANGED"
  | "OUTCOME_RECORDED"
  | "REWARD_CHANGED"
  | "WITHDRAWAL_REQUESTED";

export type AuditMetadata = Record<string, string | number | boolean | null>;

export type BackendAuditEventInsert = {
  actor_user_id: Uuid | null;
  actor_role: BackendActorRole;
  source: EventSource;
  entity_type: AuditEntityType;
  entity_id: Uuid;
  event_type: AuditEventType;
  metadata: AuditMetadata;
  created_at?: Timestamptz;
};
