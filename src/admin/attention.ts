// "Needs attention" (T9.2): an open case that has stayed in its current
// status longer than a threshold. Lifecycle timestamps only - no location,
// no tracking, no automatic action. BACKEND: the server computes it from
// app_settings (configurable there). LOCAL_DEMO: the same rule with these
// defaults, which equal the migration's column defaults (source-tested).

import type { CaseStatus } from "../domain";
import type { AdminCaseTimeline } from "./adminTypes";

export type OpenStatus = Exclude<CaseStatus, "COMPLETED">;

/** Minutes in the current status before a case needs attention. */
export const DEFAULT_ATTENTION_THRESHOLDS: Readonly<Record<OpenStatus, number>> = {
  NEW: 30,
  ASSIGNED: 20,
  EN_ROUTE: 45,
  ON_SITE: 20,
  INSPECTION: 30,
};

/** When the case entered its current status (null for COMPLETED: never flagged). Mirrors pw_case_status_since. */
export function statusSince(status: CaseStatus, t: AdminCaseTimeline): string | null {
  switch (status) {
    case "NEW":
      return t.createdAt;
    case "ASSIGNED":
      return t.assignedAt ?? t.createdAt;
    case "EN_ROUTE":
      return t.enRouteAt ?? t.assignedAt ?? t.createdAt;
    case "ON_SITE":
      return t.onSiteAt ?? t.enRouteAt ?? t.createdAt;
    case "INSPECTION":
      return t.inspectionStartedAt ?? t.onSiteAt ?? t.enRouteAt ?? t.createdAt;
    case "COMPLETED":
      return null;
  }
}

export function needsAttention(status: CaseStatus, since: string | null | undefined, now: Date, thresholds = DEFAULT_ATTENTION_THRESHOLDS): boolean {
  if (status === "COMPLETED" || !since) return false;
  const ms = now.getTime() - new Date(since).getTime();
  return Number.isFinite(ms) && ms >= thresholds[status] * 60_000;
}

/** "45 min", "2 h 05 min", "3 d 4 h" - elapsed since a status began. */
export function formatElapsed(since: string, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export const ATTENTION_STATUS_TEXT: Record<OpenStatus, string> = {
  NEW: "waiting for an officer",
  ASSIGNED: "assigned, not started",
  EN_ROUTE: "on the way",
  ON_SITE: "on site",
  INSPECTION: "in inspection",
};
