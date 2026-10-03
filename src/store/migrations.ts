// Persisted-state migrations. Each step upgrades one version and must keep
// every record and id; only new fields are added, with deterministic defaults.

import {
  Actor,
  CaptureSource,
  CaseEvent,
  CitizenEvidence,
  CitizenReportStatus,
  createPlateNumber,
  EnforcementOutcomeCode,
  Inspection,
  MVP_DEFAULT_JURISDICTION_ID,
  OfficerCase,
  OfficerEvidence,
  Report,
  ReportEvent,
} from "../domain";
import { ParkWatchState } from "./state";

/** Actor for history that has to be reconstructed but has no known person behind it. */
export const MIGRATION_SYSTEM_ACTOR: Actor = { role: "SYSTEM", accountId: "parkwatch-migration" };

// ---------------------------------------------------------------------------
// v1 shapes (only the parts that changed)

type V1Evidence = Omit<CitizenEvidence, "captureSource"> | Omit<OfficerEvidence, "captureSource">;
type V1Report = Omit<Report, "jurisdictionId" | "events" | "vehicle" | "evidence"> & {
  vehicle?: Omit<NonNullable<Report["vehicle"]>, "plate"> & { plate: string };
  evidence: Omit<CitizenEvidence, "captureSource">[];
};
type V1CaseEvent = Omit<CaseEvent, "actor" | "source"> & { officerId?: string };
type V1Case = Omit<OfficerCase, "jurisdictionId" | "events"> & { events: V1CaseEvent[] };
type V1Inspection = Omit<Inspection, "officerEvidence"> & {
  officerEvidence: Partial<Record<string, Omit<OfficerEvidence, "captureSource">>>;
};
export type V1State = Omit<ParkWatchState, "reports" | "cases" | "inspections"> & {
  reports: V1Report[];
  cases: V1Case[];
  inspections: Record<string, V1Inspection>;
};

// ---------------------------------------------------------------------------
// v1 -> v2

/**
 * v1 had exactly two ways to produce an image: the in-app camera, or a mock
 * image (seed data, and the camera screen's placeholder fallback). There was
 * no photo-library path. So: mock images -> SEED, everything else -> CAMERA.
 */
export function inferV1CaptureSource(e: Pick<V1Evidence, "id" | "uri">): CaptureSource {
  const isMock = e.id.startsWith("ev-seed-") || e.uri.startsWith("https://picsum.photos/");
  return isMock ? "SEED" : "CAMERA";
}

/** In v1 only these outcomes could produce these statuses (see outcome mapping). */
const V1_STATUS_OUTCOME: Record<Exclude<CitizenReportStatus, "UNDER_REVIEW">, EnforcementOutcomeCode> = {
  VERIFIED: "CHARGE_ISSUED",
  REJECTED: "REPORT_REJECTED",
};

function migrateReport(r: V1Report, cases: V1Case[]): Report {
  const c = cases.find((x) => x.reportId === r.id);
  const events: ReportEvent[] = [
    { type: "SUBMITTED", at: r.submittedAt, actor: { role: "CITIZEN", accountId: r.citizenId }, source: "MIGRATION" },
  ];
  if (r.status !== "UNDER_REVIEW") {
    const officerId = c?.outcome?.officerId;
    events.push({
      type: "STATUS_RESOLVED",
      at: r.resolvedAt ?? c?.completedAt ?? r.submittedAt,
      actor: officerId ? { role: "OFFICER", accountId: officerId } : MIGRATION_SYSTEM_ACTOR,
      source: "MIGRATION",
      from: "UNDER_REVIEW",
      to: r.status,
      outcomeCode: c?.outcome?.code ?? V1_STATUS_OUTCOME[r.status],
    });
  }
  const { vehicle, evidence, ...rest } = r;
  return {
    ...rest,
    jurisdictionId: MVP_DEFAULT_JURISDICTION_ID,
    evidence: evidence.map((e) => ({ ...e, captureSource: inferV1CaptureSource(e) }) as CitizenEvidence),
    // v1 stored no plate country; none is invented here.
    vehicle: vehicle ? { ...vehicle, plate: createPlateNumber(vehicle.plate) } : undefined,
    events,
  };
}

function migrateCase(c: V1Case, reports: V1Report[]): OfficerCase {
  const citizenId = reports.find((r) => r.id === c.reportId)?.citizenId;
  const events: CaseEvent[] = c.events.map(({ officerId, ...e }) => ({
    ...e,
    actor:
      e.type === "CREATED"
        ? citizenId
          ? { role: "CITIZEN", accountId: citizenId }
          : MIGRATION_SYSTEM_ACTOR
        : officerId
          ? { role: "OFFICER", accountId: officerId }
          : MIGRATION_SYSTEM_ACTOR,
    source: "MIGRATION",
  }));
  return { ...c, jurisdictionId: MVP_DEFAULT_JURISDICTION_ID, events };
}

function migrateInspection(i: V1Inspection): Inspection {
  const officerEvidence: Inspection["officerEvidence"] = {};
  for (const [slot, e] of Object.entries(i.officerEvidence)) {
    if (e) (officerEvidence as Record<string, OfficerEvidence>)[slot] = { ...e, captureSource: inferV1CaptureSource(e) };
  }
  return { ...i, officerEvidence };
}

export function migrateV1toV2(v1: V1State): ParkWatchState {
  return {
    ...v1,
    reports: v1.reports.map((r) => migrateReport(r, v1.cases)),
    cases: v1.cases.map((c) => migrateCase(c, v1.reports)),
    inspections: Object.fromEntries(Object.entries(v1.inspections).map(([k, i]) => [k, migrateInspection(i)])),
    // ledger, notifications, seq and nextReportNumber are unchanged in v2.
  };
}
