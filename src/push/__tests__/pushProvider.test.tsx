// PushNotificationsProvider (rendered) with a fake device runtime and mocked
// auth / session / app / router. Covers silent registration, sign-out cleanup,
// foreground arrivals, taps (foreground/background) and cold start, and the
// education card. Nothing reaches Expo or Supabase.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { ok } from "../../domain";
import { createMemoryStorage } from "../../store/persistence";
import { PushNotificationsProvider, usePushNotifications } from "../PushNotificationsContext";
import { PushEducationCard } from "../PushEducationCard";
import { resetInstallationIdCache } from "../pushDeviceStore";
import type { PermissionInfo, PushDeviceApi, PushEvent, PushRuntime } from "../pushTypes";

const mockState = {
  auth: { mode: "BACKEND", status: "authenticated", user: { id: "user-1" } } as Record<string, unknown>,
  role: "citizen" as string | null,
  pathname: "/user/home",
  pushDevices: null as PushDeviceApi | null,
  refreshCore: jest.fn(async () => undefined),
  push: jest.fn(),
  hooks: [] as (() => Promise<unknown>)[],
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    state: mockState.auth,
    onBeforeSignOut: (h: () => Promise<unknown>) => {
      mockState.hooks.push(h);
      return () => {
        mockState.hooks = mockState.hooks.filter((x) => x !== h);
      };
    },
  }),
}));
jest.mock("../../context/SessionContext", () => ({ useSession: () => ({ role: mockState.role }) }));
jest.mock("../../context/AppContext", () => ({ useApp: () => ({ pushDevices: mockState.pushDevices, refreshCore: mockState.refreshCore }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockState.push }), usePathname: () => mockState.pathname }));
jest.mock("../../store/asyncStorageAdapter", () => ({ asyncStorageAdapter: require("../../store/persistence").createMemoryStorage() }));

const TOKEN = "ExponentPushToken[abcdefghijklmnop]";
const CASE = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function fakeRuntime(perm: PermissionInfo, last: PushEvent | null = null) {
  let state = perm;
  const listeners = { response: [] as ((e: PushEvent) => void)[], received: [] as ((e: PushEvent) => void)[] };
  const runtime: PushRuntime = {
    platform: "ios",
    projectId: "11111111-2222-4333-8444-555555555555",
    getPermission: async () => state,
    requestPermission: jest.fn(async () => (state = { state: "granted", canAskAgain: true })),
    ensureChannel: async () => undefined,
    getToken: async () => TOKEN,
    onTokenChange: () => () => undefined,
    onResponse: (cb) => (listeners.response.push(cb), () => undefined),
    getLastResponse: async () => last,
    onReceived: (cb) => (listeners.received.push(cb), () => undefined),
    setForegroundBehavior: jest.fn(),
    openSettings: jest.fn(),
  };
  return { runtime, listeners };
}

function fakeApi() {
  return {
    register: jest.fn(async () => ok({ changed: true })),
    unregister: jest.fn(async () => ok({ unregistered: true })),
  } satisfies PushDeviceApi;
}

let status = "";
function Probe() {
  status = usePushNotifications().status;
  return <Text>{status}</Text>;
}

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

async function render(runtime: PushRuntime, storage = createMemoryStorage()) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(
      <PushNotificationsProvider runtime={runtime} storage={storage}>
        <Probe />
        <PushEducationCard audience="citizen" />
      </PushNotificationsProvider>
    );
  });
  await flush();
  return r;
}

beforeEach(() => {
  resetInstallationIdCache();
  mockState.auth = { mode: "BACKEND", status: "authenticated", user: { id: "user-1" } };
  mockState.role = "citizen";
  mockState.pathname = "/user/home";
  mockState.pushDevices = fakeApi();
  mockState.refreshCore.mockClear();
  mockState.push.mockClear();
  mockState.hooks = [];
});

