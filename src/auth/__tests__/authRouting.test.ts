import * as fs from "fs";
import * as path from "path";
import { ACCOUNT_STATUS, allowedRoleApp, AUTH_HOME, guardArea, homeFor, SessionView } from "../../navigation/roleGuard";
import { readBackendConfig } from "../../backend/config";
import { displayIdentity } from "../identity";
import { accountStatusCopy } from "../accountStatus";
import { AuthState, ResolvedAccess } from "../authTypes";
import { CaseStatus } from "../../domain";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const demo = (role: "citizen" | "officer"): SessionView => ({ mode: "LOCAL_DEMO", role });
const signedIn = (access: ResolvedAccess | null, accessFailed = false): SessionView => ({ mode: "BACKEND", status: "authenticated", access, accessFailed });
const LOADING: SessionView = { mode: "BACKEND", status: "loading" };
const SIGNED_OUT: SessionView = { mode: "BACKEND", status: "unauthenticated" };
const CITIZEN = signedIn({ kind: "CITIZEN" });
const OFFICER = signedIn({ kind: "OFFICER", organizations: [{ id: "o", name: "Org" }] });

describe("auth mode", () => {
  it("no Supabase env -> LOCAL_DEMO; env present -> BACKEND (detectAuthMode reads the same config)", () => {
    expect(readBackendConfig({}).configured).toBe(false);
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" }).configured).toBe(true);
    const ctx = fs.readFileSync(path.resolve(__dirname, "../AuthContext.tsx"), "utf8");
    expect(ctx).toMatch(/readBackendConfig\(\)\.configured \? "BACKEND" : "LOCAL_DEMO"/);
  });
});

describe("where each session lands", () => {
  it.each([
    ["demo citizen", demo("citizen"), "/user/home"],
    ["demo officer", demo("officer"), "/officer/home"],
    ["backend loading", LOADING, null],
    ["signed out", SIGNED_OUT, AUTH_HOME],
    ["citizen", CITIZEN, "/user/home"],
    ["authorized officer", OFFICER, "/officer/home"],
    ["officer without active membership", signedIn({ kind: "OFFICER_NOT_AUTHORIZED" }), ACCOUNT_STATUS],
    ["active supervisor/admin -> operations console", signedIn({ kind: "STAFF", role: "SUPERVISOR", organizations: [{ id: "o1" }] }), "/admin"],
    ["staff without an active membership", signedIn({ kind: "STAFF_NOT_AUTHORIZED", role: "ADMIN" }), ACCOUNT_STATUS],
    ["profile still loading", signedIn(null), null],
    ["profile failed to load", signedIn(null, true), ACCOUNT_STATUS],
  ])("%s -> %s", (_l, view, home) => expect(homeFor(view)).toBe(home));
});

describe("route guards", () => {
  it("unauthenticated users are sent to sign-in from both role apps", () => {
    expect(guardArea(SIGNED_OUT, "citizen")).toEqual({ type: "redirect", to: AUTH_HOME });
    expect(guardArea(SIGNED_OUT, "officer")).toEqual({ type: "redirect", to: AUTH_HOME });
    expect(guardArea(SIGNED_OUT, "auth")).toEqual({ type: "allow" });
  });

  it("a citizen cannot open /officer/* (direct link is redirected home)", () => {
    expect(guardArea(CITIZEN, "officer")).toEqual({ type: "redirect", to: "/user/home" });
    expect(guardArea(CITIZEN, "citizen")).toEqual({ type: "allow" });
  });

  it("an authorized officer may use officer routes, not citizen ones", () => {
    expect(guardArea(OFFICER, "officer")).toEqual({ type: "allow" });
    expect(guardArea(OFFICER, "citizen")).toEqual({ type: "redirect", to: "/officer/home" });
  });

  it("an officer whose membership is not active gets no role app", () => {
    const v = signedIn({ kind: "OFFICER_NOT_AUTHORIZED" });
    expect(guardArea(v, "officer")).toEqual({ type: "redirect", to: ACCOUNT_STATUS });
    expect(guardArea(v, "citizen")).toEqual({ type: "redirect", to: ACCOUNT_STATUS });
    expect(allowedRoleApp(v)).toBeNull();
  });

  it("signed-in users cannot reopen sign-in; signed-out users cannot open account status", () => {
    expect(guardArea(CITIZEN, "auth")).toEqual({ type: "redirect", to: "/user/home" });
    expect(guardArea(SIGNED_OUT, "account")).toEqual({ type: "redirect", to: AUTH_HOME });
  });

  it("account status is only for sessions without a role app; restored access leaves it", () => {
    expect(guardArea(signedIn({ kind: "OFFICER_NOT_AUTHORIZED" }), "account")).toEqual({ type: "allow" });
    expect(guardArea(signedIn(null, true), "account")).toEqual({ type: "allow" });
    expect(guardArea(OFFICER, "account")).toEqual({ type: "redirect", to: "/officer/home" });
    expect(guardArea(CITIZEN, "account")).toEqual({ type: "redirect", to: "/user/home" });
  });

  it("while loading nothing protected is shown", () => {
    for (const area of ["citizen", "officer", "auth", "account"] as const) expect(guardArea(LOADING, area)).toEqual({ type: "loading" });
    expect(guardArea(signedIn(null), "officer")).toEqual({ type: "loading" });
  });

  it("local demo keeps the dev role behavior and never shows auth screens", () => {
    expect(guardArea(demo("officer"), "officer")).toEqual({ type: "allow" });
    expect(guardArea(demo("citizen"), "officer")).toEqual({ type: "redirect", to: "/user/home" });
    expect(guardArea(demo("citizen"), "auth")).toEqual({ type: "redirect", to: "/user/home" });
    expect(guardArea(demo("officer"), "account")).toEqual({ type: "redirect", to: "/officer/home" });
  });

  it("a local role can never override the backend role (the backend view has no role field to set)", () => {
    const forged = { ...CITIZEN, role: "officer" } as unknown as SessionView;
    expect(guardArea(forged, "officer")).toEqual({ type: "redirect", to: "/user/home" });
  });
});

