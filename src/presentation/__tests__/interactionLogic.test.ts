// T7.6 logic: reports shortcuts, notification targets, settings rows and the
// complete wallet history.
import { HOME_REPORT_SHORTCUTS, initialReportsTab, selectCitizenReportById } from "../citizenViews";
import { selectNotifications } from "../viewModels";
import { selectWalletActivity } from "../walletViews";
import { citizenNotificationTarget, officerNotificationTarget } from "../../navigation/notificationTargets";
import { rowKind } from "../../components/SettingsRow";
import { buildSeedState } from "../../store/seed";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../../store/session";
import { draft, expectOk, makeStore, NOW, snapshot } from "../../store/__tests__/helpers";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("My Reports shortcuts", () => {
  it("Active Reports opens Under Review; Report History opens All; the plain Reports tab opens All", () => {
    expect(initialReportsTab(HOME_REPORT_SHORTCUTS.activeReports.params.tab)).toBe("under-review");
    expect(initialReportsTab(HOME_REPORT_SHORTCUTS.reportHistory.params.tab)).toBe("all");
    expect(initialReportsTab(undefined)).toBe("all");
    expect(HOME_REPORT_SHORTCUTS.activeReports.pathname).toBe("/user/reports");
    expect(HOME_REPORT_SHORTCUTS.activeReports).not.toEqual(HOME_REPORT_SHORTCUTS.reportHistory);
  });

  it("unknown or array params fall back safely", () => {
    expect(initialReportsTab("nonsense")).toBe("all");
    expect(initialReportsTab(["verified", "x"])).toBe("verified");
  });
});

describe("notification targets", () => {
  const state = buildSeedState(NOW);
  const citizenNotifs = selectNotifications(state, { role: "CITIZEN", accountId: DEV_CITIZEN_ID }, NOW);
  const owns = (id: string) => selectCitizenReportById(state, DEV_CITIZEN_ID, id) !== null;

  it("citizen notification views carry the report id from the domain notification", () => {
    const linked = citizenNotifs.filter((n) => n.reportId);
    expect(linked.length).toBeGreaterThan(0);
    for (const n of linked) {
      const domain = state.notifications.find((d) => d.id === n.id)!;
      expect(n.reportId).toBe(domain.reportId);
    }
  });

  it("a notification about the citizen's own report opens that report's overview", () => {
    const n = citizenNotifs.find((x) => x.reportId === "12556")!;
    expect(citizenNotificationTarget(n, owns)).toEqual({ pathname: "/user/report/report-overview", params: { id: "12556" } });
  });

  it("no report id, or someone else's report -> not openable", () => {
    const system = citizenNotifs.find((x) => !x.reportId)!;
    expect(system).toBeDefined();
    expect(citizenNotificationTarget(system, owns)).toBeNull();
    expect(citizenNotificationTarget({ reportId: "12573" }, owns)).toBeNull(); // citizen-sara's report
  });

  it("officer notifications still open their case, and only existing ones", () => {
    const n = selectNotifications(state, { role: "OFFICER", accountId: DEV_OFFICER_ID }, NOW).find((x) => x.caseId)!;
    const exists = (id: string) => state.cases.some((c) => c.id === id);
    expect(officerNotificationTarget(n, exists)).toEqual({ pathname: "/officer/report-details", params: { id: n.caseId } });
    expect(officerNotificationTarget({ caseId: "c-missing" }, exists)).toBeNull();
    expect(officerNotificationTarget({}, exists)).toBeNull();
  });
});

describe("settings rows", () => {
  it("only rows with a real action are pressable", () => {
    expect(rowKind({ onPress: () => {} })).toBe("action");
    expect(rowKind({ unavailable: true })).toBe("unavailable");
    expect(rowKind({})).toBe("info");
  });
});

describe("transaction history", () => {
  it("contains every wallet activity kind from the ledger, newest first", async () => {
    const { store, advance } = await makeStore({ seed: buildSeedState });
    expectOk(store.submitReport(draft("t76"), DEV_CITIZEN_ID)); // a pending reward
    advance(60_000);
    expectOk(store.requestWithdrawal(DEV_CITIZEN_ID, 1000)); // a requested (unpaid) withdrawal
    const items = selectWalletActivity(snapshot(store), DEV_CITIZEN_ID);
    expect(new Set(items.map((i) => i.kind))).toEqual(
      new Set(["REWARD_AVAILABLE", "REWARD_PENDING", "REWARD_CANCELLED", "WITHDRAWAL_REQUESTED", "WITHDRAWAL_PAID", "OPENING_BALANCE"])
    );
    const times = items.map((i) => i.at);
    expect([...times].sort((a, b) => b.localeCompare(a))).toEqual(times);
    expect(items[0].kind).toBe("WITHDRAWAL_REQUESTED");
  });
});
