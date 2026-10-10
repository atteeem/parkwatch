// T9.0 operations console: local-demo implementation (same rules as the
// server functions), presentation helpers, and the route/role rules.
import * as fs from "fs";
import * as path from "path";
import { buildSeedState } from "../../store/seed";
import { ParkWatchState } from "../../store/state";
import {
  auditRows,
  caseDetail,
  caseRows,
  citizenRef,
  createLocalAdmin,
  matchesSearch,
  overview,
  paginate,
  reportDetail,
  reportRows,
  rewardRows,
  rewardStateOf,
  rewardSummary,
} from "../localAdmin";
import { auditDetails, auditEventText, CASE_STATUSES, dateRange, formatStamp, loadFailure, OUTCOME_CODES, outcomeText, pageSummary } from "../adminViews";
import { activeAdminNav, ADMIN_NAV } from "../adminNav";
import { allowedRoleApp, guardArea, homeFor, ROLE_HOME, routeArea, SessionView } from "../../navigation/roleGuard";
import { ADMIN_PAGE_SIZE } from "../adminTypes";
import { DEV_CITIZEN_ID } from "../../store/session";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const NOW = new Date(2026, 9, 10, 12, 0, 0);
const seed: ParkWatchState = buildSeedState(NOW);

describe("local console data (complete demo store)", () => {
  it("the seed has the variety the tests rely on", () => {
    expect(seed.reports.length).toBeGreaterThan(3);
    expect(seed.cases.some((c) => c.status === "COMPLETED")).toBe(true);
    expect(seed.cases.some((c) => c.status !== "COMPLETED")).toBe(true);
  });

  it("report filters: status, priority, case state, search by number and plate", () => {
    const all = reportRows(seed, {});
    expect(all).toHaveLength(seed.reports.length);
    for (const st of ["UNDER_REVIEW", "VERIFIED", "REJECTED"] as const) {
      const rows = reportRows(seed, { status: st });
      expect(rows.every((r) => r.status === st)).toBe(true);
      expect(rows).toHaveLength(seed.reports.filter((r) => r.status === st).length);
    }
    expect(reportRows(seed, { caseState: "completed" }).every((r) => r.caseStatus === "COMPLETED")).toBe(true);
    expect(reportRows(seed, { caseState: "active" }).every((r) => r.caseStatus && r.caseStatus !== "COMPLETED")).toBe(true);
    const one = all.find((r) => r.plate)!;
    expect(reportRows(seed, { search: `#${one.publicNumber}` }).map((r) => r.publicNumber)).toEqual([one.publicNumber]);
    expect(reportRows(seed, { search: one.plate!.toLowerCase().replace("-", " ") }).every((r) => r.plate === one.plate)).toBe(true);
    expect(reportRows(seed, { search: "NO-SUCH-PLATE-9" })).toEqual([]);
  });

  it("search rules match the server: number, '#number', plate fragment ignoring separators/case", () => {
    expect(matchesSearch("100023", 100023)).toBe(true);
    expect(matchesSearch("#100023", 100023)).toBe(true);
    expect(matchesSearch("10002", 100023, "ABC123")).toBe(false);
    expect(matchesSearch("abc-1", 1, "ABC123")).toBe(true);
    expect(matchesSearch("", 1)).toBe(true);
    expect(matchesSearch("  ", 1)).toBe(true);
  });

  it("newest first; pagination is disjoint with total and next offset", () => {
    const rows = reportRows(seed, {});
    const times = rows.map((r) => r.receivedAt ?? r.submittedAt);
    expect([...times].sort().reverse()).toEqual(times);
    const p1 = paginate(rows, 0, 2);
    const p2 = paginate(rows, 2, 2);
    expect(p1.total).toBe(rows.length);
    expect(p1.nextOffset).toBe(2);
    expect(p2.rows.some((r) => p1.rows.includes(r))).toBe(false);
    expect(paginate(rows, rows.length - 1, 2).nextOffset).toBeNull();
    expect(paginate([], 0, ADMIN_PAGE_SIZE)).toEqual({ rows: [], total: 0, nextOffset: null });
  });

  it("case filters per status, officer and outcome; parking charge only for CHARGE_ISSUED", () => {
    for (const st of CASE_STATUSES) expect(caseRows(seed, { status: st }).every((c) => c.status === st)).toBe(true);
    const rows = caseRows(seed, {});
    expect(rows).toHaveLength(seed.cases.length);
    for (const c of rows) {
      if (c.outcomeCode === "CHARGE_ISSUED") expect(c.parkingChargeCents).toBeGreaterThan(0);
      else expect(c.parkingChargeCents).toBeUndefined();
    }
    for (const code of OUTCOME_CODES) expect(caseRows(seed, { outcome: code }).every((c) => c.outcomeCode === code)).toBe(true);
    const officer = rows.find((c) => c.assignedOfficerId)?.assignedOfficerId;
    if (officer) expect(caseRows(seed, { officerId: officer }).every((c) => c.assignedOfficerId === officer)).toBe(true);
  });

  it("completed outcomes map 1:1 to the six codes with truthful wording (parking charge, never fine)", () => {
    expect(OUTCOME_CODES).toEqual(["CHARGE_ISSUED", "REPORT_REJECTED", "VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"]);
    expect(OUTCOME_CODES.map(outcomeText).join(" ")).not.toMatch(/fine/i);
    expect(outcomeText("CHARGE_ISSUED")).toBe("Parking charge issued");
  });

  it("report detail: evidence, case, outcome, reward state, ledger and history; unknown -> null", () => {
    const completed = seed.cases.find((c) => c.status === "COMPLETED" && c.outcome)!;
    const d = reportDetail(seed, Number(completed.reportId))!;
    expect(d.evidence.map((e) => e.caption).slice(0, 3)).toEqual(["Front", "Side", "Rear"]);
    expect(d.caseInfo?.status).toBe("COMPLETED");
    expect(d.outcome?.code).toBe(completed.outcome!.code);
    expect(d.audit.length).toBeGreaterThan(1);
    expect(d.citizenRef).toMatch(/^C-[0-9A-F]{8}$/);
    expect(JSON.stringify(d)).not.toContain(DEV_CITIZEN_ID);
    expect(reportDetail(seed, 999999999)).toBeNull();
    expect(caseDetail(seed, "no-such-case")).toBeNull();
  });

  it("case detail: citizen + officer evidence, checklist, outcome", () => {
    const c = seed.cases.find((x) => x.status === "COMPLETED" && seed.inspections[x.id])!;
    const d = caseDetail(seed, c.id)!;
    expect(d.citizenEvidence.length).toBeGreaterThanOrEqual(3);
    expect(d.inspection?.checks).toHaveLength(4);
    expect(d.outcome?.code).toBe(c.outcome?.code);
  });
});

