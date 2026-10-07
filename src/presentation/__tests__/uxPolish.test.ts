// T8.6 mobile UX polish: empty-state copy/CTA decisions, reduced-motion logic,
// pure animation helpers, info-page content and the settings-row contract.
import * as fs from "fs";
import * as path from "path";
import {
  CITIZEN_MAP_EMPTY,
  CITIZEN_NOTIFICATIONS_EMPTY,
  EARNINGS_EMPTY,
  HOME_LATEST_EMPTY,
  OFFICER_HOME_NO_ACTIVE,
  OFFICER_HOME_NO_NEW,
  OFFICER_MAP_EMPTY,
  OFFICER_NOTIFICATIONS_EMPTY,
  PARKING_HISTORY_EMPTY,
  TRANSACTION_HISTORY_EMPTY,
  VEHICLES_EMPTY,
  casesEmpty,
  myReportsEmpty,
  queueEmpty,
  type EmptyCopy,
} from "../emptyStates";
import type { CasesTab, QueueFilter } from "../officerViews";
import { MOTION, motionDuration, pressScale } from "../../constants/motion";
import { interpolateValue } from "../../components/motion/AnimatedNumber";
import { progressFraction } from "../../components/motion/ProgressBar";
import { clampedOpacity } from "../../components/motion/clampedOpacity";
import { Animated } from "react-native";
import { DRAFT_LEGAL_LABEL, INFO_PAGES, INFO_PAGE_ROUTE, type InfoPage } from "../../content/infoPages";
import { NOT_AVAILABLE_YET, rowKind } from "../../components/SettingsRow";
import { USER_NAV_ITEMS } from "../../components/userNavItems";
import { OFFICER_NAV_ITEMS } from "../../components/officerNavItems";

const QUEUE_FILTERS: QueueFilter[] = ["All", "New", "High Priority", "Assigned"];
const CASES_TABS: CasesTab[] = ["All", "Completed", "Issued", "Rejected"];

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("empty states: required copy", () => {
  it("citizen copy matches the spec", () => {
    expect(HOME_LATEST_EMPTY).toMatchObject({ title: "No reports yet", action: { label: "Create first report", kind: "createReport" } });
    expect(CITIZEN_NOTIFICATIONS_EMPTY.title).toBe("You're all caught up");
    expect(CITIZEN_NOTIFICATIONS_EMPTY.action).toBeUndefined();
    expect(EARNINGS_EMPTY).toMatchObject({ title: "Your first reward starts with a verified report", action: { label: "Make a report", kind: "createReport" } });
    expect(TRANSACTION_HISTORY_EMPTY.action).toBeUndefined();
    expect(PARKING_HISTORY_EMPTY.action).toEqual({ label: "Go to Parking", kind: "startParking" });
    // My Vehicles already has a permanent "Add Vehicle" button: no duplicate CTA.
    expect(VEHICLES_EMPTY.action).toBeUndefined();
    expect(CITIZEN_MAP_EMPTY.action).toBeUndefined();
  });

  it("officer copy matches the spec", () => {
    expect(OFFICER_HOME_NO_NEW.title).toBe("Area clear");
    expect(OFFICER_HOME_NO_NEW.action).toBeUndefined();
    expect(OFFICER_HOME_NO_ACTIVE).toMatchObject({ title: "No active assignment", action: { label: "Open Queue", kind: "openQueue" } });
    expect(OFFICER_NOTIFICATIONS_EMPTY.title).toBe("No new alerts");
    expect(OFFICER_MAP_EMPTY).toMatchObject({ title: "No reports match this view", action: { kind: "openQueue" } });
  });
});

describe("empty states: My Reports", () => {
  it("no reports at all -> invite the first report on every tab", () => {
    for (const tab of ["all", "under-review", "verified", "rejected"] as const) {
      expect(myReportsEmpty(tab, 0).action?.kind).toBe("createReport");
    }
  });

  it("an empty tab while other reports exist explains the tab, with no CTA", () => {
    expect(myReportsEmpty("under-review", 3)).toMatchObject({ title: "No reports under review" });
    expect(myReportsEmpty("verified", 3).title).toBe("No verified reports yet");
    expect(myReportsEmpty("rejected", 3).title).toBe("No rejected reports");
    for (const tab of ["under-review", "verified", "rejected"] as const) expect(myReportsEmpty(tab, 3).action).toBeUndefined();
  });
});

