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