describe("rewards: one per report, never double-counted", () => {
  it("state from the ledger: released > voided > pending", () => {
    const ledger = [
      { id: "1", idempotencyKey: "a", citizenId: "c", type: "REWARD_PENDING", amountCents: 500, reportId: "r1", createdAt: "t" },
      { id: "2", idempotencyKey: "b", citizenId: "c", type: "REWARD_RELEASED", amountCents: 500, reportId: "r1", createdAt: "t" },
      { id: "3", idempotencyKey: "c", citizenId: "c", type: "REWARD_PENDING", amountCents: 500, reportId: "r2", createdAt: "t" },
      { id: "4", idempotencyKey: "d", citizenId: "c", type: "REWARD_PENDING", amountCents: 500, reportId: "r3", createdAt: "t" },
      { id: "5", idempotencyKey: "e", citizenId: "c", type: "REWARD_VOIDED", amountCents: 500, reportId: "r3", createdAt: "t" },
    ] as const;
    expect(rewardStateOf(ledger as never, "r1")).toBe("AVAILABLE");
    expect(rewardStateOf(ledger as never, "r2")).toBe("PENDING");
    expect(rewardStateOf(ledger as never, "r3")).toBe("VOIDED");
    expect(rewardStateOf(ledger as never, "nope")).toBe("NONE");
  });

  it("summary counts each report once with its €5 amount", () => {
    const s = rewardSummary(seed);
    const withPending = seed.reports.filter((r) => seed.ledger.some((l) => l.reportId === r.id && l.type === "REWARD_PENDING")).length;
    expect(s.pendingCount + s.availableCount + s.voidedCount).toBe(withPending);
    expect(s.availableCents).toBe(s.availableCount * 500);
    expect(s.pendingCents).toBe(s.pendingCount * 500);
    const released = seed.ledger.filter((l) => l.type === "REWARD_RELEASED").length;
    expect(s.availableCount).toBe(released);
  });

  it("ledger rows keep their report relationship and amounts; withdrawals are not report rewards", () => {
    const rows = rewardRows(seed, {});
    for (const r of rows) {
      const entry = seed.ledger.find((l) => l.id === r.id)!;
      expect(Number(entry.reportId)).toBe(r.publicNumber);
      expect(entry.amountCents).toBe(r.amountCents);
    }
    expect(rows.some((r) => r.entryType.startsWith("WITHDRAWAL"))).toBe(false);
    expect(rewardRows(seed, { state: "PENDING" }).every((r) => r.rewardState === "PENDING")).toBe(true);
  });
});

