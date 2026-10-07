// Where tapping a notification goes (T8.8 deep links). Only notifications
// that point at a record the current user can actually open are interactive;
// everything else is rendered as plain information (no tap affordance).
//
// Ids come only from the notification itself, never guessed:
// * LOCAL_DEMO: the local store is complete, so the record must exist there.
// * BACKEND (serverScoped): notifications are already limited by the server
//   to this user. A record may simply not be loaded yet, so a well-formed id
//   (public report number / case uuid) is enough; the detail screen loads it
//   and shows a safe "not available" state if it cannot.

import type { NotificationType } from "../domain";
import { Notification as NotificationView } from "../data/mockNotifications";

export type NotificationTarget =
  | { pathname: "/user/report/report-overview"; params: { id: string } }
  | { pathname: "/user/earnings" }
  | { pathname: "/officer/report-details"; params: { id: string } }
  | { pathname: "/officer/inspection-completed"; params: { id: string; from: "notifications" } };

type Opts = { serverScoped?: boolean };

const PUBLIC_REPORT_NUMBER = /^\d{1,12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CITIZEN_REPORT_TYPES: readonly NotificationType[] = ["REPORT_UNDER_REVIEW", "REPORT_VERIFIED", "REPORT_REJECTED"];

/**
 * Citizen: report notifications open that report (own reports only);
 * WITHDRAWAL_REQUESTED opens the Wallet; anything else stays informational.
 */
export function citizenNotificationTarget(
  n: Pick<NotificationView, "reportId" | "type">,
  ownsReport: (reportId: string) => boolean,
  { serverScoped = false }: Opts = {}
): NotificationTarget | null {
  if (n.type === "WITHDRAWAL_REQUESTED") return { pathname: "/user/earnings" };
  // Untyped (older views) or report types only; SYSTEM messages without a report stay plain.
  if (n.type !== undefined && n.type !== "SYSTEM" && !CITIZEN_REPORT_TYPES.includes(n.type)) return null;
  const id = n.reportId;
  if (!id) return null;
  const openable = ownsReport(id) || (serverScoped && PUBLIC_REPORT_NUMBER.test(id));
  return openable ? { pathname: "/user/report/report-overview", params: { id } } : null;
}

/**
 * Officer: CASE_ACCEPTED (and other case messages) open the case; a decided
 * case (PARKING_CHARGE_ISSUED / CASE_CLOSED_WITHOUT_CHARGE) opens its
 * completed-case record. No case id -> informational.
 */
export function officerNotificationTarget(
  n: Pick<NotificationView, "caseId" | "type">,
  caseExists: (caseId: string) => boolean,
  { serverScoped = false }: Opts = {}
): NotificationTarget | null {
  const id = n.caseId;
  if (!id) return null;
  if (!(caseExists(id) || (serverScoped && UUID.test(id)))) return null;
  if (n.type === "PARKING_CHARGE_ISSUED" || n.type === "CASE_CLOSED_WITHOUT_CHARGE") {
    return { pathname: "/officer/inspection-completed", params: { id, from: "notifications" } };
  }
  return { pathname: "/officer/report-details", params: { id } };
}
