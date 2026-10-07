import { isBackendConfigured, isServiceRoleKey, readBackendConfig } from "../config";
import { mapBackendError } from "../result";
import { __resetSupabaseClientForTests, getSupabaseClient } from "../supabase";
import { createCaseRepository, createNotificationRepository, createReportRepository, createRewardRepository } from "../repositories";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const ANON = jwt({ role: "anon", iss: "supabase" });

describe("backend config", () => {
  it("missing env -> not configured, no throw, names the missing variables", () => {
    expect(readBackendConfig({})).toEqual({ configured: false, reason: "MISSING", missing: ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"] });
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: "  " })).toMatchObject({ configured: false, missing: ["EXPO_PUBLIC_SUPABASE_ANON_KEY"] });
    expect(isBackendConfigured({})).toBe(false);
  });

  it("valid public URL + anon key -> configured (trailing slash trimmed)", () => {
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/", EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON })).toEqual({
      configured: true,
      url: "https://abc.supabase.co",
      anonKey: ANON,
    });
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" }).configured).toBe(true);
  });

  it("rejects non-https URLs (except local dev) and any service-role / secret key", () => {
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: "http://evil.example", EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON })).toMatchObject({ configured: false, reason: "INVALID_URL" });
    const service = jwt({ role: "service_role" });
    expect(isServiceRoleKey(service)).toBe(true);
    expect(isServiceRoleKey("sb_secret_abc")).toBe(true);
    expect(isServiceRoleKey(ANON)).toBe(false);
    expect(readBackendConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: service })).toMatchObject({
      configured: false,
      reason: "SERVICE_ROLE_KEY_REJECTED",
    });
  });
});

describe("no backend configured (the default for the local demo)", () => {
  const saved = { url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY };
  beforeAll(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    __resetSupabaseClientForTests();
  });
  afterAll(() => {
    if (saved.url !== undefined) process.env.EXPO_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key !== undefined) process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = saved.key;
  });

  it("the client is not created and access fails with a typed BACKEND_NOT_CONFIGURED", () => {
    expect(readBackendConfig().configured).toBe(false);
    expect(getSupabaseClient()).toMatchObject({ ok: false, error: { code: "BACKEND_NOT_CONFIGURED" } });
  });

  it("every repository returns BACKEND_NOT_CONFIGURED instead of throwing", async () => {
    const results = await Promise.all([
      createReportRepository().listMine(),
      createCaseRepository().listOpen("helsinki-demo"),
      createNotificationRepository().listMine(),
      createRewardRepository().getMyBalances(),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, error: { code: "BACKEND_NOT_CONFIGURED" } });
  });
});

describe("error mapping never leaks raw database messages", () => {
  it.each([
    ["23505", undefined, "CONFLICT"],
    ["42501", undefined, "FORBIDDEN"],
    ["PGRST116", undefined, "NOT_FOUND"],
    ["PGRST301", undefined, "UNAUTHENTICATED"],
    ["23514", undefined, "INVALID_DATA"],
    ["XX000", undefined, "BACKEND_ERROR"],
    [undefined, 401, "UNAUTHENTICATED"],
  ])("code %s / status %s -> %s", (code, status, expected) => {
    const e = mapBackendError({ code, message: 'duplicate key value violates unique constraint "reward_ledger_idempotency_key_key"' }, status);
    expect(e.code).toBe(expected);
    expect(e.message).not.toMatch(/constraint|reward_ledger|key value/);
  });
});
