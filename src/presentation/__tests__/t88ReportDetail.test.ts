// T8.8: citizen report detail = permanent record (timeline, reward, gallery).
import * as fs from "fs";
import * as path from "path";
import { ENFORCEMENT_OUTCOME_CODES, EnforcementOutcomeCode } from "../../domain";
import { CITIZEN, expectOk, makeStore, OFFICER, snapshot, submitAndInspect } from "../../store/__tests__/helpers";
import { citizenReportTimeline, reportRewardStatus, selectCitizenReportDetail } from "../citizenReportDetail";
import { formatDateTime } from "../time";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const OFFICER_STATES = /ASSIGNED|EN_ROUTE|EN ROUTE|ON_SITE|ON SITE|INSPECTION|COMPLETED|Closed/i;

async function decided(code: EnforcementOutcomeCode) {
  const { store } = await makeStore();
  const { caseId, reportId } = submitAndInspect(store, `r-${code}`);
  expectOk(store.completeCase(caseId, code, OFFICER));
  return selectCitizenReportDetail(snapshot(store), CITIZEN, reportId)!;
}

describe("citizen report timeline", () => {
  it("a new report: Submitted (its time) -> Under review (current); no future steps invented", async () => {
    const { store } = await makeStore();
    const { reportId } = submitAndInspect(store, "fresh");
    const d = selectCitizenReportDetail(snapshot(store), CITIZEN, reportId)!;
    expect(d.timeline.map((s) => [s.key, s.state])).toEqual([
      ["SUBMITTED", "done"],
      ["UNDER_REVIEW", "current"],
    ]);
    expect(d.timeline[0].timeText).toBe(d.submittedAtText);
    // Local demo has no trusted receipt time: the step shows no time rather than a guessed one.
    expect(d.timeline[1].timeText).toBeUndefined();
  });

  it("CHARGE_ISSUED -> Verified (with its recorded time); REPORT_REJECTED -> Rejected", async () => {
    const v = await decided("CHARGE_ISSUED");
    expect(v.status).toBe("VERIFIED");
    expect(v.timeline.map((s) => s.key)).toEqual(["SUBMITTED", "UNDER_REVIEW", "VERIFIED"]);
    expect(v.timeline[2]).toMatchObject({ label: "Verified", state: "current", tone: "success" });
    expect(v.timeline[2].timeText).toMatch(/\d{2}:\d{2}$/);
    const r = await decided("REPORT_REJECTED");
    expect(r.timeline.map((s) => s.key)).toEqual(["SUBMITTED", "UNDER_REVIEW", "REJECTED"]);
    expect(r.timeline[2]).toMatchObject({ label: "Rejected", tone: "error" });
  });

  it.each(["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"] as const)(
    "%s leaves the citizen status Under review: no Rejected/Closed step, no reward",
    async (code) => {
      const d = await decided(code);
      expect(d.status).toBe("UNDER_REVIEW");
      expect(d.timeline.map((s) => s.key)).toEqual(["SUBMITTED", "UNDER_REVIEW"]);
      expect(d.timeline[1].state).toBe("current");
      expect(d.reward).toMatchObject({ kind: "none", title: "No reward", walletLink: false });
      // Nothing about the officer's reason leaks into the citizen record.
      expect(JSON.stringify(d)).not.toMatch(/moved|permit|duplicate|without charge/i);
    }
  );

  it("never shows officer case states, for any outcome", async () => {
    for (const code of ENFORCEMENT_OUTCOME_CODES) {
      const d = await decided(code);
      expect([code, d.timeline.some((s) => OFFICER_STATES.test(`${s.label} ${s.detail ?? ""}`))]).toEqual([code, false]);
    }
  });

  it("backend times: receipt time on Under review, resolvedAt on the decision", () => {
    const steps = citizenReportTimeline({
      status: "VERIFIED",
      submittedAt: "2026-10-07T09:00:00.000Z",
      receivedAt: "2026-10-07T09:00:04.000Z",
      resolvedAt: "2026-10-07T11:30:00.000Z",
      events: [],
    });
    expect(steps[1]).toMatchObject({ timeText: formatDateTime("2026-10-07T09:00:04.000Z"), detail: "Received by ParkWatch" });
    expect(steps[2].timeText).toBe(formatDateTime("2026-10-07T11:30:00.000Z"));
    // A decision without any recorded time shows no time.
    expect(citizenReportTimeline({ status: "REJECTED", submittedAt: "2026-10-07T09:00:00.000Z", events: [] })[2].timeText).toBeUndefined();
  });
});

describe("reward status on the report", () => {
  it("copy per ledger state", () => {
    expect(reportRewardStatus("UNDER_REVIEW", "PENDING", 500)).toMatchObject({ kind: "pending", title: "€5 reward pending verification", walletLink: false });
    expect(reportRewardStatus("VERIFIED", "AVAILABLE", 500)).toMatchObject({ kind: "earned", title: "€5 reward earned", walletLink: true });
    expect(reportRewardStatus("REJECTED", "VOID", 500)).toMatchObject({ kind: "none", title: "No reward", walletLink: false });
    expect(reportRewardStatus("UNDER_REVIEW", "VOID", 500)).toMatchObject({ kind: "none", walletLink: false });
    // No ledger entry: never invent an amount.
    expect(reportRewardStatus("VERIFIED", "NONE", undefined)).toMatchObject({ kind: "none" });
  });

  it("from the real store: pending while under review, earned + Wallet link when verified, none when rejected", async () => {
    const { store } = await makeStore();
    const { reportId } = submitAndInspect(store, "p");
    expect(selectCitizenReportDetail(snapshot(store), CITIZEN, reportId)!.reward.kind).toBe("pending");
    expect((await decided("CHARGE_ISSUED")).reward).toMatchObject({ kind: "earned", walletLink: true });
    expect((await decided("REPORT_REJECTED")).reward).toMatchObject({ kind: "none" });
  });
});

describe("report detail record", () => {
  it("contains every submitted photo in gallery order, the observed time and the location; unknown/other citizen -> null", async () => {
    const { store } = await makeStore();
    const { reportId } = submitAndInspect(store, "full");
    const s = snapshot(store);
    const d = selectCitizenReportDetail(s, CITIZEN, reportId)!;
    expect(d.evidence.map((e) => e.caption).slice(0, 3)).toEqual(["Front", "Side", "Rear"]);
    expect(d.requiredPhotoCount).toBe(3);
    expect(d.observedAtText).toMatch(/\d{2}:\d{2}$/);
    expect(d.address).toBeTruthy();
    expect(selectCitizenReportDetail(s, "someone-else", reportId)).toBeNull();
    expect(selectCitizenReportDetail(s, CITIZEN, "999999")).toBeNull();
    expect(selectCitizenReportDetail(s, CITIZEN, undefined)).toBeNull();
  });

  it("the screen uses the shared gallery, the detail selector, a map pin and a retryable missing state", () => {
    const src = read("app/user/report/report-overview.tsx");
    expect(src).toMatch(/<EvidenceThumbnails items=\{detail\.evidence\}/);
    expect(src).toMatch(/getCitizenReportDetail\(id\)/);
    expect(src).toMatch(/<LiveMap[^>]*reportPoint=\{detail\.point\}/);
    expect(src).toMatch(/label: "Try again", onPress: \(\) => ensureReport\(id\)/);
    expect(src).toMatch(/label="View in Wallet" small variant="outline" onPress=\{\(\) => router\.push\("\/user\/earnings"\)\}/);
    expect(src).not.toMatch(/submitReport|Place report|Submit Report|\bfine\b/);
  });
});
