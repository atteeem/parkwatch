import { fromDevRole, guardRedirect, ROLE_HOME, routeArea, tabNavigation } from "../roleGuard";
import { openNextCase, resetToOfficerHome, showCompletedCase } from "../officerNavigation";
import { OFFICER_NAV_ITEMS } from "../../components/officerNavItems";

describe("role guards", () => {
  it("classifies routes by role area", () => {
    expect(routeArea("/user/home")).toBe("citizen");
    expect(routeArea("/officer/inspection")).toBe("officer");
    expect(routeArea("/")).toBe("neutral");
    expect(routeArea("/username")).toBe("neutral");
  });

  it("a citizen cannot open /officer/* and an officer cannot open /user/*", () => {
    expect(guardRedirect("citizen", "/officer/report-details")).toBe("/user/home");
    expect(guardRedirect("citizen", "/officer")).toBe("/user/home");
    expect(guardRedirect("officer", "/user/report/review")).toBe("/officer/home");
    expect(guardRedirect("citizen", "/user/map")).toBeNull();
    expect(guardRedirect("officer", "/officer/map")).toBeNull();
  });

  it("DEV_ROLE maps to the session role and its home", () => {
    expect(fromDevRole("user")).toBe("citizen");
    expect(fromDevRole("officer")).toBe("officer");
    expect(ROLE_HOME[fromDevRole("officer")]).toBe("/officer/home");
  });
});

/** Minimal stack model: push adds, replace swaps the top, back pops, dismissAll keeps the first. */
function fakeStack(initial: string[]) {
  const stack = [...initial];
  const path = (href: any) => (typeof href === "string" ? href : `${href.pathname}?id=${href.params.id}`);
  return {
    stack,
    canDismiss: () => stack.length > 1,
    dismissAll: () => stack.splice(1),
    replace: (href: any) => {
      stack[stack.length - 1] = path(href);
    },
    push: (href: any) => {
      stack.push(path(href));
    },
    tab(target: string) {
      if (tabNavigation(stack[stack.length - 1], target) === "replace") this.replace(target);
    },
  };
}

describe("tab semantics", () => {
  it("tapping tabs never grows the stack; tapping the current tab does nothing", () => {
    const r = fakeStack(["/officer/home"]);
    for (const item of OFFICER_NAV_ITEMS) r.tab(item.path);
    for (const item of OFFICER_NAV_ITEMS) r.tab(item.path);
    expect(r.stack).toEqual([OFFICER_NAV_ITEMS[OFFICER_NAV_ITEMS.length - 1].path]);
    r.tab("/officer/home");
    r.tab("/officer/home");
    expect(r.stack).toEqual(["/officer/home"]);
  });
});

describe("officer stack after a decision", () => {
  it("completion leaves exactly [Home, Completed] (no way back into a stale inspection)", () => {
    const r = fakeStack(["/officer/queue", "/officer/report-details?id=c1", "/officer/en-route?id=c1", "/officer/inspection?id=c1", "/officer/inspection-result?id=c1"]);
    showCompletedCase(r, "c1");
    expect(r.stack).toEqual(["/officer/home", "/officer/inspection-completed?id=c1"]);
  });

  it("Next Case and Return to Home rebuild the stack from Home", () => {
    const r = fakeStack(["/officer/home", "/officer/inspection-completed?id=c1"]);
    openNextCase(r, "c2");
    expect(r.stack).toEqual(["/officer/home", "/officer/report-details?id=c2"]);
    resetToOfficerHome(r);
    expect(r.stack).toEqual(["/officer/home"]);
  });
});
