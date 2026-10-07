import { CAPTURE_FAILED_MESSAGE, permissionView, takePhotoSafely } from "../../components/cameraCapture.logic";
import { isDraftValid, MVP_MOCK_DETECTED_VEHICLE, ok, fail, ReportDraft, validateDraft } from "../../domain";
import { getReporterDisplayProfile } from "../../store/reporterProfiles";
import { DEV_CITIZEN_ID } from "../../store/session";
import { CITIZEN, expectOk, makeStore, OFFICER, snapshot, submitAndInspect } from "../../store/__tests__/helpers";
import { selectCitizenReportById, toDraftReview, toSubmittedSummary, rewardDisplay } from "../citizenViews";
import { describeDomainError, draftIssueMessages } from "../errors";
import { CitizenDraftState, draftReducer, newDraftState, nextMissingSlot } from "../reportDraft";
import { createSubmitGuard } from "../submitGuard";

const T = "2026-07-17T18:00:00.000Z";

/** Drive a draft through the wizard the way the screens do. */
function filledDraft(id = "d1"): CitizenDraftState {
  let s = newDraftState(id);
  for (const slot of ["FRONT", "SIDE", "REAR"] as const) {
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot, uri: `file:///${id}-${slot}.jpg`, capturedAt: T });
  }
  s = draftReducer(s, { type: "SET_VIOLATION", violationId: "no-parking" });
  s = draftReducer(s, { type: "SET_LOCATION", address: "Mannerheimintie 45, Helsinki" });
  return s;
}

describe("new report draft lifecycle", () => {
  it("START_NEW gives a fresh draft: new id, no photos/violation/details/attachments, fresh mock vehicle", () => {
    let old = filledDraft("old");
    old = draftReducer(old, { type: "ADD_ATTACHMENT", uri: "file:///lib.jpg", pickedAt: T });
    const fresh = draftReducer(old, { type: "START_NEW", draftId: "new" });
    expect(fresh.draft.draftId).toBe("new");
    expect(fresh.draft.photos).toEqual({});
    expect(fresh.draft.violationId).toBeUndefined();
    expect(fresh.draft.location.address).toBe("");
    expect(fresh.draft.notes).toBe("");
    expect(fresh.draft.attachments).toEqual([]);
    expect(fresh.draft.vehicle).toEqual(MVP_MOCK_DETECTED_VEHICLE);
    expect(fresh.submittedReportId).toBeUndefined();
  });

  it("moving back/forward in the wizard (re-selecting, editing) never resets the draft", () => {
    const s = filledDraft("keep");
    const changed = draftReducer(s, { type: "SET_VIOLATION", violationId: "sidewalk" });
    expect(changed.draft.draftId).toBe("keep");
    expect(Object.keys(changed.draft.photos)).toHaveLength(3);
    expect(changed.draft.location.address).toBe("Mannerheimintie 45, Helsinki");
    expect(changed.draft.violationId).toBe("sidewalk"); // replaces the previous selection
  });

  it("a submitted draft is finished: further edits are ignored", () => {
    const done = draftReducer(filledDraft(), { type: "MARK_SUBMITTED", reportId: "12600" });
    const edited = draftReducer(done, { type: "SET_LOCATION", address: "Elsewhere" });
    expect(edited).toBe(done);
  });
});

