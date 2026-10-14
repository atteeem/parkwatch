// Push notification content and payload contract (pure; shared by the
// push-dispatch Edge Function and the app, like plateText.ts).
//
// Lock screens are visible to other people, so pushes carry GENERIC wording
// built from the notification type only. Never in a push: evidence URLs or
// paths, citizen identity, locations, plates, report notes, audit data,
// signed URLs. The data payload carries only what the app needs to open the
// right screen (a public report number or a case id) - the screen then loads
// the record through the normal, access-checked path.

/** Notification types that are pushed (must match pw_push_eligible() in the T9.2 migration). */
export const PUSH_TYPES = ["REPORT_VERIFIED", "REPORT_REJECTED", "CASE_ASSIGNED"] as const;
export type PushType = (typeof PUSH_TYPES)[number];

/** Android notification channel the app creates before it registers for push. */
export const PUSH_CHANNEL_ID = "parkwatch-updates";
export const PUSH_CHANNEL_NAME = "Report and case updates";

/** What the sender knows about a claimed notification (see push_claim_batch). */
export type ClaimedNotification = {
  id: string;
  type: string;
  recipient_role: "CITIZEN" | "OFFICER" | string;
  amount_cents: number | null;
  report_number: number | string | null;
  case_id: string | null;
};

/** Deep-link payload (version 1). */
export type PushData =
  | { v: 1; notificationId: string; type: "REPORT_VERIFIED" | "REPORT_REJECTED"; role: "CITIZEN"; reportId: string }
  | { v: 1; notificationId: string; type: "CASE_ASSIGNED"; role: "OFFICER"; caseId: string };

export type PushContent = { title: string; body: string; data: PushData; priority: "default" | "high"; ttlSeconds: number };

const REPORT_NUMBER = /^\d{1,12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Euros from integer cents, e.g. 500 -> "€5.00". */
export const euros = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/**
 * The push for a claimed notification, or null if this type/recipient must
 * never be pushed (defensive: the database already only queues PUSH_TYPES).
 */
export function pushContentFor(n: ClaimedNotification): PushContent | null {
  const reportId = n.report_number === null || n.report_number === undefined ? "" : String(n.report_number);
  switch (n.type) {
    case "REPORT_VERIFIED":
      if (n.recipient_role !== "CITIZEN" || !REPORT_NUMBER.test(reportId)) return null;
      return {
        title: "Report verified",
        body:
          typeof n.amount_cents === "number" && n.amount_cents > 0
            ? `Your report was verified. ${euros(n.amount_cents)} reward is now available.`
            : "Your report was verified.",
        data: { v: 1, notificationId: n.id, type: "REPORT_VERIFIED", role: "CITIZEN", reportId },
        priority: "default",
        ttlSeconds: 24 * 3600,
      };
    case "REPORT_REJECTED":
      if (n.recipient_role !== "CITIZEN" || !REPORT_NUMBER.test(reportId)) return null;
      return {
        title: "Report rejected",
        body: "Your report was reviewed and could not be approved. Open ParkWatch for details.",
        data: { v: 1, notificationId: n.id, type: "REPORT_REJECTED", role: "CITIZEN", reportId },
        priority: "default",
        ttlSeconds: 24 * 3600,
      };
    case "CASE_ASSIGNED":
      if (n.recipient_role !== "OFFICER" || !n.case_id || !UUID.test(n.case_id)) return null;
      return {
        title: "New case assigned",
        body: "Open ParkWatch to review the case.",
        data: { v: 1, notificationId: n.id, type: "CASE_ASSIGNED", role: "OFFICER", caseId: n.case_id },
        priority: "high",
        ttlSeconds: 3600,
      };
    default:
      return null;
  }
}

/** Read a push payload back in the app. Anything unexpected -> null (the app then opens nothing). */
export function parsePushData(raw: unknown): PushData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1 || typeof d.notificationId !== "string" || d.notificationId.length > 100) return null;
  if ((d.type === "REPORT_VERIFIED" || d.type === "REPORT_REJECTED") && d.role === "CITIZEN" && typeof d.reportId === "string" && REPORT_NUMBER.test(d.reportId)) {
    return { v: 1, notificationId: d.notificationId, type: d.type, role: "CITIZEN", reportId: d.reportId };
  }
  if (d.type === "CASE_ASSIGNED" && d.role === "OFFICER" && typeof d.caseId === "string" && UUID.test(d.caseId)) {
    return { v: 1, notificationId: d.notificationId, type: "CASE_ASSIGNED", role: "OFFICER", caseId: d.caseId };
  }
  return null;
}

/** Expo push token shape (the database enforces the same pattern). */
export const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
