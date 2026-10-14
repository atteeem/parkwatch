// Push registration on the device (T9.2): permission flow, token handling,
// sign-out, deep-link targets and the client API surface. Fake runtime and
// fake server API only - nothing reaches Expo or Supabase.
import * as fs from "fs";
import * as path from "path";
import { fail, ok } from "../../domain";
import { createMemoryStorage } from "../../store/persistence";
import { dismissEducation, getInstallationId, INSTALLATION_ID_KEY, isEducationDismissed, newInstallationId, resetInstallationIdCache } from "../pushDeviceStore";
import { PUSH_COPY, reRegisterToken, shouldShowPushEducation, syncPushRegistration, unregisterOnSignOut } from "../pushRegistration";
import { createOnceFilter, pushTarget } from "../pushTargets";
import type { PermissionInfo, PushDeviceApi, PushRuntime } from "../pushTypes";

const ROOT = path.resolve(__dirname, "../../..");
const TOKEN = "ExponentPushToken[abcdefghijklmnop]";
const CASE = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function fakeRuntime(over: Partial<PushRuntime> & { perm?: PermissionInfo; afterRequest?: PermissionInfo } = {}) {
  let perm: PermissionInfo = over.perm ?? { state: "undetermined", canAskAgain: true };
  const calls = { request: 0, channel: 0, token: 0 };
  const runtime: PushRuntime = {
    platform: "android",
    projectId: "11111111-2222-4333-8444-555555555555",
    getPermission: async () => perm,
    requestPermission: async () => {
      calls.request++;
      perm = over.afterRequest ?? { state: "granted", canAskAgain: true };
      return perm;
    },
    ensureChannel: async () => void calls.channel++,
    getToken: async () => {
      calls.token++;
      return TOKEN;
    },
    onTokenChange: () => () => undefined,
    onResponse: () => () => undefined,
    getLastResponse: async () => null,
    onReceived: () => () => undefined,
    setForegroundBehavior: () => undefined,
    openSettings: () => undefined,
    ...over,
  };
  return { runtime, calls };
}

function fakeApi(result = ok({ changed: true })) {
  const registered: { installationId: string; token: string; platform: string }[] = [];
  const unregistered: string[] = [];
  const api: PushDeviceApi = {
    register: jest.fn(async (installationId, token, platform) => {
      registered.push({ installationId, token, platform });
      return result;
    }),
    unregister: jest.fn(async (installationId) => {
      unregistered.push(installationId);
      return ok({ unregistered: true });
    }),
  };
  return { api, registered, unregistered };
}

