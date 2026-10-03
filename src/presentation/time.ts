// The ONE place ISO timestamps become display strings. Domain state stores
// ISO only; every function here takes `now` explicitly so it is testable and
// never reads the real clock. Uses the device's local time zone.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MIN = 60_000;
const HOUR = 60 * MIN;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar days between the two dates' local days (0 = same day). */
function calendarDaysAgo(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / (24 * HOUR));
}

/** "Jul 17, 2026 at 12:41" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${hhmm(d)}`;
}

/** "just now", "5 min ago", "3 h ago", then "Jul 17, 2026 at 12:41". */
export function formatRelativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} h ago`;
  return formatDateTime(iso);
}

/** Notification section header: "Today", "Yesterday", "Monday", or a date. */
export function formatDayGroup(iso: string, now: Date): string {
  const then = new Date(iso);
  const days = calendarDaysAgo(then, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return WEEKDAYS_LONG[then.getDay()];
  return `${MONTHS[then.getMonth()]} ${then.getDate()}, ${then.getFullYear()}`;
}

/** Notification timestamp: "2m ago", "3h ago", "Yesterday 18:00", "Mon 14:32", "Jul 17". */
export function formatNotificationTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  const days = calendarDaysAgo(then, now);
  if (days <= 0) {
    if (diff < MIN) return "just now";
    if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
    return `${Math.floor(diff / HOUR)}h ago`;
  }
  if (days === 1) return `Yesterday ${hhmm(then)}`;
  if (days < 7) return `${WEEKDAYS_SHORT[then.getDay()]} ${hhmm(then)}`;
  return `${MONTHS[then.getMonth()]} ${then.getDate()}`;
}
