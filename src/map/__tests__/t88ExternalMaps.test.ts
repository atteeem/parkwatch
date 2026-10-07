// T8.8: external "Open in Maps" + map polish; no ETA / routing in ParkWatch.
import * as fs from "fs";
import * as path from "path";
import { Linking } from "react-native";
import { externalMapsUrls, isValidMapsPoint, openInExternalMaps } from "../externalMaps";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const P = { latitude: 60.1699123456, longitude: 24.9384 };

describe("external maps URL builder", () => {
  it("iOS -> Apple Maps, Android -> geo: intent, web -> Google Maps; coordinates rounded, label encoded", () => {
    expect(externalMapsUrls(P, "Report #100", "ios")).toEqual({
      primary: "https://maps.apple.com/?ll=60.169912,24.9384&q=Report%20%23100",
      fallback: "https://www.google.com/maps/search/?api=1&query=60.169912%2C24.9384",
    });
    expect(externalMapsUrls(P, "Report #100", "android")!.primary).toBe("geo:60.169912,24.9384?q=60.169912%2C24.9384(Report%20%23100)");
    expect(externalMapsUrls(P, "Report #100", "web")!.primary).toBe("https://www.google.com/maps/search/?api=1&query=60.169912%2C24.9384");
  });

  it("never builds a link for a missing or invalid point", () => {
    expect(externalMapsUrls(undefined, "x", "ios")).toBeNull();
    expect(externalMapsUrls({ latitude: NaN, longitude: 1 }, "x", "android")).toBeNull();
    expect(externalMapsUrls({ latitude: 91, longitude: 1 }, "x", "web")).toBeNull();
    expect(isValidMapsPoint({ latitude: -33.9, longitude: 151.2 })).toBe(true);
  });

  it("asks for no directions/ETA: only a place (no saddr/daddr/dirflg/navigate)", () => {
    for (const p of ["ios", "android", "web"] as const) {
      const u = externalMapsUrls(P, "x", p)!;
      expect(`${u.primary} ${u.fallback}`).not.toMatch(/saddr|daddr|dirflg|navigate|travelmode|google\.navigation/);
    }
  });

  it("falls back to the web URL if the platform URL cannot be opened, and reports total failure", async () => {
    const open = jest.spyOn(Linking, "openURL");
    open.mockRejectedValueOnce(new Error("no handler")).mockResolvedValueOnce(true);
    await expect(openInExternalMaps(P, "x")).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1][0]).toMatch(/^https:\/\/www\.google\.com\/maps/);
    open.mockReset();
    open.mockRejectedValue(new Error("nothing"));
    await expect(openInExternalMaps(P, "x")).resolves.toBe(false);
    await expect(openInExternalMaps(undefined, "x")).resolves.toBe(false);
    open.mockRestore();
  });
});

describe("map polish", () => {
  it("officer map: a marker tap selects (highlight + focus + preview), the sheet opens the case and offers Open in Maps", () => {
    const src = read("app/officer/map.tsx");
    expect(src).toMatch(/onMarkerPress=\{selectCase\}/);
    expect(src).toMatch(/selectedId=\{selected\?\.id\}/);
    expect(src).toMatch(/const focusPoint = selected\?\.coordinates;/);
    expect(src).toMatch(/onPress=\{\(\) => openCase\(nearest\.id\)\}/);
    expect(src).toMatch(/<OpenInMapsButton point=\{nearest\.coordinates\}/);
    expect(src).toMatch(/<FollowLocationButton/); // Recenter to the officer
    for (const f of ["src/components/map/LiveMap.native.tsx", "src/components/map/LiveMap.tsx"]) expect(read(f)).toMatch(/const selected = m\.id === selectedId;/);
  });

  it("Open in Maps on Report Details and En Route; the in-app map button is no longer called Open in Maps", () => {
    expect(read("app/officer/report-details.tsx")).toMatch(/<OpenInMapsButton point=\{c\.coordinates\}/);
    const enRoute = read("app/officer/en-route.tsx");
    expect(enRoute).toMatch(/<OpenInMapsButton point=\{c\.coordinates\}/);
    expect(enRoute).not.toMatch(/Navigating to location/);
    expect(enRoute).toMatch(/>Live Map</);
  });

  it("citizen location map: distinct report pin and GPS dot, with a legend", () => {
    expect(read("app/user/report/add-details.tsx")).toMatch(/<MapLegend showUser=\{!!deviceFix\} \/>/);
    const native = read("src/components/map/LiveMap.native.tsx");
    expect(native).toMatch(/name="location" size=\{36\} color="#D93025"/);
    expect(native).toMatch(/backgroundColor: "#3478E5"/);
  });

  it("no fake ETA, routing or turn-by-turn claims anywhere in the app UI", () => {
    const files: string[] = [];
    const walk = (d: string) =>
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? undefined : walk(p);
        if (/\.tsx?$/.test(e.name)) files.push(p);
      });
    walk(path.join(ROOT, "app"));
    walk(path.join(ROOT, "src", "components"));
    walk(path.join(ROOT, "src", "presentation"));
    for (const f of files) {
      // Strip comments: they may say "no ETA".
      const code = fs.readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect([path.relative(ROOT, f), /\bETA\b|min(ute)?s? away|arrive in|turn-by-turn|Navigating to/i.test(code)]).toEqual([path.relative(ROOT, f), false]);
    }
  });
});
