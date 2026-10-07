// T8.8: officer evidence cohesion (inspection gallery, captured-photo viewer)
// and the completed-case record.
import * as fs from "fs";
import * as path from "path";
import { EnforcementOutcomeCode, ENFORCEMENT_OUTCOME_CODES } from "../../domain";
import { expectOk, makeStore, NOW, OFFICER, snapshot, submitAndInspect } from "../../store/__tests__/helpers";
import { officerGalleryIndex, officerGalleryItems } from "../evidenceGallery";
import { toCaseRecord } from "../officerViews";
import { OUTCOME_LABEL, outcomeLabel, selectCaseDetail, selectOfficerCases, toInspectionView } from "../viewModels";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

async function record(code: EnforcementOutcomeCode, opts?: { photos?: boolean; checks?: boolean }) {
  const { store } = await makeStore();
  const { caseId } = submitAndInspect(store, `d-${code}`, opts);
  expectOk(store.completeCase(caseId, code, OFFICER, "Checked on site"));
  const s = snapshot(store);
  const c = selectOfficerCases(s, NOW).find((x) => x.id === caseId)!;
  return toCaseRecord(c, toInspectionView(caseId, s.inspections[caseId]), selectCaseDetail(s, caseId, NOW));
}

describe("officer captured-evidence viewer", () => {
  it("only captured photos, in slot order, with their captions; index per type", () => {
    const photos = { VEHICLE_FRONT: "f.jpg", PARKING_SIGN: "s.jpg", VEHICLE_REAR: undefined };
    expect(officerGalleryItems(photos).map((i) => [i.caption, i.uri])).toEqual([
      ["Vehicle front", "f.jpg"],
      ["Parking sign", "s.jpg"],
    ]);
    expect(officerGalleryIndex(photos, "PARKING_SIGN")).toBe(1);
    expect(officerGalleryIndex(photos, "LICENSE_PLATE")).toBeNull();
    expect(officerGalleryItems({})).toEqual([]);
  });

  it("inspection: tap a captured photo views it; Retake is a separate button; empty slot captures", () => {
    const src = read("app/officer/inspection.tsx");
    expect(src).toMatch(/onPress=\{\(\) => \(viewAt !== null \? setGallery\(\{ kind: "officer", index: viewAt \}\) : capture\(t\.key\)\)\}/);
    expect(src).toMatch(/accessibilityLabel=\{`Retake \$\{t\.label\} photo`\}/);
    expect(src).toMatch(/onPress=\{\(\) => capture\(t\.key\)\}\s*style=\{styles\.retakeBtn\}/);
    // The old "tap captured = retake" behaviour is gone.
    expect(src).not.toMatch(/captured, tap to retake/);
  });

  it("inspection: the report photo opens the citizen gallery at photo 1, one shared gallery for both sets", () => {
    const src = read("app/officer/inspection.tsx");
    expect(src).toMatch(/onPress=\{\(\) => setGallery\(\{ kind: "citizen", index: 0 \}\)\}/);
    expect(src).toMatch(/const citizenEvidence = getCaseDetail\(c\.id\)\?\.evidence \?\? \[\];/);
    expect(src.match(/<EvidenceGallery\b/g)).toHaveLength(1);
    expect(src).toMatch(/items=\{gallery\?\.kind === "officer" \? officerEvidence : citizenEvidence\}/);
  });
});

describe("completed case record", () => {
  it("outcome labels", () => {
    expect(OUTCOME_LABEL).toEqual({
      CHARGE_ISSUED: "Parking charge issued",
      REPORT_REJECTED: "Report rejected",
      VEHICLE_MOVED: "Vehicle moved",
      VALID_PERMIT: "Valid permit",
      DUPLICATE: "Duplicate report",
      OTHER: "Closed without charge",
    });
    for (const code of ENFORCEMENT_OUTCOME_CODES) expect(outcomeLabel(code)).toBe(OUTCOME_LABEL[code]);
  });

  it("CHARGE_ISSUED: €60 charge, decision time, checklist, both evidence sets, notes", async () => {
    const r = (await record("CHARGE_ISSUED"))!;
    expect(r).toMatchObject({ statusLabel: "Completed", outcomeLabel: "Parking charge issued", chargeText: "€60.00", notes: "Checked on site" });
    expect(r.completedAtText).toMatch(/\d{2}:\d{2}$/);
    expect(r.checklist!.map((x) => x.answer)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"]);
    expect(r.citizenEvidence.map((e) => e.caption).slice(0, 3)).toEqual(["Front", "Side", "Rear"]);
    expect(r.officerEvidence.map((e) => e.caption)).toEqual(["Vehicle front", "License plate", "Parking sign", "Vehicle rear"]);
  });

  it.each(["REPORT_REJECTED", "VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"] as const)("%s: no parking charge line", async (code) => {
    const r = (await record(code, { photos: false, checks: false }))!;
    expect(r.outcomeLabel).toBe(OUTCOME_LABEL[code]);
    expect(r.chargeText).toBeUndefined();
    // Recorded truthfully: unanswered checks stay unanswered, no officer photos invented.
    expect(r.checklist!.every((x) => x.answer === "not-answered")).toBe(true);
    expect(r.officerEvidence).toEqual([]);
  });

  it("not completed -> no record", async () => {
    const { store } = await makeStore();
    const { caseId } = submitAndInspect(store, "open");
    const s = snapshot(store);
    const c = selectOfficerCases(s, NOW).find((x) => x.id === caseId)!;
    expect(toCaseRecord(c, toInspectionView(caseId, s.inspections[caseId]), selectCaseDetail(s, caseId, NOW))).toBeNull();
  });

  it("the screen: success header only right after deciding; record mode elsewhere; shared gallery; retryable missing state", () => {
    const src = read("app/officer/inspection-completed.tsx");
    expect(src).toMatch(/const asRecord = !!from;/);
    expect(src).toMatch(/<BackHeader title="Case Record"/);
    expect(src.match(/<EvidenceGallery\b/g)).toHaveLength(1);
    expect(src).toMatch(/label: "Try again", onPress: \(\) => ensureCase\(id\)/);
    expect(src).not.toMatch(/\bfine\b/i);
    for (const f of ["app/officer/report-details.tsx", "app/officer/en-route.tsx", "app/officer/inspection.tsx"]) {
      expect([f, /pathname: "\/officer\/inspection-completed", params: \{ id: c\.id, from: "record" \}/.test(read(f))]).toEqual([f, true]);
    }
    // Only the just-decided flow (showCompletedCase) opens it without `from`.
    expect(read("src/navigation/officerNavigation.ts")).toMatch(/pathname: "\/officer\/inspection-completed", params: \{ id: caseId \}/);
  });

  it("officer notes / record never reach citizen screens", () => {
    for (const f of ["app/user/report/report-overview.tsx", "src/presentation/citizenReportDetail.ts"]) {
      expect([f, /outcomeNotes|toCaseRecord|officerEvidence|checklist/.test(read(f))]).toEqual([f, false]);
    }
  });
});
