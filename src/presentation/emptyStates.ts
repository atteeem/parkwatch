// Empty-state copy and decisions for every list/section (T8.6). Pure data, so
// the wording and the CTA logic are tested without UI. Truthful copy only:
// nothing here promises a feature or a result the app does not provide.

import type { CasesTab, QueueFilter } from "./officerViews";
import type { MyReportsTab } from "./citizenViews";

export type EmptyIcon =
  | "document-text-outline"
  | "time-outline"
  | "checkmark-circle-outline"
  | "close-circle-outline"
  | "notifications-outline"
  | "wallet-outline"
  | "receipt-outline"
  | "car-outline"
  | "map-outline"
  | "shield-checkmark-outline"
  | "clipboard-outline"
  | "flag-outline"
  | "person-outline"
  | "alert-circle-outline"
  | "list-outline";

/** What a CTA does; screens map these to real navigation. */
export type EmptyAction = "createReport" | "startParking" | "addVehicle" | "openQueue" | "showAllQueue";

export type EmptyCopy = { icon: EmptyIcon; title: string; body: string; action?: { label: string; kind: EmptyAction } };

// ---------------------------------------------------------------------------
// Citizen

export const HOME_LATEST_EMPTY: EmptyCopy = {
  icon: "document-text-outline",
  title: "No reports yet",
  body: "When you report your first parking issue, its status will appear here.",
  action: { label: "Create first report", kind: "createReport" },
};

const REPORT_TAB_EMPTY: Record<Exclude<MyReportsTab, "all">, EmptyCopy> = {
  "under-review": {
    icon: "time-outline",
    title: "No reports under review",
    body: "Reports you submit appear here while enforcement reviews them.",
  },
  verified: {
    icon: "checkmark-circle-outline",
    title: "No verified reports yet",
    body: "When enforcement verifies an eligible report, it appears here and its €5 reward is released.",
  },
  rejected: {
    icon: "close-circle-outline",
    title: "No rejected reports",
    body: "Reports that enforcement could not act on would appear here, with their status.",
  },
};

/**
 * My Reports. `totalCount` = all of the citizen's reports (server count in
 * backend mode). No reports at all -> invite the first report; an empty tab
 * while other reports exist -> that tab's explanation (no CTA).
 */
export function myReportsEmpty(tab: MyReportsTab, totalCount: number): EmptyCopy {
  if (totalCount === 0 || tab === "all") {
    return {
      icon: "document-text-outline",
      title: "Your reports will appear here",
      body: "Spotted a parking problem? Report it with three photos and follow its status here.",
      action: { label: "Report Parking Issue", kind: "createReport" },
    };
  }
  return REPORT_TAB_EMPTY[tab];
}

export const CITIZEN_NOTIFICATIONS_EMPTY: EmptyCopy = {
  icon: "notifications-outline",
  title: "You're all caught up",
  body: "Updates about your reports, rewards and account will appear here.",
};

export const EARNINGS_EMPTY: EmptyCopy = {
  icon: "wallet-outline",
  title: "Your first reward starts with a verified report",
  body: "When an eligible report is verified, the €5 reward becomes available here.",
  action: { label: "Make a report", kind: "createReport" },
};

export const TRANSACTION_HISTORY_EMPTY: EmptyCopy = {
  icon: "receipt-outline",
  title: "No wallet activity yet",
  body: "Rewards and withdrawals will be listed here as they happen.",
};

export const PARKING_HISTORY_EMPTY: EmptyCopy = {
  icon: "time-outline",
  title: "No parking sessions yet",
  body: "Finished parking sessions will appear here with their duration and cost.",
  // The parking hub decides whether a new session can start (one may be active).
  action: { label: "Go to Parking", kind: "startParking" },
};

/** My Vehicles keeps its permanent "Add Vehicle" button, so the empty state adds no second one. */
export const VEHICLES_EMPTY: EmptyCopy = {
  icon: "car-outline",
  title: "No vehicles yet",
  body: "Add a vehicle to start a parking session.",
};

export const CITIZEN_MAP_EMPTY: EmptyCopy = {
  icon: "map-outline",
  title: "No reports on your map yet",
  body: "Your submitted reports will appear here.",
};

// ---------------------------------------------------------------------------
// Officer

export const OFFICER_HOME_NO_NEW: EmptyCopy = {
  icon: "shield-checkmark-outline",
  title: "Area clear",
  body: "There are currently no unassigned reports in your area. New reports will appear here when available.",
};

export const OFFICER_HOME_NO_ACTIVE: EmptyCopy = {
  icon: "clipboard-outline",
  title: "No active assignment",
  body: "Choose a report from the queue when you're ready to begin an inspection.",
  action: { label: "Open Queue", kind: "openQueue" },
};

const QUEUE_EMPTY: Record<QueueFilter, Omit<EmptyCopy, "action">> = {
  All: { icon: "shield-checkmark-outline", title: "No open reports", body: "New reports in your area will appear here." },
  New: { icon: "list-outline", title: "No unassigned reports", body: "Reports nobody has accepted yet appear under this filter." },
  "High Priority": { icon: "alert-circle-outline", title: "No high-priority reports", body: "Open reports marked high priority appear under this filter." },
  Assigned: { icon: "person-outline", title: "Nothing assigned to you", body: "Reports you accept appear here until they are completed." },
};

/**
 * Queue. `totalOpen` = all open reports the officer can see (server count).
 * A filter that is empty while other open reports exist offers "Show all reports".
 */
export function queueEmpty(filter: QueueFilter, totalOpen: number): EmptyCopy {
  const base = QUEUE_EMPTY[filter];
  if (filter !== "All" && totalOpen > 0) return { ...base, action: { label: "Show all reports", kind: "showAllQueue" } };
  return { ...base };
}

const CASES_EMPTY: Record<CasesTab, EmptyCopy> = {
  All: { icon: "clipboard-outline", title: "No cases yet", body: "Cases you accept or decide will appear here.", action: { label: "Open Queue", kind: "openQueue" } },
  Completed: { icon: "checkmark-circle-outline", title: "No completed cases yet", body: "Cases you close, with or without a parking charge, appear here." },
  Issued: { icon: "receipt-outline", title: "No parking charges issued yet", body: "Cases where you issued a parking charge appear here." },
  Rejected: { icon: "close-circle-outline", title: "No rejected reports", body: "Reports you rejected after review appear here." },
};

export const casesEmpty = (tab: CasesTab): EmptyCopy => CASES_EMPTY[tab];

export const OFFICER_NOTIFICATIONS_EMPTY: EmptyCopy = {
  icon: "notifications-outline",
  title: "No new alerts",
  body: "Case assignments, updates and operational notifications will appear here.",
};

export const OFFICER_MAP_EMPTY: EmptyCopy = {
  icon: "map-outline",
  title: "No reports match this view",
  body: "Try another filter or open the queue.",
  action: { label: "Open Queue", kind: "openQueue" },
};
