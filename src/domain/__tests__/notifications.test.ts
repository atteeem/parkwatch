import { T0, T1 } from "./fixtures";
import { appendNotificationOnce, markNotificationsRead, Notification } from "./testHelpers";

const note = (id: string, role: "CITIZEN" | "OFFICER", accountId: string): Notification => ({
  id,
  idempotencyKey: id,
  recipient: { role, accountId },
  type: "SYSTEM",
  createdAt: T0,
});

describe("notifications", () => {
  it("appending the same idempotency key twice keeps one", () => {
    const once = appendNotificationOnce([], note("a", "CITIZEN", "c1")).notifications;
    const twice = appendNotificationOnce(once, note("a", "CITIZEN", "c1"));
    expect(twice.appended).toBe(false);
    expect(twice.notifications).toHaveLength(1);
  });

  it("marks only the recipient's unread notifications as read", () => {
    const list = [note("a", "CITIZEN", "c1"), note("b", "OFFICER", "o1"), { ...note("c", "CITIZEN", "c1"), readAt: T0 }];
    const read = markNotificationsRead(list, { role: "CITIZEN", accountId: "c1" }, T1);
    expect(read.map((n) => n.readAt)).toEqual([T1, undefined, T0]);
  });
});
