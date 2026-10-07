// The Supabase-backed auth service against a fake supabase client (offline).
import { mapAuthError, validateSignIn, validateSignUp } from "../authErrors";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const calls: { name: string; args: unknown[] }[] = [];
let signUpResult: { data: unknown; error: unknown } = { data: { user: { id: "u1" }, session: null }, error: null };
let signInResult: { data: unknown; error: unknown } = { data: { user: null, session: null }, error: { code: "invalid_credentials", message: "Invalid login credentials" } };
let signOutErrors: unknown[] = [];

const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signUp: async (...args: unknown[]) => (calls.push({ name: "signUp", args }), signUpResult),
    signInWithPassword: async (...args: unknown[]) => (calls.push({ name: "signIn", args }), signInResult),
    signOut: async (...args: unknown[]) => (calls.push({ name: "signOut", args }), { error: signOutErrors.shift() ?? null }),
    startAutoRefresh: () => {},
    stopAutoRefresh: () => {},
  },
};

let mockConfigured = true;
jest.mock("../../backend/supabase", () => ({
  getSupabaseClient: () => (mockConfigured ? { ok: true, value: mockClient } : { ok: false, error: { code: "BACKEND_NOT_CONFIGURED", message: "x" } }),
}));

// eslint-disable-next-line import/first
import { createSupabaseAuthService } from "../authService";

const noProfiles = { getAccessData: jest.fn(), ensureMyProfile: jest.fn() };

beforeEach(() => {
  calls.length = 0;
  mockConfigured = true;
  signOutErrors = [];
});

describe("supabase auth service", () => {
  it("sign-up sends only the display name: no role, no app metadata", async () => {
    const s = createSupabaseAuthService(noProfiles);
    await s.signUp(" Mika Salo ", " mika@example.test ", "longpassword");
    const args = calls.find((c) => c.name === "signUp")!.args[0] as { email: string; options: { data: Record<string, unknown> } };
    expect(args.email).toBe("mika@example.test");
    expect(args.options.data).toEqual({ display_name: "Mika Salo" });
    expect(JSON.stringify(args)).not.toMatch(/role|OFFICER|ADMIN|SUPERVISOR/);
  });

  it("no session after sign-up -> CONFIRM_EMAIL (not signed in)", async () => {
    signUpResult = { data: { user: { id: "u1" }, session: null }, error: null };
    expect(await createSupabaseAuthService(noProfiles).signUp("A", "a@b.cd", "longpassword")).toEqual({ ok: true, value: { kind: "CONFIRM_EMAIL", email: "a@b.cd" } });
  });

  it("session after sign-up (confirmation disabled) -> SIGNED_IN", async () => {
    signUpResult = { data: { user: { id: "u1" }, session: { user: { id: "u1" } } }, error: null };
    expect(await createSupabaseAuthService(noProfiles).signUp("A", "a@b.cd", "longpassword")).toEqual({ ok: true, value: { kind: "SIGNED_IN" } });
  });

  it("errors are mapped; raw messages are not returned", async () => {
    const r = await createSupabaseAuthService(noProfiles).signIn("a@b.cd", "x");
    expect(r).toMatchObject({ ok: false, error: { code: "INVALID_CREDENTIALS" } });
    if (!r.ok) expect(r.error.message).not.toMatch(/Invalid login credentials/);
    signInResult = { data: {}, error: { name: "AuthRetryableFetchError", message: "Failed to fetch" } };
    expect(await createSupabaseAuthService(noProfiles).signIn("a@b.cd", "x")).toMatchObject({ ok: false, error: { code: "NETWORK_ERROR" } });
  });

  it("sign-out falls back to ending the local session when the server can't be reached", async () => {
    signOutErrors = [{ message: "network" }];
    expect(await createSupabaseAuthService(noProfiles).signOut()).toEqual({ ok: true, value: undefined });
    expect(calls.filter((c) => c.name === "signOut").map((c) => c.args[0])).toEqual([undefined, { scope: "local" }]);
  });

  it("without backend config every call is BACKEND_NOT_CONFIGURED (no client, no session)", async () => {
    mockConfigured = false;
    const s = createSupabaseAuthService(noProfiles);
    for (const r of [await s.getCurrentUser(), await s.signIn("a@b.cd", "x"), await s.signUp("A", "a@b.cd", "x"), await s.signOut()]) {
      expect(r).toMatchObject({ ok: false, error: { code: "BACKEND_NOT_CONFIGURED" } });
    }
    expect(calls).toEqual([]);
  });
});

describe("auth error mapping", () => {
  it.each([
    [{ code: "invalid_credentials" }, "INVALID_CREDENTIALS"],
    [{ code: "email_not_confirmed" }, "EMAIL_NOT_CONFIRMED"],
    [{ code: "user_already_exists" }, "EMAIL_ALREADY_REGISTERED"],
    [{ code: "email_exists" }, "EMAIL_ALREADY_REGISTERED"],
    [{ code: "weak_password" }, "PASSWORD_TOO_WEAK"],
    [{ code: "user_banned" }, "ACCOUNT_DISABLED"],
    [{ code: "over_request_rate_limit" }, "RATE_LIMITED"],
    [{ name: "AuthRetryableFetchError" }, "NETWORK_ERROR"],
    [{ code: "something_new", message: "internal db detail" }, "UNKNOWN_AUTH_ERROR"],
  ])("%j -> %s", (raw, code) => {
    const e = mapAuthError(raw);
    expect(e.code).toBe(code);
    expect(e.message).not.toMatch(/internal db detail/);
  });
});

describe("form validation", () => {
  it("sign in needs a valid email and a password", () => {
    expect(validateSignIn({ email: "nope", password: "" })).toEqual({ email: expect.any(String), password: expect.any(String) });
    expect(validateSignIn({ email: "a@b.cd", password: "x" })).toEqual({});
  });

  it("sign up: name, email, 8+ char password, matching confirmation", () => {
    expect(validateSignUp({ displayName: " ", email: "x", password: "short", confirmPassword: "other" })).toEqual({
      displayName: expect.any(String),
      email: expect.any(String),
      password: expect.any(String),
      confirmPassword: expect.any(String),
    });
    expect(validateSignUp({ displayName: "Mika", email: "mika@example.test", password: "longpassword", confirmPassword: "longpassword" })).toEqual({});
  });
});
