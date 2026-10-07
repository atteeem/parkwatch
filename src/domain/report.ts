import { qualifiesAsRequiredEvidence } from "./evidence";
import { CitizenConsequence } from "./outcomes";
import { fail, ok, Result } from "./result";
import {
  Actor,
  CITIZEN_EVIDENCE_TYPES,
  CitizenEvidenceType,
  EnforcementOutcomeCode,
  EventSource,
  IsoTimestamp,
  Report,
  ReportDraft,
  ReportPriority,
  VehicleInfo,
} from "./types";

export function createEmptyDraft(draftId: string): ReportDraft {
  return { draftId, photos: {}, location: { address: "" }, notes: "", attachments: [] };
}

/** Steps of the citizen wizard, in order. Each step validates everything before it too. */
export type DraftStep = "PHOTOS" | "VIOLATION" | "DETAILS" | "SUBMIT";

export type DraftIssue =
  | { code: "MISSING_PHOTO"; slot: CitizenEvidenceType }
  /** A photo is present but its capture source cannot satisfy a required slot (e.g. LIBRARY). */
  | { code: "PHOTO_SOURCE_NOT_ALLOWED"; slot: CitizenEvidenceType }
  | { code: "MISSING_VIOLATION" }
  | { code: "MISSING_LOCATION" }
  | { code: "INVALID_OBSERVED_AT" };

const STEP_ORDER: DraftStep[] = ["PHOTOS", "VIOLATION", "DETAILS", "SUBMIT"];
const reaches = (step: DraftStep, required: DraftStep) => STEP_ORDER.indexOf(step) >= STEP_ORDER.indexOf(required);

const isValidIso = (value: string) => !Number.isNaN(Date.parse(value));

/**
 * Validate a draft up to and including `step`.
 * Required photos (front/side/rear, from CAMERA — or SEED for demo data) ->
 * violation -> non-blank location. Notes and attachments are always
 * optional, and attachments never count as required photos.
 */
export function validateDraft(draft: ReportDraft, step: DraftStep): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const slot of CITIZEN_EVIDENCE_TYPES) {
    const photo = draft.photos[slot];
    if (!photo) issues.push({ code: "MISSING_PHOTO", slot });
    else if (!qualifiesAsRequiredEvidence(photo)) issues.push({ code: "PHOTO_SOURCE_NOT_ALLOWED", slot });
  }
  if (reaches(step, "VIOLATION") && !draft.violationId) issues.push({ code: "MISSING_VIOLATION" });
  if (reaches(step, "DETAILS")) {
    if (!draft.location.address.trim()) issues.push({ code: "MISSING_LOCATION" });
    if (draft.observedAt !== undefined && !isValidIso(draft.observedAt)) issues.push({ code: "INVALID_OBSERVED_AT" });
  }
  return issues;
}

export const isDraftValid = (draft: ReportDraft, step: DraftStep) => validateDraft(draft, step).length === 0;

/** Earliest citizen photo time; the default "observed at" for a report. */
/**
 * When the violation was observed: the earliest required CAMERA photo
 * (device clock; evidence provenance, never typed by the citizen).
 */
export function draftObservedAtOf(draft: ReportDraft): IsoTimestamp | undefined {
  return draft.observedAt ?? earliestCapture(draft);
}

function earliestCapture(draft: ReportDraft): IsoTimestamp | undefined {
  return CITIZEN_EVIDENCE_TYPES.map((s) => draft.photos[s]?.capturedAt)
    .filter((t): t is string => !!t)
    .sort()[0];
}

/**
 * Freeze a valid draft into a submitted report (status UNDER_REVIEW) with its
 * first history event, SUBMITTED.
 *
 * Times: observedAt = what the device says (draft value, else earliest photo
 * capture); submittedAt = local submit time. receivedAt is left undefined —
 * only a backend may set it.
 *
 * The caller should first check findReportForDraft to keep submission
 * idempotent; this function itself only validates and builds.
 */
export function createReportFromDraft(
  draft: ReportDraft,
  input: {
    id: string;
    citizenId: string;
    jurisdictionId: string;
    submittedAt: IsoTimestamp;
    source: EventSource;
    vehicle?: VehicleInfo;
    priority?: ReportPriority;
    caseId?: string;
  }
): Result<Report> {
  const issues = validateDraft(draft, "SUBMIT");
  if (issues.length > 0) {
    return fail("INVALID_DRAFT", `Draft ${draft.draftId} is incomplete: ${issues.map((i) => i.code).join(", ")}.`);
  }
  const actor: Actor = { role: "CITIZEN", accountId: input.citizenId };
  return ok({
    id: input.id,
    sourceDraftId: draft.draftId,
    citizenId: input.citizenId,
    jurisdictionId: input.jurisdictionId,
    status: "UNDER_REVIEW",
    violationId: draft.violationId!,
    location: submittedLocation(draft),
    observedAt: draft.observedAt ?? earliestCapture(draft) ?? input.submittedAt,
    submittedAt: input.submittedAt,
    notes: draft.notes,
    evidence: [...CITIZEN_EVIDENCE_TYPES.map((s) => draft.photos[s]!), ...draft.attachments],
    vehicle: input.vehicle,
    priority: input.priority ?? "NORMAL",
    caseId: input.caseId,
    events: [{ type: "SUBMITTED", at: input.submittedAt, actor, source: input.source }],
  });
}

/** The location a report keeps. The raw device fix stays in the draft (data minimization). */
function submittedLocation(draft: ReportDraft): Report["location"] {
  const { deviceFix: _deviceFix, ...location } = draft.location;
  return { ...location, address: location.address.trim() };
}

/** Submission guard: a draft that was already submitted maps to its existing report. */
export function findReportForDraft(reports: readonly Report[], draftId: string): Report | undefined {
  return reports.find((r) => r.sourceDraftId === draftId);
}

/**
 * Apply an enforcement consequence to the citizen report.
 * - status UNRESOLVED: report unchanged (changed=false), no event. Status is never guessed.
 * - RESOLVED: UNDER_REVIEW -> VERIFIED/REJECTED and a STATUS_RESOLVED event is
 *   appended. Re-applying the same result is a no-op; a conflicting result is
 *   REPORT_ALREADY_RESOLVED.
 */
export function applyCitizenConsequenceToReport(
  report: Report,
  consequence: CitizenConsequence,
  ctx: { at: IsoTimestamp; actor: Actor; source: EventSource; outcomeCode: EnforcementOutcomeCode }
): Result<{ report: Report; changed: boolean }> {
  const mapping = consequence.citizenStatus;
  if (mapping.resolution === "UNRESOLVED") return ok({ report, changed: false });
  if (report.status === mapping.status) return ok({ report, changed: false });
  if (report.status !== "UNDER_REVIEW") {
    return fail("REPORT_ALREADY_RESOLVED", `Report ${report.id} is already ${report.status}.`);
  }
  return ok({
    report: {
      ...report,
      status: mapping.status,
      resolvedAt: ctx.at,
      events: [
        ...report.events,
        {
          type: "STATUS_RESOLVED",
          at: ctx.at,
          actor: ctx.actor,
          source: ctx.source,
          from: report.status,
          to: mapping.status,
          outcomeCode: ctx.outcomeCode,
        },
      ],
    },
    changed: true,
  });
}