describe("camera evidence", () => {
  it("captures are CAMERA evidence with type and capture time", () => {
    const photo = filledDraft().draft.photos.FRONT!;
    expect(photo).toMatchObject({ source: "CITIZEN", type: "FRONT", captureSource: "CAMERA", capturedAt: T });
  });

  it("needs all three required camera photos before continuing", () => {
    let s = newDraftState("d");
    expect(nextMissingSlot(s.draft)).toBe("FRONT");
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "FRONT", uri: "f", capturedAt: T });
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "REAR", uri: "r", capturedAt: T });
    expect(isDraftValid(s.draft, "PHOTOS")).toBe(false);
    expect(nextMissingSlot(s.draft)).toBe("SIDE");
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "SIDE", uri: "s", capturedAt: T });
    expect(isDraftValid(s.draft, "PHOTOS")).toBe(true);
  });

  it("a failed capture yields an error and NO photo (no fallback image)", async () => {
    await expect(takePhotoSafely(() => Promise.reject(new Error("no camera")))).resolves.toEqual({
      ok: false,
      message: CAPTURE_FAILED_MESSAGE,
    });
    await expect(takePhotoSafely(() => Promise.resolve(undefined))).resolves.toEqual({ ok: false, message: CAPTURE_FAILED_MESSAGE });
    const good = await takePhotoSafely(() => Promise.resolve({ uri: "file:///x.jpg" }), () => new Date(T));
    expect(good).toEqual({ ok: true, uri: "file:///x.jpg", capturedAt: T });
  });

  it("the camera component has no placeholder-image fallback left", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../../components/CameraCapture.tsx"), "utf8");
    expect(src).not.toMatch(/picsum|placeholder image|fallback/i);
  });

  it("permission UI: ask while the OS can prompt, otherwise point to settings", () => {
    expect(permissionView(null)).toBe("loading");
    expect(permissionView({ granted: true, canAskAgain: true })).toBe("granted");
    expect(permissionView({ granted: false, canAskAgain: true })).toBe("ask");
    expect(permissionView({ granted: false, canAskAgain: false })).toBe("settings");
  });

  it("a LIBRARY attachment never fills a required slot", () => {
    let s = newDraftState("d");
    s = draftReducer(s, { type: "ADD_ATTACHMENT", uri: "file:///lib.jpg", pickedAt: T });
    expect(s.draft.attachments[0]).toMatchObject({ type: "ATTACHMENT", captureSource: "LIBRARY" });
    expect(s.draft.photos).toEqual({});
    expect(isDraftValid(s.draft, "PHOTOS")).toBe(false);
  });

  it("attachments survive to submission as LIBRARY evidence, separate from the 3 camera photos", async () => {
    const { store } = await makeStore();
    const s = draftReducer(filledDraft("att"), { type: "ADD_ATTACHMENT", uri: "file:///lib.jpg", pickedAt: T });
    const { reportId } = expectOk(store.submitReport(s.draft, CITIZEN));
    const report = snapshot(store).reports.find((r) => r.id === reportId)!;
    expect(report.evidence.map((e) => [e.type, e.captureSource])).toEqual([
      ["FRONT", "CAMERA"],
      ["SIDE", "CAMERA"],
      ["REAR", "CAMERA"],
      ["ATTACHMENT", "LIBRARY"],
    ]);
  });
});

describe("location validation", () => {
  it("an empty (or whitespace) location blocks Continue/Submit with an inline message", () => {
    const empty: ReportDraft = { ...filledDraft().draft, location: { address: "  " } };
    expect(draftIssueMessages(validateDraft(empty, "DETAILS"))).toEqual({ location: "Enter the location of the vehicle." });
    expect(isDraftValid(empty, "SUBMIT")).toBe(false);
  });

  it("a real location passes", () => {
    expect(isDraftValid(filledDraft().draft, "SUBMIT")).toBe(true);
  });

  it("a brand-new draft has no placeholder location that could satisfy validation", () => {
    expect(newDraftState("d").draft.location.address).toBe("");
  });
});

describe("plate / vehicle display comes from the report object", () => {
  it("review shows the draft vehicle's raw plate (never the normalized key)", () => {
    const view = toDraftReview(filledDraft().draft, getReporterDisplayProfile(DEV_CITIZEN_ID));
    expect(view.vehicle).toEqual({ plate: "GHC-789", model: "Volvo XC60", color: "Dark Grey" });
    expect(JSON.stringify(view)).not.toContain("GHC789");
  });

  it("a different vehicle on the draft flows through unchanged (no hardcoded strings)", () => {
    const d = filledDraft().draft;
    const custom = { ...d, vehicle: { ...d.vehicle!, plate: { raw: "XYZ-9", normalized: "XYZ9" }, make: "Saab", model: "900" } };
    expect(toDraftReview(custom, getReporterDisplayProfile(DEV_CITIZEN_ID)).vehicle.plate).toBe("XYZ-9");
  });

  it("review shows no fake priority/validation claims and reads the reward from config", () => {
    const view = toDraftReview(filledDraft().draft, getReporterDisplayProfile(DEV_CITIZEN_ID));
    expect(view.estimatedRewardText).toBe("€5.00");
    expect(JSON.stringify(view)).not.toMatch(/High Priority|GPS matched|Duplicate|confidence/i);
  });
});