describe("PushNotificationsProvider", () => {
  it("permission already granted: registers this device silently; no OS prompt", async () => {
    const { runtime } = fakeRuntime({ state: "granted", canAskAgain: true });
    await render(runtime);
    expect(status).toBe("enabled");
    expect(mockState.pushDevices!.register).toHaveBeenCalledWith(expect.stringMatching(/^inst-[0-9a-f]{32}$/), TOKEN, "ios");
    expect(runtime.requestPermission).not.toHaveBeenCalled();
    expect(runtime.setForegroundBehavior).toHaveBeenCalled();
  });

  it("sign-out unregisters THIS installation (hook runs while the session is still valid)", async () => {
    const { runtime } = fakeRuntime({ state: "granted", canAskAgain: true });
    await render(runtime);
    const id = (mockState.pushDevices!.register as jest.Mock).mock.calls[0][0];
    expect(mockState.hooks).toHaveLength(1);
    await act(async () => {
      await mockState.hooks[0]();
    });
    expect(mockState.pushDevices!.unregister).toHaveBeenCalledWith(id);
  });

  it("a notification arriving while open refreshes the in-app list and unread badge (no second in-app banner)", async () => {
    const { runtime, listeners } = fakeRuntime({ state: "granted", canAskAgain: true });
    const r = await render(runtime);
    await act(async () => listeners.received.forEach((cb) => cb({ id: "x", data: {} })));
    expect(mockState.refreshCore).toHaveBeenCalledTimes(1);
    expect(mockState.push).not.toHaveBeenCalled();
    expect(r.root.findAll((n) => n.props.testID === "in-app-banner")).toHaveLength(0);
  });

  it("tapping a push (foreground/background) opens the report once", async () => {
    const { runtime, listeners } = fakeRuntime({ state: "granted", canAskAgain: true });
    await render(runtime);
    const e = { id: "req-1", data: { v: 1, notificationId: "n1", type: "REPORT_VERIFIED", role: "CITIZEN", reportId: "100023" } };
    await act(async () => listeners.response.forEach((cb) => cb(e)));
    await act(async () => listeners.response.forEach((cb) => cb(e)));
    expect(mockState.push).toHaveBeenCalledTimes(1);
    expect(mockState.push).toHaveBeenCalledWith({ pathname: "/user/report/report-overview", params: { id: "100023" } });
  });

  it("cold start: waits until the session's role is known and the entry redirect happened, then opens the case once", async () => {
    mockState.role = null;
    mockState.pathname = "/";
    const launch = { id: "req-cold", data: { v: 1, notificationId: "n2", type: "CASE_ASSIGNED", role: "OFFICER", caseId: CASE } };
    const { runtime } = fakeRuntime({ state: "granted", canAskAgain: true }, launch);
    const r = await render(runtime);
    expect(mockState.push).not.toHaveBeenCalled();
    mockState.role = "officer";
    mockState.pathname = "/officer/home";
    await act(async () => {
      r.update(
        <PushNotificationsProvider runtime={runtime} storage={createMemoryStorage()}>
          <Probe />
        </PushNotificationsProvider>
      );
    });
    await flush();
    expect(mockState.push).toHaveBeenCalledTimes(1);
    expect(mockState.push).toHaveBeenCalledWith({ pathname: "/officer/report-details", params: { id: CASE } });
  });

  it("a push for another role opens nothing", async () => {
    const { runtime, listeners } = fakeRuntime({ state: "granted", canAskAgain: true });
    await render(runtime);
    await act(async () => listeners.response.forEach((cb) => cb({ id: "r", data: { v: 1, notificationId: "n", type: "CASE_ASSIGNED", role: "OFFICER", caseId: CASE } })));
    expect(mockState.push).not.toHaveBeenCalled();
  });

  it("education card: shown while never asked; Enable shows the OS prompt and registers; it then disappears", async () => {
    const { runtime } = fakeRuntime({ state: "undetermined", canAskAgain: true });
    const r = await render(runtime);
    expect(status).toBe("off");
    expect(mockState.pushDevices!.register).not.toHaveBeenCalled();
    const card = () => r.root.findAll((n) => n.props.testID === "push-education");
    expect(card().length).toBeGreaterThan(0);
    const enable = r.root.find((n) => n.props.label === "Turn on notifications" && typeof n.props.onPress === "function");
    await act(async () => {
      await enable.props.onPress();
    });
    await flush();
    expect(runtime.requestPermission).toHaveBeenCalledTimes(1);
    expect(status).toBe("enabled");
    expect(card()).toHaveLength(0);
  });

  it("'Not now' hides the card without asking the OS", async () => {
    const { runtime } = fakeRuntime({ state: "undetermined", canAskAgain: true });
    const r = await render(runtime);
    const notNow = r.root.find((n) => n.props.label === "Not now" && typeof n.props.onPress === "function");
    await act(async () => notNow.props.onPress());
    expect(r.root.findAll((n) => n.props.testID === "push-education")).toHaveLength(0);
    expect(runtime.requestPermission).not.toHaveBeenCalled();
  });

  it("local demo / console / signed out: push is unavailable and nothing is registered or shown", async () => {
    for (const setup of [
      () => (mockState.auth = { mode: "LOCAL_DEMO", status: "backend-not-configured" }),
      () => ((mockState.role = "admin"), (mockState.pushDevices = null)),
      () => (mockState.auth = { mode: "BACKEND", status: "unauthenticated" }),
    ]) {
      mockState.pushDevices = fakeApi();
      setup();
      const { runtime } = fakeRuntime({ state: "granted", canAskAgain: true });
      const r = await render(runtime);
      expect(status).toBe("unavailable");
      expect(r.root.findAll((n) => n.props.testID === "push-education")).toHaveLength(0);
      if (mockState.pushDevices) expect(mockState.pushDevices.register).not.toHaveBeenCalled();
    }
  });
});
