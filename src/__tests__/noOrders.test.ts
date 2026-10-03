// Regression guard: "Orders" is not part of ParkWatch and must not return as a
// route, a bottom-navigation item, or visible application text.
import * as fs from "fs";
import * as path from "path";
import { isUserNavItemActive, USER_NAV_ITEMS } from "../components/userNavItems";

const ROOT = path.resolve(__dirname, "../..");

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : listFiles(p);
    return /\.(tsx?|json)$/.test(e.name) ? [p] : [];
  });
}

const appFiles = listFiles(path.join(ROOT, "app"));
const sourceFiles = [...appFiles, ...listFiles(path.join(ROOT, "src"))];

describe("no Orders feature", () => {
  it("has no Orders route/screen file", () => {
    expect(appFiles.length).toBeGreaterThan(20);
    expect(appFiles.filter((f) => /order/i.test(path.relative(path.join(ROOT, "app"), f)))).toEqual([]);
  });

  it("citizen bottom navigation is exactly Home / Parking / Report / Reports / Profile", () => {
    expect(USER_NAV_ITEMS.map((i) => i.label)).toEqual(["Home", "Parking", "Report", "Reports", "Profile"]);
    expect(USER_NAV_ITEMS.some((i) => /order/i.test(i.label + i.path + i.key))).toBe(false);
  });

  it("officer bottom navigation has no Orders item", () => {
    const officerNav = fs.readFileSync(path.join(ROOT, "src/components/OfficerBottomNav.tsx"), "utf8");
    expect(officerNav).not.toMatch(/\bOrders?\b/i);
  });

  it("no whole-word Orders text anywhere in app/ or src/ (\"border\" etc. are fine)", () => {
    const hits = sourceFiles.filter((f) => /\bOrders\b/i.test(fs.readFileSync(f, "utf8")) || /\bOrder\b/.test(fs.readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("the matcher itself ignores unrelated words", () => {
    expect(/\bOrders\b/i.test("borderRadius border-color")).toBe(false);
    expect(/\bOrders\b/i.test("Open Orders")).toBe(true);
  });
});

describe("citizen nav highlighting", () => {
  const item = (key: string) => USER_NAV_ITEMS.find((i) => i.key === key)!;
  it("My Reports highlights only Reports, not the Report tab", () => {
    expect(isUserNavItemActive(item("reports"), "/user/reports")).toBe(true);
    expect(isUserNavItemActive(item("report"), "/user/reports")).toBe(false);
    expect(isUserNavItemActive(item("report"), "/user/report/add-details")).toBe(true);
  });
});
