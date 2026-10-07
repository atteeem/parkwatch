// T8.8: notification deep links + unread badges.
import * as fs from "fs";
import * as path from "path";
import { citizenNotificationTarget, officerNotificationTarget } from "../../navigation/notificationTargets";
import { NotificationType } from "../../domain";
import { notificationsA11yLabel, UNREAD_BADGE_CAP, unreadBadgeText } from "../unreadBadge";
import { buildSeedState } from "../../store/seed";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../../store/session";
import { selectNotifications } from "../viewModels";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CASE_UUID = "44444444-4444-4444-8444-444444444444";

describe("citizen notification destinations", () => {
  const owns = (id: string) => id === "100";
  it.each(["REPORT_UNDER_REVIEW", "REPORT_VERIFIED", "REPORT_REJECTED"] as NotificationType[])("%s -> that report's details", (type) => {
    expect(citizenNotificationTarget({ type, reportId: "100" }, owns)).toEqual({ pathname: "/user/report/report-overview", params: { id: "100" } });
  });

  it("WITHDRAWAL_REQUESTED -> Wallet", () => {
    expect(citizenNotificationTarget({ type: "WITHDRAWAL_REQUESTED" }, owns)).toEqual({ pathname: "/user/earnings" });
  });

  it("safe fallback: SYSTEM without a report, missing ids and other citizens' reports are not openable", () => {
    expect(citizenNotificationTarget({ type: "SYSTEM" }, owns)).toBeNull();
    expect(citizenNotificationTarget({ type: "REPORT_VERIFIED" }, owns)).toBeNull();
    expect(citizenNotificationTarget({ type: "REPORT_VERIFIED", reportId: "200" }, owns)).toBeNull();
    // An officer-type notification never routes a citizen anywhere.
    expect(citizenNotificationTarget({ type: "CASE_ACCEPTED", reportId: "100" }, owns)).toBeNull();
  });

  it("BACKEND: a server-scoped report number opens even if its page is not loaded; malformed ids never do", () => {
    const none = () => false;
    expect(citizenNotificationTarget({ type: "REPORT_VERIFIED", reportId: "100024" }, none, { serverScoped: true })).toEqual({
      pathname: "/user/report/report-overview",
      params: { id: "100024" },
    });
    // The mapper falls back to the raw uuid when the report is unknown: not a public number -> plain info.
    expect(citizenNotificationTarget({ type: "REPORT_VERIFIED", reportId: CASE_UUID }, none, { serverScoped: true })).toBeNull();
    // LOCAL_DEMO (complete store): an unknown number is not guessed into a link.
    expect(citizenNotificationTarget({ type: "REPORT_VERIFIED", reportId: "100024" }, none)).toBeNull();
  });
});

