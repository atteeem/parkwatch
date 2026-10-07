// Regression guard for T7.6: no control may look interactive and silently do
// nothing, and every navigation target must be a real route. Source-level
// checks (no UI test framework needed).
import * as fs from "fs";
import * as path from "path";
import { OFFICER_NAV_ITEMS } from "../components/officerNavItems";
import { USER_NAV_ITEMS } from "../components/userNavItems";
import { ROLE_HOME } from "../navigation/roleGuard";

const ROOT = path.resolve(__dirname, "../..");

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : listFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const appFiles = listFiles(path.join(ROOT, "app"));
const uiFiles = [...appFiles, ...listFiles(path.join(ROOT, "src", "components"))];
const allSource = [...appFiles, ...listFiles(path.join(ROOT, "src"))];
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");

/** Every JSX opening tag of a component, with its attributes (handles nested braces). */
function openingTags(src: string, component: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${component}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

/** Route file for a pathname: app/<path>.tsx or app/<path>/index.tsx. */
function routeExists(pathname: string): boolean {
  const base = path.join(ROOT, "app", ...pathname.split("/").filter(Boolean));
  return fs.existsSync(`${base}.tsx`) || fs.existsSync(path.join(base, "index.tsx"));
}

describe("no dead controls", () => {
  it("every Pressable / Touchable has an onPress (dead wrappers are Views)", () => {
    const dead = uiFiles.flatMap((f) =>
      ["Pressable", "TouchableOpacity", "TouchableHighlight"].flatMap((c) =>
        openingTags(fs.readFileSync(f, "utf8"), c)
          .filter((t) => !/onPress=/.test(t))
          .map((t) => `${rel(f)}: ${t.replace(/\s+/g, " ").slice(0, 90)}`)
      )
    );
    expect(dead).toEqual([]);
  });

  it("a GreenButton without onPress is explicitly disabled", () => {
    const dead = uiFiles.flatMap((f) =>
      openingTags(fs.readFileSync(f, "utf8"), "GreenButton")
        .filter((t) => !/onPress=/.test(t) && !/\bdisabled\b/.test(t))
        .map((t) => `${rel(f)}: ${t.replace(/\s+/g, " ").slice(0, 90)}`)
    );
    expect(dead).toEqual([]);
  });

  it("no Switch toggles (there is no push/email/theme setting to control yet)", () => {
    expect(appFiles.filter((f) => /<Switch\b/.test(fs.readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("decorative search/filter icons do not come back on My Reports or the Citizen Map", () => {
    expect(read("app/user/reports.tsx")).not.toMatch(/name="(search|filter)"/);
    expect(read("app/user/map.tsx")).not.toMatch(/name="search"/);
  });

  it("no literal \\uXXXX escapes inside plain JSX string attributes (they render as text)", () => {
    const bad = uiFiles.flatMap((f) =>
      (fs.readFileSync(f, "utf8").match(/=\s*"[^"{}]*\\u[0-9a-fA-F]{4}[^"{}]*"/g) ?? []).map((m) => `${rel(f)}: ${m}`)
    );
    expect(bad).toEqual([]);
  });

  it("disabled buttons of every variant look disabled", () => {
    expect(read("src/components/GreenButton.tsx")).toMatch(/disabled && variant !== "solid" && styles\.dimmed/);
  });
});

describe("settings / profile rows are honest", () => {
  /** The <SettingsRow .../> tag whose title is `title`. */
  const row = (file: string, title: string) => {
    const tag = openingTags(read(file), "SettingsRow").find((t) => t.includes(`title="${title}"`));
    if (!tag) throw new Error(`${file}: no SettingsRow "${title}"`);
    return tag;
  };
  const unavailable = (file: string, titles: string[]) => {
    for (const t of titles) {
      const tag = row(file, t);
      expect([t, /\bunavailable\b/.test(tag)]).toEqual([t, true]);
      expect([t, /onPress=/.test(tag)]).toEqual([t, false]);
    }
  };

  /** Row opens exactly this informational route and is not marked unavailable. */
  const opens = (file: string, title: string, route: string) => {
    const tag = row(file, title);
    expect([title, tag.includes(`onPress={() => router.push("${route}")}`)]).toEqual([title, true]);
    expect([title, /\bunavailable\b/.test(tag)]).toEqual([title, false]);
  };

  it("Citizen Profile: Wallet, Settings and info pages work; future features are unavailable; Sign Out via SignOutRow", () => {
    const f = "app/user/profile.tsx";
    expect(row(f, "Wallet")).toMatch(/onPress=\{\(\) => router\.push\("\/user\/earnings"\)\}/);
    expect(row(f, "Settings")).toMatch(/onPress=\{\(\) => router\.push\("\/user\/settings"\)\}/);
    const payment = openingTags(read(f), "SettingsRow").filter((t) => t.includes('title="Payment Method"'));
    expect(payment).toHaveLength(2); // local-demo example row + signed-in unavailable row
    for (const t of payment) expect(t).not.toMatch(/onPress=/);
    expect(payment.filter((t) => /\bunavailable\b/.test(t))).toHaveLength(1);
    unavailable(f, ["Identity Verification", "Referral Program"]);
    opens(f, "Help Center", "/user/info/help");
    opens(f, "About ParkWatch", "/user/info/about");
    opens(f, "Terms of Service", "/user/info/terms");
    opens(f, "Privacy Policy", "/user/info/privacy-policy");
    // The legal rows say they are drafts.
    expect(row(f, "Terms of Service")).toMatch(/subtitle="Draft/);
    expect(row(f, "Privacy Policy")).toMatch(/subtitle="Draft/);
    expect(read(f)).toMatch(/<SignOutRow \/>/);
  });

  it("Citizen Settings: every account/notification/theme row is unavailable; only info pages open", () => {
    const f = "app/user/settings.tsx";
    unavailable(f, ["Personal Information", "Password", "Identity Verification", "Push Notifications", "Email Notifications", "Dark Mode", "Language", "Delete Account"]);
    opens(f, "Privacy & Data", "/user/info/privacy-data");
    opens(f, "Help Center", "/user/info/help");
    opens(f, "About App", "/user/info/about");
    expect(read(f)).not.toMatch(/useState/);
  });

  it("Officer Profile: Notifications, Case History, Monthly Statistics and Help & Support work; the rest is informational or unavailable", () => {
    const f = "app/officer/profile.tsx";
    expect(row(f, "Notifications")).toMatch(/router\.push\("\/officer\/notifications"\)/);
    expect(row(f, "Case History")).toMatch(/router\.replace\("\/officer\/cases"\)/);
    unavailable(f, ["Personal Information", "Equipment Status", "Dark Mode"]);
    opens(f, "Monthly Statistics", "/officer/statistics");
    opens(f, "Help & Support", "/officer/info/officer-help");
    for (const t of ["Assigned District", "Work Vehicle"]) expect(row(f, t)).not.toMatch(/onPress=/);
    expect(read(f)).not.toMatch(/Edit Profile/);
    expect(read(f)).toMatch(/<SignOutRow \/>/);
  });

  it("Sign Out is real only in backend mode; the local demo says it isn't available", () => {
    const src = read("src/components/SignOutRow.tsx");
    expect(src).toMatch(/if \(mode !== "BACKEND"\) \{\s*return <SettingsRow[^\n]*unavailable \/>;/);
    expect(src).toMatch(/onPress=\{\(\) => setConfirm\(true\)\}/);
    expect(src).toMatch(/<ConfirmDialog/);
  });

  it("Withdraw: the payout account row is informational (no chevron)", () => {
    const src = read("app/user/withdraw.tsx");
    const block = src.slice(src.indexOf("styles.bankRow"), src.indexOf("styles.bankRow") + 600);
    expect(block).not.toMatch(/chevron-forward/);
    expect(block).toMatch(/not editable in demo/);
  });

  it("Earnings: Transaction history and View all open the history screen", () => {
    const src = read("app/user/earnings.tsx");
    expect(src.match(/router\.push\("\/user\/earnings\/history"\)/g)).toHaveLength(2);
  });

  it("Release Case stays disabled (no EN_ROUTE -> NEW transition)", () => {
    const tag = openingTags(read("app/officer/en-route.tsx"), "GreenButton").find((t) => t.includes('label="Release Case"'))!;
    expect(tag).toMatch(/\bdisabled\b/);
    expect(read("app/officer/en-route.tsx")).toMatch(/Returning a case to the queue is not available yet/);
  });
});

describe("route audit", () => {
  const REQUIRED = [
    "/user/home", "/user/parking", "/user/parking/start", "/user/parking/vehicles", "/user/parking/add-vehicle",
    "/user/parking/history", "/user/map", "/user/reports", "/user/report/photos", "/user/report/select-violation",
    "/user/report/add-details", "/user/report/review", "/user/report/submitted", "/user/report/report-overview",
    "/user/profile", "/user/settings", "/user/earnings", "/user/earnings/history", "/user/withdraw", "/user/notifications",
    "/officer/home", "/officer/queue", "/officer/map", "/officer/cases", "/officer/profile", "/officer/notifications",
    "/officer/report-details", "/officer/en-route", "/officer/inspection", "/officer/inspection-result",
    "/officer/inspection-completed", "/officer/violation-photo",
    "/user/info/help", "/user/info/about", "/user/info/privacy-data", "/user/info/terms", "/user/info/privacy-policy",
    "/officer/info/officer-help", "/officer/statistics",
  ];

  it.each(REQUIRED)("%s exists", (p) => expect(routeExists(p)).toBe(true));

  it("every navigation target in the source is a real route", () => {
    const targets = new Set<string>();
    for (const f of allSource) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:push|replace|navigate|dismissTo)\(\s*"(\/[a-z0-9/_-]+)"/g)) targets.add(m[1]);
      for (const m of src.matchAll(/pathname:\s*"(\/[a-z0-9/_-]+)"/g)) targets.add(m[1]);
      for (const m of src.matchAll(/(?:href|path)[=:]\s*"(\/(?:user|officer)[a-z0-9/_-]*)"/g)) targets.add(m[1]);
    }
    expect(targets.size).toBeGreaterThan(25);
    expect([...targets].filter((t) => !routeExists(t))).toEqual([]);
  });

  it("bottom-nav items and role homes are real routes", () => {
    for (const p of [...USER_NAV_ITEMS.map((i) => i.path), ...OFFICER_NAV_ITEMS.map((i) => i.path), ...Object.values(ROLE_HOME)]) {
      expect([p, routeExists(p)]).toEqual([p, true]);
    }
  });
});
