// T9.3 release-candidate hardening: global error fallback, rapid-tap locks,
// no dead placeholder actions, truthful notification copy, labelled icon buttons.
import * as fs from "fs";
import * as path from "path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { AppErrorFallback, APP_ERROR_COPY, describeForLog } from "../AppErrorBoundary";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));

describe("global error fallback", () => {
  const boom = Object.assign(new Error("relation reports for user 995673e9 at 60.17,24.94: storage/abc.jpg?token=secret"), { name: "TypeError" });

  it("shows friendly copy and actions, never the error message or stack", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const retry = jest.fn(async () => undefined);
    const home = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<AppErrorFallback error={boom} retry={retry} onHome={home} />);
    });
    const shown = texts(r).join("\n");
    expect(shown).toContain(APP_ERROR_COPY.title);
    expect(shown).not.toMatch(/relation|995673e9|60\.17|token|storage|TypeError|at /);
    const tryAgain = r.root.find((n) => n.props.accessibilityLabel === APP_ERROR_COPY.retry && typeof n.props.onPress === "function");
    await act(async () => {
      await tryAgain.props.onPress();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    r.root.find((n) => n.props.accessibilityLabel === APP_ERROR_COPY.home && typeof n.props.onPress === "function").props.onPress();
    expect(home).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("release logging keeps only the error kind", () => {
    expect(describeForLog(boom)).toBe("TypeError");
    expect(describeForLog("x")).toBe("string");
  });

  it("is installed as the root layout's ErrorBoundary", () => {
    const layout = read("app/_layout.tsx");
    expect(layout).toMatch(/export function ErrorBoundary\(\{ error, retry \}: ErrorBoundaryProps\)/);
    expect(layout).toMatch(/<AppErrorFallback/);
  });
});

describe("rapid-tap protection", () => {
  it("Confirm Withdrawal records at most one request per visit", () => {
    const src = read("app/user/withdraw.tsx");
    expect(src).toMatch(/if \(requested\.current\) return;/);
    expect(src).toMatch(/if \(r === "requested"\) requested\.current = true;/);
  });

  it("console assignment confirm cannot run twice before it re-renders as busy", () => {
    const src = read("src/admin/CaseAssignmentPanel.tsx");
    expect(src).toMatch(/if \(!pending \|\| inFlight\.current\) return;/);
    expect(src).toMatch(/inFlight\.current = false;/);
  });

  it("the one-shot actions use a guard (report submit, officer lifecycle, parking)", () => {
    for (const f of ["app/user/report/review.tsx", "app/officer/report-details.tsx", "app/officer/en-route.tsx", "app/officer/inspection.tsx", "app/officer/inspection-result.tsx"]) {
      expect([f, /useGuardedAction/.test(read(f))]).toEqual([f, true]);
    }
    expect(read("app/user/parking.tsx")).toMatch(/createSubmitGuard\(\)/);
  });
});

describe("release copy and dead actions", () => {
  it("no disabled placeholder 'Release Case' button or dev TODO on En Route", () => {
    const src = read("app/officer/en-route.tsx");
    expect(src).not.toMatch(/Release Case|TODO\(dev\)|not available yet/);
  });

  it("help pages no longer claim push notifications are unavailable", () => {
    const pages = read("src/content/infoPages.ts");
    expect(pages).not.toMatch(/push notifications are not available/i);
    expect(pages).not.toMatch(/Push and email notifications are not available/);
  });

  it("no 'fine' wording for the private parking charge in shipped screens", () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        return e.isDirectory() ? (e.name === "__tests__" ? [] : walk(p)) : /\.tsx?$/.test(e.name) ? [p] : [];
      });
    const hits = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "src", "content"))].filter((f) => /\b(issue|issued) (a )?fines?\b|\bparking fines?\b/i.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the Reports '+' button is labelled for screen readers", () => {
    expect(read("app/user/reports.tsx")).toMatch(/style=\{styles\.fab\} onPress=\{startReport\} accessibilityRole="button" accessibilityLabel="New report"/);
  });
});

