// T8.8: first-run onboarding + first-use permission education.
import * as fs from "fs";
import * as path from "path";
import {
  createOnboardingPreference,
  loadOnboardingDone,
  ONBOARDING_KEY,
  ONBOARDING_PAGES,
  saveOnboardingDone,
  shouldShowOnboarding,
} from "../../onboarding/onboarding";
import { createMemoryStorage, KeyValueStorage } from "../../store/persistence";
import { ACCOUNT_STATUS, AUTH_HOME, ROLE_HOME } from "../../navigation/roleGuard";
import { CAMERA_EDUCATION, LOCATION_EDUCATION, showLocationEducation } from "../permissionEducation";
import { reportLocationStatus } from "../../map/mapLogic";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("onboarding preference (device only)", () => {
  it("is not done on a fresh device; completing it persists under one local key", async () => {
    const storage = createMemoryStorage();
    expect(await loadOnboardingDone(storage)).toBe(false);
    await saveOnboardingDone(storage);
    expect(await loadOnboardingDone(storage)).toBe(true);
    expect(await storage.getItem(ONBOARDING_KEY)).toBe("done");
  });

  it("the cached preference loads once, and complete() is visible immediately and survives a restart", async () => {
    const storage = createMemoryStorage();
    const pref = createOnboardingPreference(storage);
    expect(pref.getDone()).toBeNull();
    const seen: (boolean | null)[] = [];
    pref.subscribe(() => seen.push(pref.getDone()));
    await pref.load();
    expect(pref.getDone()).toBe(false);
    await pref.complete();
    expect(seen).toEqual([false, true]);
    const restarted = createOnboardingPreference(storage);
    await restarted.load();
    expect(restarted.getDone()).toBe(true);
  });

  it("unreadable storage never traps the user in onboarding", async () => {
    const broken: KeyValueStorage = {
      getItem: () => Promise.reject(new Error("x")),
      setItem: () => Promise.reject(new Error("x")),
      removeItem: () => Promise.resolve(),
    };
    expect(await loadOnboardingDone(broken)).toBe(true);
    await expect(saveOnboardingDone(broken)).resolves.toBeUndefined();
  });

  it("shown only before the first completion, for sign-in / citizen; never for officers or account-status", () => {
    expect(shouldShowOnboarding(null, ROLE_HOME.citizen)).toBeNull();
    expect(shouldShowOnboarding(false, null)).toBeNull();
    expect(shouldShowOnboarding(false, ROLE_HOME.citizen)).toBe(true);
    expect(shouldShowOnboarding(false, AUTH_HOME)).toBe(true);
    expect(shouldShowOnboarding(true, ROLE_HOME.citizen)).toBe(false);
    expect(shouldShowOnboarding(false, ROLE_HOME.officer)).toBe(false);
    expect(shouldShowOnboarding(false, ACCOUNT_STATUS)).toBe(false);
  });

  it("does not touch roles, accounts, Supabase or domain data", () => {
    for (const f of ["src/onboarding/onboarding.ts", "src/onboarding/OnboardingPreference.ts", "app/onboarding.tsx"]) {
      const imports = read(f).split("\n").filter((l) => l.startsWith("import ")).join("\n");
      const code = read(f).replace(/\/\/.*$/gm, "");
      expect([f, /supabase|backend\/|AppContext|SessionContext|store\/store|domain/i.test(imports)]).toEqual([f, false]);
      expect([f, /useApp\(|setRole|DEV_ROLE|signIn|signOut/.test(code)]).toEqual([f, false]);
    }
  });
});

describe("onboarding content", () => {
  const all = ONBOARDING_PAGES.map((p) => [p.title, ...p.points].join(" ")).join(" ");

  it("four pages in order: welcome, capture, verify, rewards", () => {
    expect(ONBOARDING_PAGES.map((p) => p.title)).toEqual(["Welcome to ParkWatch", "Capture the situation", "Enforcement verifies", "Rewards"]);
  });

  it("is truthful: citizen reports are leads, officers verify, rewards are conditional", () => {
    expect(all).toMatch(/not an enforcement decision/);
    expect(all).toMatch(/officer independently checks/);
    expect(all).toMatch(/Citizens do not issue parking charges/);
    expect(all).toMatch(/may earn €5 after an officer verifies it/);
    expect(all).toMatch(/Not every report results in enforcement or a reward/);
    expect(all).not.toMatch(/\bfines?\b|guarantee|will earn|always/i);
  });

  it("asks for no OS permission itself (camera/location stay at their features)", () => {
    const screen = read("app/onboarding.tsx");
    expect(screen).not.toMatch(/expo-camera|expo-location|requestPermission|useForegroundLocation|ImagePicker/);
    expect(screen).toMatch(/onboardingPreference\.complete\(\)/);
    // Review mode (from the Profile) never rewrites the preference.
    expect(screen).toMatch(/if \(review\) \{[\s\S]*?return;\s*\}\s*void onboardingPreference\.complete\(\)/);
  });

  it("the entry route decides; the Profile can reopen it", () => {
    expect(read("app/index.tsx")).toMatch(/shouldShowOnboarding\(useOnboardingDone\(\), home\)/);
    expect(read("app/user/profile.tsx")).toMatch(/pathname: "\/onboarding", params: \{ mode: "review" \}/);
  });
});

describe("first-use permission education", () => {
  it("location: explained inline and asked only on tap the first time; automatic once granted", () => {
    expect(LOCATION_EDUCATION).toBe(
      "ParkWatch uses your location to place the report on the map. You can correct the pin before submitting. Your location is not tracked in the background."
    );
    expect(showLocationEducation("undetermined")).toBe(true);
    for (const p of ["granted", "denied", "blocked"]) expect(showLocationEducation(p)).toBe(false);
    const screen = read("app/user/report/add-details.tsx");
    expect(screen).toMatch(/const location = useForegroundLocation\(\);/);
    expect(screen).toMatch(/onPress=\{\(\) => void location\.requestPermission\(\)\}/);
    expect(reportLocationStatus({ permission: "undetermined", loading: false } as never).text).toBe("Use your location above, or type the address.");
  });

  it("camera: the capture screen explains before the user allows it", () => {
    expect(CAMERA_EDUCATION).toBe("Camera access is needed for required evidence photos.");
    expect(read("src/components/CameraCapture.tsx")).toMatch(/\{CAMERA_EDUCATION\}/);
  });

  it("no background location, microphone or unrelated permissions are requested", () => {
    const appJson = JSON.parse(read("app.json"));
    expect(appJson.expo.android.permissions.sort()).toEqual(["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA"]);
    expect(appJson.expo.android.blockedPermissions).toEqual(expect.arrayContaining(["android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.RECORD_AUDIO"]));
  });
});
