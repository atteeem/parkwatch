// Unread-count badge text (T8.8). The count always comes from the summary
// (server-side unread count in BACKEND, the complete local list in
// LOCAL_DEMO) — never from the currently loaded notification page.

export const UNREAD_BADGE_CAP = 99;

/** null = no badge. */
export function unreadBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(Math.floor(count));
}

export function notificationsA11yLabel(count: number): string {
  const text = unreadBadgeText(count);
  return text ? `Notifications, ${text} unread` : "Notifications";
}
