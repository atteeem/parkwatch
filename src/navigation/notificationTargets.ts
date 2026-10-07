// Where tapping a notification goes. Only notifications that point at a
// record the current user can actually open are interactive; everything else
// is rendered as plain information (no tap affordance).

import { Notification as NotificationView } from "../data/mockNotifications";

export type NotificationTarget =
  | { pathname: "/user/report/report-overview"; params: { id: string } }
  | { pathname: "/officer/report-details"; params: { id: string } };

/** Citizen: opens the linked report only if this citizen owns it. */
export function citizenNotificationTarget(
  n: Pick<NotificationView, "reportId">,
  ownsReport: (reportId: string) => boolean
): NotificationTarget | null {
  return n.reportId && ownsReport(n.reportId) ? { pathname: "/user/report/report-overview", params: { id: n.reportId } } : null;
}

/** Officer: opens the linked case only if it still exists. */
export function officerNotificationTarget(
  n: Pick<NotificationView, "caseId">,
  caseExists: (caseId: string) => boolean
): NotificationTarget | null {
  return n.caseId && caseExists(n.caseId) ? { pathname: "/officer/report-details", params: { id: n.caseId } } : null;
}
