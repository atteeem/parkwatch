import { fail, ok, Result } from "./result";
import { CaseStatus, EnforcementOutcome, IsoTimestamp, OfficerCase, ReportPriority } from "./types";

/**
 * The single source of truth for officer case transitions.
 *
 * MVP flow: NEW -> ASSIGNED -> EN_ROUTE -> (ON_SITE ->) INSPECTION -> COMPLETED
 *
 * EN_ROUTE -> INSPECTION is allowed directly because the En Route screen's
 * "Start On-site Inspection" both arrives and begins the inspection.
 * ON_SITE is kept for seed data and a future separate "arrived" step.
 *
 * Not yet reachable (concepts in the designs, inactive per spec):
 *   release case (ASSIGNED/EN_ROUTE -> NEW), reject/duplicate straight from
 *   Report Details, "vehicle moved" from En Route. Add them here when a
 *   product decision enables them.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["EN_ROUTE"],
  EN_ROUTE: ["ON_SITE", "INSPECTION"],
  ON_SITE: ["INSPECTION"],
  INSPECTION: ["COMPLETED"],
  COMPLETED: [],
};

export function canTransitionCase(from: CaseStatus, to: CaseStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function createCase(input: {
  id: string;
  reportId: string;
  priority: ReportPriority;
  createdAt: IsoTimestamp;
  distanceMeters?: number;
}): OfficerCase {
  return {
    id: input.id,
    reportId: input.reportId,
    status: "NEW",
    priority: input.priority,
    distanceMeters: input.distanceMeters,
    createdAt: input.createdAt,
    statusTimestamps: { NEW: input.createdAt },
    events: [{ type: "CREATED", at: input.createdAt, to: "NEW" }],
  };
}

/**
 * Move a case to `to`. Invalid transitions return INVALID_TRANSITION and the
 * input case is never mutated. Completion must go through completeCase so an
 * outcome is always recorded.
 */
export function transitionCase(
  c: OfficerCase,
  to: Exclude<CaseStatus, "COMPLETED">,
  ctx: { at: IsoTimestamp; officerId?: string }
): Result<OfficerCase> {
  if (!canTransitionCase(c.status, to)) {
    return fail("INVALID_TRANSITION", `Case ${c.id} cannot move from ${c.status} to ${to}.`);
  }
  if (to === "ASSIGNED" && !ctx.officerId) {
    return fail("MISSING_OFFICER", "Assigning a case requires an officer id.");
  }
  return ok(applyStatus(c, to, ctx.at, ctx.officerId));
}

/**
 * Complete a case with its enforcement outcome.
 *
 * Idempotent: completing an already-completed case with the same outcome code
 * returns the case unchanged (changed=false), so retries never add duplicate
 * events. A different outcome on a completed case is ALREADY_COMPLETED.
 */
export function completeCase(
  c: OfficerCase,
  outcome: EnforcementOutcome
): Result<{ case: OfficerCase; changed: boolean }> {
  if (c.status === "COMPLETED") {
    if (c.outcome?.code === outcome.code) return ok({ case: c, changed: false });
    return fail("ALREADY_COMPLETED", `Case ${c.id} is already completed with ${c.outcome?.code}.`);
  }
  if (!canTransitionCase(c.status, "COMPLETED")) {
    return fail("INVALID_TRANSITION", `Case ${c.id} cannot be completed from ${c.status}.`);
  }
  const next = applyStatus(c, "COMPLETED", outcome.decidedAt, outcome.officerId);
  return ok({ case: { ...next, outcome, completedAt: outcome.decidedAt }, changed: true });
}

function applyStatus(c: OfficerCase, to: CaseStatus, at: IsoTimestamp, officerId?: string): OfficerCase {
  return {
    ...c,
    status: to,
    assignedOfficerId: to === "ASSIGNED" ? officerId : c.assignedOfficerId,
    statusTimestamps: { ...c.statusTimestamps, [to]: c.statusTimestamps[to] ?? at },
    events: [...c.events, { type: "STATUS_CHANGED", at, from: c.status, to, officerId }],
  };
}
