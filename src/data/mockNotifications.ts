export type NotifKind = "success" | "pending" | "info" | "error" | "gift" | "bell" | "flag" | "duplicate" | "calendar";

export type Notification = {
  id: string;
  group: string; // "Today" | "Monday" | "Sunday" | ...
  title: string;
  body: string;
  time: string;
  kind: NotifKind;
  unread: boolean;
};

export const INITIAL_USER_NOTIFICATIONS: Notification[] = [
  { id: "un1", group: "Today", title: "Report verified", body: "Your report #12556 has been verified and a fine has been issued.\n+ \u20ac5.00 added to your balance", time: "2m ago", kind: "success", unread: true },
  { id: "un2", group: "Today", title: "Report under review", body: "Your report #12564 is now under review by a parking officer.", time: "18m ago", kind: "pending", unread: true },
  { id: "un3", group: "Today", title: "Withdrawal completed", body: "Your withdrawal of \u20ac25.00 has been sent to your bank account.", time: "2h ago", kind: "info", unread: true },
  { id: "un4", group: "Monday", title: "Report verified", body: "Your report #12484 has been verified and a fine has been issued.\n+ \u20ac5.00 added to your balance", time: "Mon 14:32", kind: "success", unread: false },
  { id: "un5", group: "Monday", title: "Report rejected", body: "Your report #12499 was rejected \u2014 see details for more information.", time: "Mon 11:07", kind: "error", unread: false },
  { id: "un6", group: "Monday", title: "New feature available", body: "You can now add more details to your reports. Check it out!", time: "Mon 6:00", kind: "bell", unread: false },
  { id: "un7", group: "Sunday", title: "Welcome bonus", body: "Thank you for joining! You received a welcome bonus.", time: "Sun 16:45", kind: "gift", unread: false },
];

export const INITIAL_OFFICER_NOTIFICATIONS: Notification[] = [
  { id: "on1", group: "Today", title: "High Priority Report Assigned", body: "Case #12556 has been assigned to you.\nMannerheimintie 45, Helsinki \u2022 350m away", time: "1m ago", kind: "error", unread: true },
  { id: "on2", group: "Today", title: "Parking Charge Issued", body: "Case #12496 successfully completed.\nParking charge \u20ac60 issued.", time: "7m ago", kind: "success", unread: true },
  { id: "on3", group: "Today", title: "Case Accepted", body: "You have accepted case #12485\nSidewalk obstruction \u2022 250m away", time: "20m ago", kind: "info", unread: true },
  { id: "on4", group: "Today", title: "Vehicle Already Moved", body: "Case #12472 closed without charge.\nNo violation found on site.", time: "32m ago", kind: "pending", unread: false },
  { id: "on5", group: "Yesterday", title: "Shift Completed", body: "You completed your shift successfully.\n17 cases \u2022 Avg. response 3m 7s", time: "Yesterday 18:00", kind: "flag", unread: false },
  { id: "on6", group: "Yesterday", title: "System Update", body: "New AI license plate scanning is now available. Check out the new feature.", time: "Mon 6:00", kind: "bell", unread: false },
  { id: "on7", group: "Yesterday", title: "Duplicate Report Detected", body: "Case #12442 was already being handled. Duplicate reports help us work faster.", time: "Mon 6:00", kind: "duplicate", unread: false },
  { id: "on8", group: "Monday", title: "Upcoming Shift", body: "Your shift starts in 1 hour.\n08:00 - 16:00 \u2022 City Center District", time: "Mon 9:00", kind: "calendar", unread: false },
];
