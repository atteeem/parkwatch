import { formatDateTime, formatDayGroup, formatNotificationTime, formatRelativeTime } from "../time";

// Local-time construction so tests are time-zone independent.
const now = new Date(2026, 6, 17, 18, 0); // Fri Jul 17 2026, 18:00 local
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const local = (d: number, h: number, m: number) => new Date(2026, 6, d, h, m).toISOString();
const MIN = 60_000;

describe("time formatting (fixed now)", () => {
  it("relative time", () => {
    expect(formatRelativeTime(ago(20_000), now)).toBe("just now");
    expect(formatRelativeTime(ago(5 * MIN), now)).toBe("5 min ago");
    expect(formatRelativeTime(ago(3 * 60 * MIN), now)).toBe("3 h ago");
    expect(formatRelativeTime(local(15, 14, 35), now)).toBe("Jul 15, 2026 at 14:35");
  });

  it("absolute date-time", () => {
    expect(formatDateTime(local(17, 12, 41))).toBe("Jul 17, 2026 at 12:41");
  });

  it("notification groups", () => {
    expect(formatDayGroup(local(17, 9, 0), now)).toBe("Today");
    expect(formatDayGroup(local(16, 23, 59), now)).toBe("Yesterday");
    expect(formatDayGroup(local(13, 10, 0), now)).toBe("Monday");
    expect(formatDayGroup(local(1, 10, 0), now)).toBe("Jul 1, 2026");
  });

  it("notification times", () => {
    expect(formatNotificationTime(ago(2 * MIN), now)).toBe("2m ago");
    expect(formatNotificationTime(ago(2 * 60 * MIN), now)).toBe("2h ago");
    expect(formatNotificationTime(local(16, 18, 0), now)).toBe("Yesterday 18:00");
    expect(formatNotificationTime(local(13, 14, 32), now)).toBe("Mon 14:32");
    expect(formatNotificationTime(local(1, 9, 0), now)).toBe("Jul 1");
  });
});