describe("officer notification destinations", () => {
  const exists = (id: string) => id === "c1";
  it("CASE_ACCEPTED -> the case", () => {
    expect(officerNotificationTarget({ type: "CASE_ACCEPTED", caseId: "c1" }, exists)).toEqual({ pathname: "/officer/report-details", params: { id: "c1" } });
  });

  it.each(["PARKING_CHARGE_ISSUED", "CASE_CLOSED_WITHOUT_CHARGE"] as NotificationType[])("%s -> the completed case record", (type) => {
    expect(officerNotificationTarget({ type, caseId: "c1" }, exists)).toEqual({
      pathname: "/officer/inspection-completed",
      params: { id: "c1", from: "notifications" },
    });
  });

  it("safe fallback: no case id, unknown local case, malformed server id", () => {
    expect(officerNotificationTarget({ type: "SYSTEM" }, exists)).toBeNull();
    expect(officerNotificationTarget({ type: "PARKING_CHARGE_ISSUED" }, exists)).toBeNull();
    expect(officerNotificationTarget({ type: "CASE_ACCEPTED", caseId: "c-missing" }, exists)).toBeNull();
    expect(officerNotificationTarget({ type: "CASE_ACCEPTED", caseId: "not-a-uuid" }, () => false, { serverScoped: true })).toBeNull();
    expect(officerNotificationTarget({ type: "CASE_ACCEPTED", caseId: CASE_UUID }, () => false, { serverScoped: true })).toMatchObject({
      pathname: "/officer/report-details",
    });
  });

  it("every seeded notification resolves without throwing, and each target route exists", () => {
    const state = buildSeedState(new Date("2026-07-17T18:00:00.000Z"));
    const now = new Date("2026-07-17T18:00:00.000Z");
    const c = selectNotifications(state, { role: "CITIZEN", accountId: DEV_CITIZEN_ID }, now);
    const o = selectNotifications(state, { role: "OFFICER", accountId: DEV_OFFICER_ID }, now);
    expect(c.every((n) => n.type !== undefined)).toBe(true);
    const targets = [
      ...c.map((n) => citizenNotificationTarget(n, (id) => state.reports.some((r) => r.id === id && r.citizenId === DEV_CITIZEN_ID))),
      ...o.map((n) => officerNotificationTarget(n, (id) => state.cases.some((x) => x.id === id))),
    ].filter(Boolean);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(fs.existsSync(path.join(ROOT, "app", `${t!.pathname}.tsx`))).toBe(true);
  });

  it("the screens keep read/unread semantics (mark read after showing) and use the targets", () => {
    for (const [f, fn] of [["app/user/notifications.tsx", "markUserNotificationsRead"], ["app/officer/notifications.tsx", "markOfficerNotificationsRead"]]) {
      const src = read(f);
      expect(src).toMatch(new RegExp(`setTimeout\\(${fn}, 800\\)`));
      expect(src).toMatch(/serverScoped: dataSource === "BACKEND"/);
    }
    // The completed-case record opened from a notification goes back there.
    expect(read("app/officer/inspection-completed.tsx")).toMatch(/from && router\.canGoBack\(\) \? router\.back\(\)/);
  });
});

describe("unread badge", () => {
  it("hidden at 0, exact up to 99, capped at 99+", () => {
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(-1)).toBeNull();
    expect(unreadBadgeText(NaN)).toBeNull();
    expect(unreadBadgeText(1)).toBe("1");
    expect(unreadBadgeText(UNREAD_BADGE_CAP)).toBe("99");
    expect(unreadBadgeText(100)).toBe("99+");
    expect(unreadBadgeText(5000)).toBe("99+");
    expect(notificationsA11yLabel(0)).toBe("Notifications");
    expect(notificationsA11yLabel(250)).toBe("Notifications, 99+ unread");
  });

  it("counts come from the summaries (server-side in BACKEND), never the loaded page", () => {
    expect(read("app/user/home.tsx")).toMatch(/const unread = citizenSummary\.unread;/);
    expect(read("app/officer/home.tsx")).toMatch(/const unread = officerSummary\.unread;/);
    for (const f of ["app/user/home.tsx", "app/officer/home.tsx", "app/user/profile.tsx", "app/officer/profile.tsx"]) {
      const src = read(f);
      expect([f, /<UnreadBadge count=\{(unread|citizenSummary\.unread|o\.unread)\}/.test(src)]).toEqual([f, true]);
      expect([f, /items\.filter\(\(n\) => n\.unread\)/.test(src)]).toEqual([f, false]);
    }
    expect(read("src/context/AppContext.tsx")).toMatch(/unread: cs\.unread_notifications/);
  });

  it("bottom navigation structures are unchanged", () => {
    const { USER_NAV_ITEMS } = require("../../components/userNavItems");
    const { OFFICER_NAV_ITEMS } = require("../../components/officerNavItems");
    expect(USER_NAV_ITEMS.map((i: { label: string }) => i.label)).toEqual(["Home", "Parking", "Report", "Reports", "Profile"]);
    expect(OFFICER_NAV_ITEMS.map((i: { label: string }) => i.label)).toEqual(["Home", "Queue", "Map", "Cases", "Profile"]);
  });
});