describe("visual QA fixes", () => {
  it("officer greeting follows the device clock (not always 'Good morning')", () => {
    const { greetingFor } = require("../../presentation/time");
    expect(greetingFor(new Date(2026, 9, 15, 8, 0))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 9, 15, 13, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 9, 15, 21, 0))).toBe("Good evening");
    expect(greetingFor(new Date(2026, 9, 15, 2, 0))).toBe("Good evening");
    expect(read("app/officer/home.tsx")).not.toMatch(/Good morning,/);
  });

  it("citizen home uses the citizen status word 'Verified' (not 'Accepted')", () => {
    expect(read("app/user/home.tsx")).toMatch(/label="Verified" sublabel="This week"/);
  });

  it("settings and profiles show no purely-future dimmed rows; honest ones remain", () => {
    const settings = read("app/user/settings.tsx");
    for (const t of ["Personal Information", "Identity Verification", "Email Notifications", "Dark Mode"]) expect([t, settings.includes(`title="${t}"`)]).toEqual([t, false]);
    expect(settings).toMatch(/title="Password"[^>]*unavailable/);
    expect(settings).toMatch(/title="Delete Account"[^>]*unavailable/);
    for (const t of ["Personal Information", "Equipment Status", "Dark Mode"]) expect([t, read("app/officer/profile.tsx").includes(`title="${t}"`)]).toEqual([t, false]);
    for (const t of ["Identity Verification", "Referral Program"]) expect([t, read("app/user/profile.tsx").includes(`title="${t}"`)]).toEqual([t, false]);
  });
});