describe("submission", () => {
  it("double tap creates exactly one report, case and reward lifecycle", async () => {
    const { store } = await makeStore();
    const guard = createSubmitGuard();
    const draft = filledDraft().draft;
    const onSuccess = jest.fn();
    const first = guard.run(() => store.submitReport(draft, CITIZEN), { onSuccess, onError: jest.fn() });
    const second = guard.run(() => store.submitReport(draft, CITIZEN), { onSuccess, onError: jest.fn() });
    expect([first, second]).toEqual(["submitted", "ignored"]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const s = snapshot(store);
    expect([s.reports.length, s.cases.length, s.ledger.length]).toEqual([1, 1, 1]);
  });

  it("even without the UI guard, the same draft submitted twice stays one report", async () => {
    const { store } = await makeStore();
    const draft = filledDraft().draft;
    const a = expectOk(store.submitReport(draft, CITIZEN));
    const b = expectOk(store.submitReport(draft, CITIZEN));
    expect(b).toEqual({ reportId: a.reportId, created: false });
    expect(snapshot(store).reports).toHaveLength(1);
  });

  it("a failed submit unlocks for retry, reports the error, and leaves the draft untouched", () => {
    const guard = createSubmitGuard();
    const draft = filledDraft().draft;
    const before = JSON.stringify(draft);
    const onError = jest.fn();
    expect(guard.run(() => fail("INVALID_DRAFT", "x"), { onSuccess: jest.fn(), onError })).toBe("failed");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_DRAFT" }));
    expect(guard.isLocked()).toBe(false);
    expect(JSON.stringify(draft)).toBe(before);
    expect(guard.run(() => ok({ reportId: "1" }), { onSuccess: jest.fn(), onError })).toBe("submitted");
  });

  it("errors are shown as friendly messages, never raw codes", () => {
    const msg = describeDomainError({ code: "INVALID_DRAFT", message: "Draft d is incomplete: MISSING_LOCATION." }).message;
    expect(msg).not.toMatch(/INVALID_DRAFT|MISSING_/);
  });
});

describe("post-submission views", () => {
  it("Report Submitted shows the violation LABEL and formatted time, not raw values", async () => {
    const { store } = await makeStore();
    const { reportId } = expectOk(store.submitReport(filledDraft().draft, CITIZEN));
    const view = selectCitizenReportById(snapshot(store), CITIZEN, reportId)!;
    const summary = toSubmittedSummary(view);
    expect(summary.violation).toBe("No parking zone");
    expect(summary.violation).not.toBe("no-parking");
    expect(summary.vehicle).toBe("GHC-789 · Volvo XC60");
    expect(summary.statusLabel).toBe("Pending Review");
    expect(summary.submittedOn).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} at \d{2}:\d{2}$/);
    expect(summary.reward).toMatchObject({ state: "pending", amountText: "€5.00" });
  });

  it("the post-submission screens contain no submit / place-report action", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    for (const file of ["submitted.tsx", "report-overview.tsx"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "../../../app/user/report", file), "utf8");
      expect(src).not.toMatch(/submitReport|Place report|Submit Report/);
    }
  });
});

describe("report detail by id (deep-link ready)", () => {
  it("valid id loads; unknown id and another citizen's id are not found; lookup never mutates", async () => {
    const { store } = await makeStore();
    const { reportId } = expectOk(store.submitReport(filledDraft().draft, CITIZEN));
    const s = snapshot(store);
    const before = JSON.stringify(s);
    expect(selectCitizenReportById(s, CITIZEN, reportId)?.id).toBe(reportId);
    expect(selectCitizenReportById(s, CITIZEN, "nope")).toBeNull();
    expect(selectCitizenReportById(s, CITIZEN, undefined)).toBeNull();
    expect(selectCitizenReportById(s, "someone-else", reportId)).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
    expect(snapshot(store)).toBe(s);
  });
});

