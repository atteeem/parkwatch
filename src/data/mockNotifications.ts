// Screen-facing notification VIEW MODEL (the data now lives in the store and
// is converted by src/presentation/viewModels.ts). File name kept so existing
// screen imports of NotifKind keep working.

export type NotifKind = "success" | "pending" | "info" | "error" | "gift" | "bell" | "flag" | "duplicate" | "calendar";

export type Notification = {
  id: string;
  group: string; // "Today" | "Yesterday" | "Monday" | ...
  title: string;
  body: string;
  time: string;
  kind: NotifKind;
  unread: boolean;
  /** Case this notification is about (officer notifications), for tap-to-open. */
  caseId?: string;
};