describe("legal pages (pre-launch drafts)", () => {
  const { INFO_PAGES } = require("../../content/infoPages");
  const text = (p: { sections: { heading: string; paragraphs?: string[]; bullets?: string[] }[]; notice?: { text: string } }) =>
    [p.notice?.text ?? "", ...p.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join("\n");

  it("are labelled drafts and list exactly what must be added before launch", () => {
    for (const id of ["terms", "privacy-policy"]) {
      const p = INFO_PAGES[id];
      expect(p.notice.label).toMatch(/Draft/);
      expect(p.sections.some((s: { heading: string }) => s.heading === "To be added before launch")).toBe(true);
    }
    expect(text(INFO_PAGES["privacy-policy"])).toMatch(/data controller's legal name/);
    expect(text(INFO_PAGES.terms)).toMatch(/legal name, business ID/);
  });

  it("the privacy draft describes what the system actually does", () => {
    const t = text(INFO_PAGES["privacy-policy"]);
    expect(t).toMatch(/Plate Recognizer, which processes images in the USA/);
    expect(t).toMatch(/does not store that crop/);
    expect(t).toMatch(/never tracked in the background/);
    expect(t).toMatch(/pseudonymous reference/);
    expect(t).toMatch(/Settings → Delete Account/);
    expect(t).not.toMatch(/guarantee|always secure|never shared with anyone/i);
  });

  it("terms say parking previews take no payment and rewards are not paid out yet", () => {
    const t = text(INFO_PAGES.terms);
    expect(t).toMatch(/do not take payments and are not a valid parking permit/);
    expect(t).toMatch(/Payouts of rewards are not available/);
  });

  it("sign-up links to PUBLIC legal pages (no sign-in needed)", () => {
    const signUp = read("app/auth/sign-up.tsx");
    expect(signUp).toMatch(/router\.push\("\/legal\/terms"\)/);
    expect(signUp).toMatch(/router\.push\("\/legal\/privacy"\)/);
    const { routeArea } = require("../../navigation/roleGuard");
    expect(routeArea("/legal/terms")).toBe("neutral");
    expect(fs.existsSync(path.join(ROOT, "app/legal/terms.tsx")) && fs.existsSync(path.join(ROOT, "app/legal/privacy.tsx"))).toBe(true);
  });
});

describe("build environment guard (app.config.ts)", () => {
  const { assertBuildEnvironment, APP_VARIANT } = require("../../../app.config");
  const URL_ = "https://example.supabase.co";

  it("refuses preview/production builds without backend config (no silent local demo)", () => {
    for (const profile of ["preview", "production"]) {
      expect(() => assertBuildEnvironment({ EAS_BUILD_PROFILE: profile })).toThrow(/needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY/);
      expect(() => assertBuildEnvironment({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_SUPABASE_URL: URL_, EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc" })).toThrow(/publishable key/);
      expect(() => assertBuildEnvironment({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_SUPABASE_URL: URL_, EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc" })).not.toThrow();
    }
  });

  it("development builds and local runs are not blocked (local demo stays possible)", () => {
    expect(() => assertBuildEnvironment({ EAS_BUILD_PROFILE: "development" })).not.toThrow();
    expect(() => assertBuildEnvironment({})).not.toThrow();
    expect(APP_VARIANT).toBe("production"); // no APP_VARIANT in tests
  });

  it("Google Maps Android key: build-time only, wired into react-native-maps, never EXPO_PUBLIC_", () => {
    const { mapsPlugin } = require("../../../app.config");
    expect(mapsPlugin({ GOOGLE_MAPS_ANDROID_API_KEY: "test-maps-key" })).toEqual(["react-native-maps", { androidGoogleMapsApiKey: "test-maps-key" }]);
    expect(mapsPlugin({})).toEqual(["react-native-maps", {}]);
    expect(mapsPlugin({ EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY: "x" })).toEqual(["react-native-maps", {}]);
    const config = read("app.config.ts");
    // applied with withPlugins, not listed in `plugins`, so the key is not copied into the public app config
    expect(config).toMatch(/return withPlugins\(\{[\s\S]*\}, \[mapsPlugin\(\)\]\);/);
    expect(config).not.toMatch(/plugins: \[/);
    expect(config).not.toMatch(/EXPO_PUBLIC_GOOGLE|EXPO_PUBLIC_MAPS/);
    expect(read("app.json")).not.toMatch(/react-native-maps|googleMaps|API_KEY/); // single source: app.config.ts
    // no key value in the repo: only the variable name appears in app config
    expect(config).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(read("app.json")).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(read("eas.json")).not.toMatch(/AIza|GOOGLE_MAPS/);
  });

  it("Android development build on EAS fails clearly without the Maps key", () => {
    const { assertMapsKey } = require("../../../app.config");
    const server = { EAS_BUILD: "true", EAS_BUILD_PLATFORM: "android", EAS_BUILD_PROFILE: "development" };
    expect(() => assertMapsKey(server)).toThrow(/needs GOOGLE_MAPS_ANDROID_API_KEY/);
    expect(() => assertMapsKey({ ...server, GOOGLE_MAPS_ANDROID_API_KEY: "  " })).toThrow(/needs GOOGLE_MAPS_ANDROID_API_KEY/);
    expect(() => assertMapsKey({ ...server, GOOGLE_MAPS_ANDROID_API_KEY: "test-maps-key" })).not.toThrow();
    // not blocked: local runs / Expo Go, iOS, and the local eas-cli step (secret vars are server-only)
    expect(() => assertMapsKey({})).not.toThrow();
    expect(() => assertMapsKey({ ...server, EAS_BUILD_PLATFORM: "ios" })).not.toThrow();
    expect(() => assertMapsKey({ EAS_BUILD_PLATFORM: "android", EAS_BUILD_PROFILE: "development" })).not.toThrow();
    expect(read("app.config.ts")).toMatch(/assertBuildEnvironment\(\);\s+assertMapsKey\(\);/);
  });

  it("existing native config is preserved (Firebase/FCM, camera, location, audio, notifications)", () => {
    const config = read("app.config.ts");
    expect(config).toMatch(/googleServicesFile: GOOGLE_SERVICES_JSON/);
    const plugins = JSON.parse(read("app.json")).expo.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
    for (const p of ["expo-camera", "expo-location", "expo-audio", "expo-notifications", "expo-image-picker", "expo-router"]) expect(plugins).toContain(p);
  });

  it("eas.json keeps development and production separate", () => {
    const eas = JSON.parse(read("eas.json"));
    expect(eas.build.development).toMatchObject({ developmentClient: true, environment: "development", env: { APP_VARIANT: "development" } });
    expect(eas.build.preview.environment).toBe("preview");
    expect(eas.build.production).toMatchObject({ environment: "production", env: { APP_VARIANT: "production" } });
    expect(JSON.stringify(eas)).not.toMatch(/supabase\.co|sb_publishable_|sb_secret_|EXPO_PUBLIC_SUPABASE/);
  });
});
