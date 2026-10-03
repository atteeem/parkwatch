import { fail, ok, Result } from "./result";
import { Actor, CaseStatus, EnforcementOutcome, EventSource, IsoTimestamp, OfficerCase, ReportPriority } from "./types";

/** Who/what caused a case change, recorded on every event. */
export type CaseEventContext = { at: IsoTimestamp; actor: Actor; source: EventSource };

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
  jurisdictionId: string;
  priority: ReportPriority;
  createdAt: IsoTimestamp;
  distanceMeters?: number;
  /** The action that created the case (normally the citizen's submission). */
  actor: Actor;
  source: EventSource;
}): OfficerCase {
  return {
    id: input.id,
    reportId: input.reportId,
    jurisdictionId: input.jurisdictionId,
    status: "NEW",
    priority: input.priority,
    distanceMeters: input.distanceMeters,
    createdAt: input.createdAt,
    statusTimestamps: { NEW: input.createdAt },
    events: [{ type: "CREATED", at: input.createdAt, to: "NEW", actor: input.actor, source: input.source }],
  };
}

/**
 * Move a case to `to`. Invalid transitions return INVALID_TRANSITION and the
 * input case is never mutated. Completion must go through completeCase so an
 * outcome is always recorded.
 *
 * ASSIGNED needs an assignee: `assigneeOfficerId`, or the acting officer.
 */
export function transitionCase(
  c: OfficerCase,
  to: Exclude<CaseStatus, "COMPLETED">,
  ctx: CaseEventContext & { assigneeOfficerId?: string }
): Result<OfficerCase> {
  if (!canTransitionCase(c.status, to)) {
    return fail("INVALID_TRANSITION", `Case ${c.id} cannot move from ${c.status} to ${to}.`);
  }
  const assignee = ctx.assigneeOfficerId ?? (ctx.actor.role === "OFFICER" ? ctx.actor.accountId : undefined);
  if (to === "ASSIGNED" && !assignee) {
    return fail("MISSING_OFFICER", "Assigning a case requires an officer.");
  }
  return ok(applyStatus(c, to, ctx, to === "ASSIGNED" ? assignee : undefined));
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
  outcome: EnforcementOutcome,
  source: EventSource = "USER_ACTION"
): Result<{ case: OfficerCase; changed: boolean }> {
  if (c.status === "COMPLETED") {
    if (c.outcome?.code === outcome.code) return ok({ case: c, changed: false });
    return fail("ALREADY_COMPLETED", `Case ${c.id} is already completed with ${c.outcome?.code}.`);
  }
  if (!canTransitionCase(c.status, "COMPLETED")) {
    return fail("INVALID_TRANSITION", `Case ${c.id} cannot be completed from ${c.status}.`);
  }
  const actor: Actor = { role: "OFFICER", accountId: outcome.officerId };
  const next = applyStatus(c, "COMPLETED", { at: outcome.decidedAt, actor, source });
  return ok({ case: { ...next, outcome, completedAt: outcome.decidedAt }, changed: true });
}

function applyStatus(c: OfficerCase, to: CaseStatus, ctx: CaseEventContext, assignee?: string): OfficerCase {
  return {
    ...c,
    status: to,
    assignedOfficerId: assignee ?? c.assignedOfficerId,
    statusTimestamps: { ...c.statusTimestamps, [to]: c.statusTimestamps[to] ?? ctx.at },
    events: [...c.events, { type: "STATUS_CHANGED", at: ctx.at, from: c.status, to, actor: ctx.actor, source: ctx.source }],
  };
}