describe("push registration", () => {
  it("never shows the OS prompt on its own: not asked yet -> 'off', nothing registered", async () => {
    const { runtime, calls } = fakeRuntime();
    const { api, registered } = fakeApi();
    const r = await syncPushRegistration({ runtime, api, installationId: "inst-1234567890", ask: false });
    expect(r.status).toBe("off");
    expect(calls.request).toBe(0);
    expect(registered).toHaveLength(0);
  });

  it("after the user taps Enable: OS prompt, token, registration with this installation", async () => {
    const { runtime, calls } = fakeRuntime();
    const { api, registered } = fakeApi();
    const r = await syncPushRegistration({ runtime, api, installationId: "inst-1234567890", ask: true });
    expect(r.status).toBe("enabled");
    expect(calls.channel).toBe(1); // Android channel before the prompt
    expect(calls.request).toBe(1);
    expect(registered).toEqual([{ installationId: "inst-1234567890", token: TOKEN, platform: "android" }]);
  });

  it("permission denied: nothing registered; 'denied' while it can be asked again, 'blocked' otherwise", async () => {
    const denied = fakeRuntime({ afterRequest: { state: "denied", canAskAgain: true } });
    const a = fakeApi();
    expect((await syncPushRegistration({ runtime: denied.runtime, api: a.api, installationId: "inst-1234567890", ask: true })).status).toBe("denied");
    const blocked = fakeRuntime({ perm: { state: "denied", canAskAgain: false } });
    expect((await syncPushRegistration({ runtime: blocked.runtime, api: a.api, installationId: "inst-1234567890", ask: true })).status).toBe("blocked");
    expect(blocked.calls.request).toBe(0); // a permanently denied prompt is never re-requested
    expect(a.registered).toHaveLength(0);
  });

  it("already granted: every launch re-registers silently (idempotent on the server)", async () => {
    const { runtime, calls } = fakeRuntime({ perm: { state: "granted", canAskAgain: true } });
    const { api, registered } = fakeApi(ok({ changed: false }));
    await syncPushRegistration({ runtime, api, installationId: "inst-1234567890", ask: false });
    await syncPushRegistration({ runtime, api, installationId: "inst-1234567890", ask: false });
    expect(calls.request).toBe(0);
    expect(registered.map((x) => x.installationId)).toEqual(["inst-1234567890", "inst-1234567890"]);
  });

  it("a refreshed token is re-registered for the same installation", async () => {
    const { runtime } = fakeRuntime();
    const { api, registered } = fakeApi();
    expect(await reRegisterToken({ runtime, api, installationId: "inst-1234567890", token: "ExponentPushToken[newnewnewnewnew]" })).toBe(true);
    expect(registered).toEqual([{ installationId: "inst-1234567890", token: "ExponentPushToken[newnewnewnewnew]", platform: "android" }]);
    expect(await reRegisterToken({ runtime, api, installationId: "inst-1234567890", token: "garbage" })).toBe(false);
  });

  it("failures never throw and never break the app: token error, server error, network error", async () => {
    const granted = { perm: { state: "granted" as const, canAskAgain: true } };
    const noToken = fakeRuntime({ ...granted, getToken: async () => Promise.reject(new Error("no FCM")) });
    expect((await syncPushRegistration({ runtime: noToken.runtime, api: fakeApi().api, installationId: "inst-1234567890", ask: false })).status).toBe("error");
    const serverDown = fakeApi(fail("NETWORK_ERROR", "NETWORK_ERROR"));
    expect((await syncPushRegistration({ runtime: fakeRuntime(granted).runtime, api: serverDown.api, installationId: "inst-1234567890", ask: false })).status).toBe("error");
    const throwing: PushDeviceApi = { register: () => Promise.reject(new Error("boom")), unregister: () => Promise.reject(new Error("boom")) };
    expect((await syncPushRegistration({ runtime: fakeRuntime(granted).runtime, api: throwing, installationId: "inst-1234567890", ask: false })).status).toBe("error");
    const badToken = fakeRuntime({ ...granted, getToken: async () => "not-a-token" });
    expect((await syncPushRegistration({ runtime: badToken.runtime, api: fakeApi().api, installationId: "inst-1234567890", ask: false })).status).toBe("error");
  });

  it("unavailable without a supported build (web / Android Expo Go), without an EAS project id, or without a signed-in citizen/officer", async () => {
    const { api } = fakeApi();
    for (const over of [{ platform: null }, { projectId: null }] as Partial<PushRuntime>[]) {
      const { runtime, calls } = fakeRuntime(over);
      expect((await syncPushRegistration({ runtime, api, installationId: "inst-1234567890", ask: true })).status).toBe("unavailable");
      expect(calls.request).toBe(0);
    }
    expect((await syncPushRegistration({ runtime: fakeRuntime().runtime, api: null, installationId: "inst-1234567890", ask: true })).status).toBe("unavailable");
  });

  it("sign-out unregisters this installation; a hanging server call never blocks sign-out", async () => {
    const { api, unregistered } = fakeApi();
    expect(await unregisterOnSignOut(api, "inst-1234567890")).toBe(true);
    expect(unregistered).toEqual(["inst-1234567890"]);
    const hanging: PushDeviceApi = { register: jest.fn(), unregister: () => new Promise(() => undefined) };
    const started = Date.now();
    expect(await unregisterOnSignOut(hanging, "inst-1234567890", 30)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await unregisterOnSignOut(null, "inst-1234567890")).toBe(false);
  });

  it("the education card shows only while never asked and not dismissed", () => {
    expect(shouldShowPushEducation("off", false)).toBe(true);
    expect(shouldShowPushEducation("off", true)).toBe(false);
    for (const s of ["unavailable", "denied", "blocked", "enabled", "error"] as const) expect(shouldShowPushEducation(s, false)).toBe(false);
    expect(PUSH_COPY.citizenBody).toMatch(/don't show photos, places or plates/);
    expect(PUSH_COPY.officerBody).toMatch(/no case details/);
  });
});

describe("installation id and preferences", () => {
  beforeEach(() => resetInstallationIdCache());

  it("is random, created once and reused (not a hardware/advertising id)", async () => {
    const a = newInstallationId();
    const b = newInstallationId();
    expect(a).toMatch(/^inst-[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    const storage = createMemoryStorage();
    const first = await getInstallationId(storage);
    resetInstallationIdCache();
    expect(await getInstallationId(storage)).toBe(first);
    expect(await storage.getItem(INSTALLATION_ID_KEY)).toBe(first);
    const src = fs.readFileSync(path.join(ROOT, "src/push/pushDeviceStore.ts"), "utf8");
    expect(src).not.toMatch(/advertis\w*Id|getAndroidId|getIosIdForVendor|expo-application|expo-device/i);
  });

  it("two devices (storages) get two installation ids", async () => {
    const one = await getInstallationId(createMemoryStorage());
    resetInstallationIdCache();
    const two = await getInstallationId(createMemoryStorage());
    expect(one).not.toBe(two);
  });

  it("'Not now' is remembered per role and account on this device", async () => {
    const storage = createMemoryStorage();
    expect(await isEducationDismissed(storage, "citizen", "u1")).toBe(false);
    await dismissEducation(storage, "citizen", "u1");
    expect(await isEducationDismissed(storage, "citizen", "u1")).toBe(true);
    expect(await isEducationDismissed(storage, "citizen", "u2")).toBe(false);
    expect(await isEducationDismissed(storage, "officer", "u1")).toBe(false);
  });
});

describe("push deep links", () => {
  it("citizen verified/rejected -> the citizen's report detail", () => {
    for (const type of ["REPORT_VERIFIED", "REPORT_REJECTED"]) {
      expect(pushTarget({ v: 1, notificationId: "n", type, role: "CITIZEN", reportId: "100023" }, "citizen")).toEqual({
        pathname: "/user/report/report-overview",
        params: { id: "100023" },
      });
    }
  });

  it("officer assignment -> the officer case detail", () => {
    expect(pushTarget({ v: 1, notificationId: "n", type: "CASE_ASSIGNED", role: "OFFICER", caseId: CASE }, "officer")).toEqual({
      pathname: "/officer/report-details",
      params: { id: CASE },
    });
  });

  it("a push for the other role, an unknown shape or a malformed id opens nothing", () => {
    expect(pushTarget({ v: 1, notificationId: "n", type: "CASE_ASSIGNED", role: "OFFICER", caseId: CASE }, "citizen")).toBeNull();
    expect(pushTarget({ v: 1, notificationId: "n", type: "REPORT_VERIFIED", role: "CITIZEN", reportId: "100023" }, "officer")).toBeNull();
    expect(pushTarget({ v: 1, notificationId: "n", type: "REPORT_VERIFIED", role: "CITIZEN", reportId: "100023" }, null)).toBeNull();
    expect(pushTarget({ type: "REPORT_VERIFIED", reportId: "100023" }, "citizen")).toBeNull();
    expect(pushTarget({ v: 1, notificationId: "n", type: "CASE_ASSIGNED", role: "OFFICER", caseId: "/admin" }, "officer")).toBeNull();
    expect(pushTarget(null, "citizen")).toBeNull();
  });

  it("each notification opens at most once (no duplicate screens for listener + cold start)", () => {
    const once = createOnceFilter();
    expect(once("a")).toBe(true);
    expect(once("a")).toBe(false);
    expect(once("b")).toBe(true);
  });
});

describe("client API surface", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/backend/push/pushDevicesClient.ts"), "utf8");

  it("the app can only register/unregister ITS OWN device: no user id is ever sent", () => {
    const args = [...src.matchAll(/\b(p_\w+):/g)].map((m) => m[1]).sort();
    expect([...new Set(args)]).toEqual(["p_expo_push_token", "p_installation_id", "p_platform"]);
    expect(src).not.toMatch(/user_?id|recipient|p_user/i);
  });

  it("the app cannot send pushes or read tokens: no sender RPCs, no Expo endpoint, no table access", () => {
    const appFiles: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (!["__tests__", "node_modules"].includes(e.name)) walk(p);
        } else if (/\.tsx?$/.test(e.name)) appFiles.push(p);
      }
    };
    walk(path.join(ROOT, "src"));
    walk(path.join(ROOT, "app"));
    const hits = appFiles.filter((f) => /push_claim_batch|push_record_|push_pending_receipts|exp\.host|push_devices|push_outbox|(?<!\w)expo_push_token\b/.test(fs.readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))).toEqual([]);
  });
});