describe("reward display", () => {
  it("pending only when the ledger says pending; available when released; none otherwise", () => {
    expect(rewardDisplay({ reward: 5, rewardState: "estimated" })).toMatchObject({ state: "pending", chipLabel: "Pending", amountText: "€5.00" });
    expect(rewardDisplay({ reward: 5, rewardState: "rewarded" })).toMatchObject({ state: "available", chipLabel: "Rewarded" });
    expect(rewardDisplay({ reward: 5, rewardState: "none" })).toMatchObject({ state: "none", chipLabel: "No reward", amountText: "—" });
  });

  it("an unresolved outcome (status still Under Review) is NOT shown as €5 pending", async () => {
    const { store } = await makeStore();
    const { caseId, reportId } = submitAndInspect(store, "u1");
    expectOk(store.completeCase(caseId, "VEHICLE_MOVED", OFFICER));
    const view = selectCitizenReportById(snapshot(store), CITIZEN, reportId)!;
    expect(view.status).toBe("under-review");
    expect(rewardDisplay(view)).toMatchObject({ state: "none", chipLabel: "No reward" });
  });

  it("rejected reports show no reward; verified show rewarded", async () => {
    const { store } = await makeStore();
    const a = submitAndInspect(store, "a");
    const b = submitAndInspect(store, "b");
    expectOk(store.completeCase(a.caseId, "REPORT_REJECTED", OFFICER));
    expectOk(store.completeCase(b.caseId, "CHARGE_ISSUED", OFFICER));
    expect(rewardDisplay(selectCitizenReportById(snapshot(store), CITIZEN, a.reportId)!).state).toBe("none");
    expect(rewardDisplay(selectCitizenReportById(snapshot(store), CITIZEN, b.reportId)!).state).toBe("available");
  });
});

describe("My Reports and map helpers", () => {
  const { filterMyReports, myReportsEmptyState, reportStatusCounts } = require("../citizenViews") as typeof import("../citizenViews");
  const r = (id: string, status: "under-review" | "verified" | "rejected", coordinates?: { latitude: number; longitude: number }) =>
    ({ id, status, coordinates }) as never;

  it("tabs filter by status", () => {
    const list = [r("1", "under-review"), r("2", "verified"), r("3", "rejected")];
    expect(filterMyReports(list, "all")).toHaveLength(3);
    expect(filterMyReports(list, "verified").map((x: { id: string }) => x.id)).toEqual(["2"]);
  });

  it("empty list vs. filtered-empty states differ", () => {
    expect(myReportsEmptyState("all", 0, 0)).toMatchObject({ title: "No reports yet", showReportCta: true });
    expect(myReportsEmptyState("rejected", 4, 0)).toMatchObject({ title: "Nothing here", showReportCta: false, body: "No rejected reports." });
    expect(myReportsEmptyState("all", 4, 4)).toBeNull();
  });

  it("map counts come from the reports", () => {
    expect(reportStatusCounts([r("1", "verified"), r("2", "verified"), r("3", "rejected")])).toEqual({
      total: 3,
      verified: 2,
      underReview: 0,
      rejected: 1,
    });
  });
});

describe("evidence identity per capture (T8.4)", () => {
  it("a retaken photo gets a new evidence id (and storage path); the draft id never changes", () => {
    let s = newDraftState("draft-retake");
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "FRONT", uri: "file:///a.jpg", capturedAt: "2026-10-05T10:00:00.000Z" });
    const first = s.draft.photos.FRONT!.id;
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "FRONT", uri: "file:///b.jpg", capturedAt: "2026-10-05T10:00:05.000Z" });
    expect(s.draft.photos.FRONT!.id).not.toBe(first);
    expect(s.draft.photos.FRONT!.id.startsWith("draft-retake-FRONT-")).toBe(true);
    expect(s.draft.draftId).toBe("draft-retake");
  });

  it("RESTORE brings back the exact persisted draft (same id = same server submission)", () => {
    const restored = draftReducer(newDraftState("draft-new"), { type: "RESTORE", draft: { ...newDraftState("draft-old").draft, notes: "kept" } });
    expect(restored.draft).toMatchObject({ draftId: "draft-old", notes: "kept" });
    expect(restored.submittedReportId).toBeUndefined();
  });
});