describe("identity shown on screens", () => {
  const authed = (access: ResolvedAccess, displayName = "Real Person"): AuthState => ({
    mode: "BACKEND",
    status: "authenticated",
    user: { id: "u", email: "real@example.test" },
    profile: { id: "u", role: access.kind === "OFFICER" ? "OFFICER" : "CITIZEN", displayName },
    access,
  });

  it("backend: the server profile replaces the demo identity", () => {
    const me = displayIdentity(authed({ kind: "CITIZEN" }), "citizen");
    expect(me).toMatchObject({ source: "BACKEND", fullName: "Real Person", firstName: "Real", email: "real@example.test" });
    expect(me.demo).toBeUndefined();
    expect(JSON.stringify(me)).not.toMatch(/Mika Salo|Mikko/);
  });

  it("backend officer: authorization text only from active memberships", () => {
    expect(displayIdentity(authed({ kind: "OFFICER", organizations: [{ id: "o", name: "Helsinki Enforcement" }] }), "officer").activeOrganizations).toEqual(["Helsinki Enforcement"]);
    expect(displayIdentity(authed({ kind: "CITIZEN" }), "officer").activeOrganizations).toBeUndefined();
  });

  it("local demo keeps the demo identities", () => {
    const demoState: AuthState = { mode: "LOCAL_DEMO", status: "backend-not-configured" };
    expect(displayIdentity(demoState, "citizen")).toMatchObject({ source: "DEMO", fullName: "Mika Salo" });
    expect(displayIdentity(demoState, "officer")).toMatchObject({ source: "DEMO", fullName: "Mikko Virtanen" });
  });

  it("account status copy is truthful per case", () => {
    expect(accountStatusCopy({ ...authed({ kind: "OFFICER_NOT_AUTHORIZED" }) }).title).toBe("Officer access is not active");
    expect(accountStatusCopy({ ...authed({ kind: "STAFF_NOT_AUTHORIZED", role: "ADMIN" }) })).toMatchObject({ title: "Administrator access is not active", canRetry: true });
  });
});

describe("case lifecycle naming (no drift between app and database)", () => {
  it("the database case_status enum is exactly the domain CaseStatus", () => {
    const DOMAIN: Record<CaseStatus, true> = { NEW: true, ASSIGNED: true, EN_ROUTE: true, ON_SITE: true, INSPECTION: true, COMPLETED: true };
    const sql = fs.readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261005000001_core_schema.sql"), "utf8");
    const values = sql.match(/create type public\.case_status as enum \(([^)]*)\)/)![1].match(/'([A-Z_]+)'/g)!.map((v) => v.replace(/'/g, ""));
    expect(values).toEqual(Object.keys(DOMAIN));
    expect(values).not.toContain("ACCEPTED");
  });
});