describe("empty states: officer Queue filters", () => {
  it("every filter has its own title", () => {
    const titles = QUEUE_FILTERS.map((f) => queueEmpty(f, 0).title);
    expect(new Set(titles).size).toBe(QUEUE_FILTERS.length);
  });

  it("'Show all reports' only when a narrower filter is empty but open reports exist", () => {
    expect(queueEmpty("All", 5).action).toBeUndefined();
    expect(queueEmpty("All", 0).action).toBeUndefined();
    for (const f of QUEUE_FILTERS.filter((x) => x !== "All")) {
      expect(queueEmpty(f, 0).action).toBeUndefined();
      expect(queueEmpty(f, 2).action).toEqual({ label: "Show all reports", kind: "showAllQueue" });
    }
  });

  it("queueEmpty does not mutate its shared copy", () => {
    queueEmpty("New", 4);
    expect(queueEmpty("New", 0).action).toBeUndefined();
  });

  it("Cases: every tab has copy; only All offers Open Queue", () => {
    for (const t of CASES_TABS) expect(casesEmpty(t).title.length).toBeGreaterThan(0);
    expect(CASES_TABS.filter((t) => casesEmpty(t).action).map((t) => [t, casesEmpty(t).action?.kind])).toEqual([["All", "openQueue"]]);
  });
});

describe("empty states: truthful wording", () => {
  const all: EmptyCopy[] = [
    HOME_LATEST_EMPTY, CITIZEN_NOTIFICATIONS_EMPTY, EARNINGS_EMPTY, TRANSACTION_HISTORY_EMPTY, PARKING_HISTORY_EMPTY,
    VEHICLES_EMPTY, CITIZEN_MAP_EMPTY, OFFICER_HOME_NO_NEW, OFFICER_HOME_NO_ACTIVE, OFFICER_NOTIFICATIONS_EMPTY, OFFICER_MAP_EMPTY,
    ...(["all", "under-review", "verified", "rejected"] as const).flatMap((t) => [myReportsEmpty(t, 0), myReportsEmpty(t, 1)]),
    ...QUEUE_FILTERS.flatMap((f) => [queueEmpty(f, 0), queueEmpty(f, 1)]),
    ...CASES_TABS.map(casesEmpty),
  ];
  it("no demo wording, guarantees or invented timings", () => {
    for (const c of all) {
      const text = `${c.title} ${c.body} ${c.action?.label ?? ""}`;
      expect([c.title, /\bdemo\b|guarantee|minutes|hours|push notification/i.test(text)]).toEqual([c.title, false]);
    }
  });
});