describe("audit + overview", () => {
  it("audit filters: actor role, record type, report reference; newest first", () => {
    const all = auditRows(seed, {});
    expect(all.length).toBeGreaterThan(5);
    expect(auditRows(seed, { actorRole: "CITIZEN" }).every((e) => e.actorRole === "CITIZEN")).toBe(true);
    expect(auditRows(seed, { entityType: "reward" }).every((e) => e.entityType === "reward")).toBe(true);
    const n = all[0].publicNumber!;
    expect(auditRows(seed, { ref: String(n) }).every((e) => e.publicNumber === n)).toBe(true);
    const times = all.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("citizen actors are pseudonymous", () => {
    const citizenEvents = auditRows(seed, { actorRole: "CITIZEN" });
    expect(citizenEvents.length).toBeGreaterThan(0);
    const citizenIds = new Set(seed.reports.map((r) => r.citizenId));
    for (const e of citizenEvents) {
      expect(e.actorLabel).toMatch(/^C-[0-9A-F]{8}$/);
      expect(citizenIds.has(e.actorLabel)).toBe(false);
    }
    // Stable per citizen, different between citizens.
    expect(citizenRef(DEV_CITIZEN_ID)).toBe(citizenRef(DEV_CITIZEN_ID));
    expect(citizenRef("a")).not.toBe(citizenRef("b"));
  });

  it("overview counts come from the store (no invented numbers)", () => {
    const o = overview(seed, NOW);
    expect(o.casesActive).toBe(seed.cases.filter((c) => c.status !== "COMPLETED").length);
    expect(o.casesNew).toBe(seed.cases.filter((c) => c.status === "NEW").length);
    expect(o.reportsUnderReview).toBe(seed.reports.filter((r) => r.status === "UNDER_REVIEW").length);
    expect(o.last7Days).toHaveLength(7);
    expect(o.last7Days[6].day).toBe("2026-10-10");
    expect(Object.keys(o).join(" ")).not.toMatch(/revenue|collected|paid/i);
  });

  it("createLocalAdmin answers every console call", async () => {
    const api = createLocalAdmin(() => seed, () => NOW);
    for (const r of await Promise.all([api.whoami(), api.overview(), api.pageReports({}, 0), api.pageCases({}, 0), api.listOfficers(), api.pageRewards({}, 0), api.pageAudit({}, 0)])) {
      expect(r.ok).toBe(true);
    }
  });
});

describe("console presentation", () => {
  it("audit wording and safe details (no paths, URLs or tokens)", () => {
    expect(auditEventText("CASE_ACCEPTED")).toBe("Case accepted");
    expect(auditEventText("SOMETHING_NEW")).toBe("Something new");
    const text = auditDetails({ code: "CHARGE_ISSUED", amount_cents: 500, storage_path: "a/b.jpg", signed_url: "https://x", token: "t", nested: { a: 1 } });
    expect(text).toContain("Parking charge issued");
    expect(text).toContain("€5.00");
    expect(text).not.toMatch(/a\/b\.jpg|https|token/);
  });

  it("date presets are local calendar days", () => {
    expect(dateRange("all", NOW)).toEqual({});
    const t = dateRange("today", NOW);
    expect(new Date(t.from!)).toEqual(new Date(2026, 9, 10));
    expect(new Date(t.to!)).toEqual(new Date(2026, 9, 11));
    expect(new Date(dateRange("7d", NOW).from!)).toEqual(new Date(2026, 9, 4));
  });

  it("failures never show raw server text; FORBIDDEN -> no access; session -> sign in again", () => {
    expect(loadFailure({ code: "FORBIDDEN", message: "FORBIDDEN: raw" })).toEqual({ kind: "unauthorized" });
    expect(loadFailure({ code: "UNAUTHENTICATED", message: "x" })).toEqual({ kind: "session" });
    const e = loadFailure({ code: "BACKEND_ERROR", message: "relation public.x does not exist" });
    expect(e.kind).toBe("error");
    expect(JSON.stringify(e)).not.toMatch(/relation|does not exist/);
    expect(formatStamp(undefined)).toBe("—");
    expect(pageSummary(25, 140)).toBe("Showing 25 of 140");
    expect(pageSummary(3, 3)).toBe("3 results");
    expect(pageSummary(0, 0)).toBe("No results");
  });

  it("navigation: sections and the active item for nested routes", () => {
    expect(ADMIN_NAV.map((n) => n.label)).toEqual(["Overview", "Reports", "Cases", "Officers", "Rewards", "Audit log"]);
    expect(activeAdminNav("/admin")).toBe("/admin");
    expect(activeAdminNav("/admin/reports/100023")).toBe("/admin/reports");
    expect(activeAdminNav("/admin/cases/abc")).toBe("/admin/cases");
    expect(activeAdminNav("/admin/audit")).toBe("/admin/audit");
  });
});

describe("route guards for /admin", () => {
  const authed = (access: unknown): SessionView => ({ mode: "BACKEND", status: "authenticated", access: access as never, accessFailed: false });
  const STAFF = authed({ kind: "STAFF", role: "SUPERVISOR", organizations: [{ id: "o1" }] });

  it("/admin is its own area", () => {
    expect(routeArea("/admin")).toBe("admin");
    expect(routeArea("/admin/reports/1")).toBe("admin");
    expect(routeArea("/administration")).toBe("neutral");
    expect(ROLE_HOME.admin).toBe("/admin");
  });

  it.each([
    ["citizen", authed({ kind: "CITIZEN" }), "/user/home"],
    ["officer", authed({ kind: "OFFICER", organizations: [{ id: "o1" }] }), "/officer/home"],
    ["inactive staff", authed({ kind: "STAFF_NOT_AUTHORIZED", role: "SUPERVISOR" }), "/account/status"],
    ["officer without membership", authed({ kind: "OFFICER_NOT_AUTHORIZED" }), "/account/status"],
    ["signed out", { mode: "BACKEND", status: "unauthenticated" } as SessionView, "/auth/sign-in"],
  ])("%s cannot open /admin (redirect to %s)", (_l, view, to) => {
    expect(guardArea(view, "admin")).toEqual({ type: "redirect", to });
  });

  it("an active supervisor/admin opens /admin and nothing else", () => {
    expect(allowedRoleApp(STAFF)).toBe("admin");
    expect(homeFor(STAFF)).toBe("/admin");
    expect(guardArea(STAFF, "admin")).toEqual({ type: "allow" });
    expect(guardArea(STAFF, "officer")).toEqual({ type: "redirect", to: "/admin" });
    expect(guardArea(STAFF, "citizen")).toEqual({ type: "redirect", to: "/admin" });
  });

  it("loading waits instead of redirecting", () => {
    expect(guardArea({ mode: "BACKEND", status: "loading" }, "admin")).toEqual({ type: "loading" });
  });

  it("the /admin layout uses the guard; every console page goes through useApp().admin (no direct backend use)", () => {
    expect(read("app/admin/_layout.tsx")).toMatch(/<AreaGuard area="admin">/);
    const pages = ["app/admin/index.tsx", "app/admin/reports/index.tsx", "app/admin/reports/[number].tsx", "app/admin/cases/index.tsx", "app/admin/cases/[id].tsx", "app/admin/officers.tsx", "app/admin/rewards.tsx", "app/admin/audit.tsx"];
    for (const p of pages) {
      const src = read(p);
      expect([p, /src\/backend|supabase/.test(src)]).toEqual([p, false]);
      expect([p, /\bfines?\b/i.test(src.replace(/\/\/.*$/gm, ""))]).toEqual([p, false]);
    }
  });

  it("the console API is read-only (no write methods)", () => {
    const types = read("src/admin/adminTypes.ts");
    const api = types.slice(types.indexOf("export type AdminApi"));
    expect(api).not.toMatch(/\b(set|update|assign|reassign|delete|create|complete|accept|approve|pay|withdraw)\w*\(/i);
    expect(read("src/backend/admin/adminOperations.ts")).not.toMatch(/\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});

describe("audit details readability", () => {
  it("checklist, officer photos and ids", () => {
    expect(auditDetails({ check: "plateMatches", answer: true })).toBe("License plate matches · confirmed");
    expect(auditDetails({ check: "vehiclePresent", answer: false })).toBe("Vehicle present · not confirmed");
    expect(auditDetails({ type: "VEHICLE_FRONT", case_id: "79e6bedb-c67d-4b03-8b7b-9d0b4758235a" })).toBe("Vehicle front photo");
    expect(auditDetails({ public_report_number: 100000 })).toBe("");
  });
});
