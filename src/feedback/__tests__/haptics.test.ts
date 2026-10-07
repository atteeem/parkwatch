// T8.8: haptics are a small, throttled enhancement fired only after success.
import * as fs from "fs";
import * as path from "path";
import { createHaptics, HAPTIC_MIN_INTERVAL_MS, SuccessHaptic } from "../haptics";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("haptics", () => {
  it("throttles bursts (no haptic spam)", () => {
    let t = 0;
    const fired: SuccessHaptic[] = [];
    const h = createHaptics(async (k) => void fired.push(k), () => t);
    h.success("photoSaved");
    t += 100;
    h.success("photoSaved");
    t += HAPTIC_MIN_INTERVAL_MS;
    h.success("officerEvidenceComplete");
    expect(fired).toEqual(["photoSaved", "officerEvidenceComplete"]);
  });

  it("a failing or throwing platform call never breaks the flow", async () => {
    let t = 0;
    const rejecting = createHaptics(() => Promise.reject(new Error("no haptics")), () => (t += 1000));
    expect(() => rejecting.success("reportSubmitted")).not.toThrow();
    const throwing = createHaptics(() => {
      throw new Error("boom");
    }, () => (t += 1000));
    expect(() => throwing.success("caseAccepted")).not.toThrow();
  });

  it("fires only in success paths, never for navigation", () => {
    expect(read("app/user/report/review.tsx")).toMatch(/onSuccess: \(\{ reportId \}\) => \{\s*setPhase\("idle"\);\s*haptics\.success\("reportSubmitted"\)/);
    expect(read("app/officer/report-details.tsx")).toMatch(/acceptCase\(c\.id\), \{\s*onSuccess: \(\) => \{\s*haptics\.success\("caseAccepted"\)/);
    expect(read("app/officer/violation-photo.tsx")).toMatch(/if \(r\.ok\) \{[\s\S]*?haptics\.success\(!complete && nowComplete \? "officerEvidenceComplete" : "photoSaved"\)/);
    expect(read("app/user/report/photos.tsx")).toMatch(/capturePhoto\([^)]*\);\s*haptics\.success\("photoSaved"\)/);
    // No haptics on tab/navigation components.
    for (const f of ["src/components/UserBottomNav.tsx", "src/components/OfficerBottomNav.tsx", "src/components/NavTab.tsx", "src/components/GreenButton.tsx"]) {
      expect([f, /haptics/.test(read(f))]).toEqual([f, false]);
    }
  });

  it("Android uses view haptics: VIBRATE stays blocked", () => {
    expect(read("src/feedback/haptics.ts")).toMatch(/performAndroidHapticsAsync/);
    expect(JSON.parse(read("app.json")).expo.android.blockedPermissions).toContain("android.permission.VIBRATE");
    expect(JSON.parse(read("package.json")).dependencies["expo-haptics"]).toBe("~57.0.3");
  });
});