describe("empty-state CTAs route to real flows", () => {
  it("create-report CTAs start a fresh draft and open the photo step", () => {
    for (const f of ["app/user/home.tsx", "app/user/reports.tsx", "app/user/earnings.tsx"]) {
      const src = read(f);
      expect([f, /startNewReport\(\);\s*router\.push\("\/user\/report\/photos"\)/.test(src)]).toEqual([f, true]);
    }
    expect(read("app/user/home.tsx")).toMatch(/copy=\{HOME_LATEST_EMPTY\}[^>]*onAction=\{startReport\}/);
    expect(read("app/user/reports.tsx")).toMatch(/onAction=\{startReport\}/);
  });

  it("parking history opens the parking hub; queue CTAs open the queue; Show all resets the filter", () => {
    expect(read("app/user/parking/history.tsx")).toMatch(/copy=\{PARKING_HISTORY_EMPTY\} onAction=\{\(\) => router\.replace\("\/user\/parking"\)\}/);
    expect(read("app/officer/home.tsx")).toMatch(/copy=\{OFFICER_HOME_NO_ACTIVE\}[^>]*onAction=\{\(\) => router\.replace\("\/officer\/queue"\)\}/);
    expect(read("app/officer/map.tsx")).toMatch(/copy=\{OFFICER_MAP_EMPTY\}[^>]*onAction=\{\(\) => router\.replace\("\/officer\/queue"\)\}/);
    expect(read("app/officer/cases.tsx")).toMatch(/copy=\{casesEmpty\(tab\)\} onAction=\{\(\) => router\.replace\("\/officer\/queue"\)\}/);
    expect(read("app/officer/queue.tsx")).toMatch(/onAction=\{\(\) => setFilter\("All"\)\}/);
  });

  it("list empty states wait for the first page (no flash of 'empty' while loading)", () => {
    for (const f of ["app/user/notifications.tsx", "app/officer/notifications.tsx", "app/officer/cases.tsx", "app/user/reports.tsx"]) {
      expect([f, /listSettledEmpty\(/.test(read(f))]).toEqual([f, true]);
    }
    expect(read("app/officer/home.tsx")).toMatch(/fresh\.loaded && !fresh\.loading/);
    expect(read("app/officer/home.tsx")).toMatch(/assigned\.loaded && !assigned\.loading/);
  });
});

describe("motion: reduced motion and pure helpers", () => {
  it("durations collapse to 0 with Reduce Motion", () => {
    expect(motionDuration(MOTION.SCREEN, false)).toBe(MOTION.SCREEN);
    expect(motionDuration(MOTION.SCREEN, true)).toBe(0);
    expect(motionDuration(MOTION.SUCCESS, true)).toBe(0);
  });

  it("press scale: 0.98 normally, none when disabled or with Reduce Motion", () => {
    expect(pressScale({ reduceMotion: false })).toBe(0.98);
    expect(pressScale({ reduceMotion: true })).toBe(1);
    expect(pressScale({ reduceMotion: false, disabled: true })).toBe(1);
  });

  it("timings stay within the spec (press 120-150 ms, success <= 600 ms)", () => {
    expect(MOTION.FAST).toBeGreaterThanOrEqual(120);
    expect(MOTION.FAST).toBeLessThanOrEqual(150);
    expect(MOTION.SUCCESS).toBeLessThanOrEqual(600);
    expect(MOTION.SHEET_Y_OFFSET).toBe(30);
  });

  it("interpolateValue is clamped and exact at the ends", () => {
    expect(interpolateValue(0, 10, 0)).toBe(0);
    expect(interpolateValue(0, 10, 1)).toBe(10);
    expect(interpolateValue(0, 10, 0.5)).toBe(5);
    expect(interpolateValue(10, 0, 2)).toBe(0);
    expect(interpolateValue(10, 0, -1)).toBe(10);
  });

  it("clampedOpacity keeps opacity in 0..1 when the progress overshoots", () => {
    const at = (v: number) => (clampedOpacity(new Animated.Value(v)) as unknown as { __getValue(): number }).__getValue();
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBe(0.5);
    expect(at(1)).toBe(1);
    expect(at(1.15)).toBe(1); // spring / Easing.back overshoot
    expect(at(-0.1)).toBe(0);
  });

  it("FadeIn and SuccessMark use the clamped opacity (scale overshoot kept)", () => {
    const fade = read("src/components/motion/FadeIn.tsx");
    expect(fade).toMatch(/opacity: clampedOpacity\(progress\)/);
    expect(fade).not.toMatch(/opacity: progress\b/);
    const mark = read("src/components/motion/SuccessMark.tsx");
    expect(mark).toMatch(/opacity: clampedOpacity\(circle\)/);
    expect(mark).toMatch(/Easing\.back/);
    // Reduce Motion still shows both immediately.
    expect(mark).toMatch(/if \(total === 0\) \{\s*circle\.setValue\(1\);\s*check\.setValue\(1\);/);
  });

  it("progressFraction guards zero totals and overflow", () => {
    expect(progressFraction(0, 0)).toBe(0);
    expect(progressFraction(2, 4)).toBe(0.5);
    expect(progressFraction(9, 4)).toBe(1);
    expect(progressFraction(-1, 4)).toBe(0);
  });
});

describe("bottom navigation is unchanged by the polish", () => {
  it("labels and order", () => {
    expect(USER_NAV_ITEMS.map((i) => i.label)).toEqual(["Home", "Parking", "Report", "Reports", "Profile"]);
    expect(OFFICER_NAV_ITEMS.map((i) => i.label)).toEqual(["Home", "Queue", "Map", "Cases", "Profile"]);
  });

  it("both navs render NavTab with their unchanged press handlers", () => {
    for (const f of ["src/components/UserBottomNav.tsx", "src/components/OfficerBottomNav.tsx"]) {
      const src = read(f);
      expect([f, /<NavTab/.test(src), /tabNavigation\(/.test(src)]).toEqual([f, true, true]);
    }
    expect(read("src/components/NavTab.tsx")).toMatch(/accessibilityRole="tab"/);
    expect(read("src/components/NavTab.tsx")).toMatch(/accessibilityState=\{\{ selected: active \}\}/);
  });
});

describe("informational pages", () => {
  const pages = Object.values(INFO_PAGES);
  const text = (p: InfoPage) =>
    [p.title, p.subtitle, p.notice?.text ?? "", ...p.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join(" ");

  it("every page has a real route file", () => {
    for (const [id, route] of Object.entries(INFO_PAGE_ROUTE)) {
      const file = `app${route}.tsx`;
      expect([id, fs.existsSync(path.join(ROOT, file))]).toEqual([id, true]);
      expect(read(file)).toContain(`INFO_PAGES["${id}"]`);
    }
  });

  it("legal pages are labelled as drafts and say the final text is not published", () => {
    for (const id of ["terms", "privacy-policy"] as const) {
      expect(INFO_PAGES[id].notice?.label).toBe(DRAFT_LEGAL_LABEL);
      expect(INFO_PAGES[id].notice?.text).toMatch(/ha(s|ve) not been published/);
    }
    expect(DRAFT_LEGAL_LABEL).toMatch(/Draft/);
  });

  it("no page claims unavailable features exist or promises dates", () => {
    for (const p of pages) {
      const t = text(p);
      expect([p.id, /\b(coming soon|soon|next month|in 20\d\d|you will (earn|receive|be paid))\b/i.test(t)]).toEqual([p.id, false]);
      // Any mention of a guarantee is a negation ("does not guarantee").
      for (const m of t.matchAll(/(\S+\s+\S+)\s+guarantee/gi)) expect([p.id, m[1]]).toEqual([p.id, "does not"]);
    }
    // Where withdrawals / push / deletion are mentioned, they are described as unavailable.
    expect(text(INFO_PAGES.about)).toMatch(/Push and email notifications are not available/);
    expect(text(INFO_PAGES["privacy-data"])).toMatch(/Deleting your account from inside the app is not available yet/);
  });

  it("Help outcomes match the citizen outcome rules (other closures leave status unchanged, no notification)", () => {
    const t = text(INFO_PAGES.help);
    expect(t).toMatch(/Verified and rejected reports update the report's status/);
    expect(t).toMatch(/closed for another reason, the report's status currently stays as it is and no outcome notification is sent/);
    // Not the old blanket claim that every no-charge closure shows up as a status.
    expect(t).not.toMatch(/closed without a parking charge, or rejected/);
    expect(t).not.toMatch(/end up verified/);
  });

  it("withdrawal copy separates the simulated local-demo request from a real payout", () => {
    for (const id of ["help", "about"] as const) {
      const t = text(INFO_PAGES[id]);
      expect([id, /Real withdrawals are not available/.test(t)]).toEqual([id, true]);
      expect([id, /local demo, a simulated withdrawal request can be recorded, but no bank transfer is made/.test(t)]).toEqual([id, true]);
      expect([id, /Withdrawing money is not available|Withdrawals, payment methods/.test(t)]).toEqual([id, false]);
    }
  });

  it("location copy allows foreground report/map use and rules out background tracking", () => {
    for (const id of ["help", "privacy-data"] as const) {
      const t = text(INFO_PAGES[id]);
      expect([id, /while relevant report or map screens are open/.test(t)]).toEqual([id, true]);
      expect([id, /does not track your location in the background/.test(t)]).toEqual([id, true]);
      expect([id, /read once|location once/.test(t)]).toEqual([id, false]);
    }
  });

  it("outcomes are described as human decisions", () => {
    expect(text(INFO_PAGES.help)).toMatch(/does not make enforcement decisions automatically/);
    expect(text(INFO_PAGES["officer-help"])).toMatch(/The app never decides for you/);
  });
});

describe("settings rows", () => {
  it("row kinds", () => {
    expect(rowKind({ onPress: () => undefined })).toBe("action");
    expect(rowKind({ unavailable: true })).toBe("unavailable");
    expect(rowKind({})).toBe("info");
    // An onPress always wins: a row is never both tappable and dimmed.
    expect(rowKind({ onPress: () => undefined, unavailable: true })).toBe("action");
  });

  it("unavailable default wording is neutral (no 'demo', no promise)", () => {
    expect(NOT_AVAILABLE_YET).toBe("Not available yet");
    for (const f of ["app/user/profile.tsx", "app/user/settings.tsx", "app/officer/profile.tsx"]) {
      expect([f, /Not available in demo/.test(read(f))]).toEqual([f, false]);
    }
  });
});
