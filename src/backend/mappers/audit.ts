// Domain history (report/case events) -> append-only audit_events rows.
// Metadata is restricted to small scalar values and never carries secrets or
// image data (the database enforces the same).

import { Actor, CaseEvent, CaseStatus, ReportEvent } from "../../domain";
import { AuditEventType, AuditMetadata, BackendActorRole, BackendAuditEventInsert, Uuid } from "../types";

/** Resolves a domain actor (role + account id) to a backend user uuid, if it has one. */
export type ActorLookup = (actor: Actor) => Uuid | null;

const FORBIDDEN_KEYS = /^(password|secret|token|access_token|refresh_token|api_key|image|image_base64|base64|bytes|uri|storage_path)$/i;

/** Keep only short scalar values with safe keys. */
export function sanitizeAuditMetadata(input: Record<string, unknown>): AuditMetadata {
  const out: AuditMetadata = {};
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.test(k)) continue;
    if (typeof v === "string") {
      if (v.length > 200 || v.startsWith("data:") || v.startsWith("file:")) continue;
      out[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

const roleOf = (a: Actor): BackendActorRole => a.role;

export function reportEventsToAudit(reportUuid: Uuid, events: ReportEvent[], actorUuid: ActorLookup): BackendAuditEventInsert[] {
  return events.map((e) => ({
    actor_user_id: actorUuid(e.actor),
    actor_role: roleOf(e.actor),
    source: e.source,
    entity_type: "report",
    entity_id: reportUuid,
    event_type: e.type === "SUBMITTED" ? "REPORT_SUBMITTED" : "REPORT_STATUS_RESOLVED",
    metadata: e.type === "STATUS_RESOLVED" ? sanitizeAuditMetadata({ from: e.from, to: e.to, outcomeCode: e.outcomeCode }) : {},
    created_at: e.at,
  }));
}

const CASE_EVENT_BY_STATUS: Record<CaseStatus, AuditEventType> = {
  NEW: "CASE_CREATED",
  ASSIGNED: "CASE_ACCEPTED",
  EN_ROUTE: "EN_ROUTE_STARTED",
  ON_SITE: "ON_SITE_ARRIVED",
  INSPECTION: "INSPECTION_STARTED",
  COMPLETED: "CASE_COMPLETED",
};

export function caseEventsToAudit(caseUuid: Uuid, events: CaseEvent[], actorUuid: ActorLookup): BackendAuditEventInsert[] {
  return events.map((e) => ({
    actor_user_id: actorUuid(e.actor),
    actor_role: roleOf(e.actor),
    source: e.source,
    entity_type: "officer_case",
    entity_id: caseUuid,
    event_type: e.type === "CREATED" ? "CASE_CREATED" : CASE_EVENT_BY_STATUS[e.to],
    metadata: sanitizeAuditMetadata({ from: e.from ?? null, to: e.to }),
    created_at: e.at,
  }));
}
