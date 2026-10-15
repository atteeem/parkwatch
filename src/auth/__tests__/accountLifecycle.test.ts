// T9.3 account lifecycle: password reset / change and closing a citizen account.
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
import * as fs from "fs";
import * as path from "path";
import { createAuthStore } from "../authStore";
import type { AuthService } from "../authService";
import { authError, mapAuthError, parseRecoveryLink, validateEmailOnly, validateNewPassword } from "../authErrors";
import { resolveAccess } from "../roleResolution";
import { accountStatusCopy } from "../accountStatus";
import { homeFor, ACCOUNT_STATUS } from "../../navigation/roleGuard";
import { createProfileRepository } from "../../backend/repositories/profileRepository";
import { ACCOUNT_DELETION_COPY } from "../../content/accountDeletion";
import type { AuthUser, TrustedProfile } from "../authTypes";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const USER: AuthUser = { id: "11111111-1111-4111-8111-111111111111", email: "mika@example.test" };

describe("password reset link parsing", () => {
  it("accepts only a recovery link with both tokens", () => {
    expect(parseRecoveryLink("parkwatch://auth/reset-password#access_token=a.b.c&refresh_token=r1&type=recovery&expires_in=3600")).toEqual({ kind: "recovery", accessToken: "a.b.c", refreshToken: "r1" });
    expect(parseRecoveryLink("http://localhost:8082/auth/reset-password?access_token=a&refresh_token=r&type=recovery")).toEqual({ kind: "recovery", accessToken: "a", refreshToken: "r" });
    for (const bad of [
      null,
      "",
      "parkwatch://auth/reset-password",
      "parkwatch://auth/reset-password#access_token=a&refresh_token=r&type=signup",
      "parkwatch://auth/reset-password#access_token=a&type=recovery",
      "parkwatch://auth/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
    ]) {
      expect(parseRecoveryLink(bad)).toEqual({ kind: "invalid" });
    }
  });

  it("form validation and error mapping", () => {
    expect(validateEmailOnly({ email: "nope" })).toEqual({ email: "Enter a valid email address." });
    expect(validateEmailOnly({ email: " mika@example.test " })).toEqual({});
    expect(validateNewPassword({ password: "short", confirmPassword: "short" }).password).toMatch(/at least 8/);
    expect(validateNewPassword({ password: "longenough1", confirmPassword: "different1" }).confirmPassword).toMatch(/match/);
    expect(validateNewPassword({ password: "longenough1", confirmPassword: "longenough1" })).toEqual({});
    expect(mapAuthError({ code: "same_password" }).code).toBe("SAME_PASSWORD");
    expect(mapAuthError({ code: "reauthentication_needed" }).code).toBe("REAUTH_REQUIRED");
    expect(mapAuthError({ code: "otp_expired" }).code).toBe("RESET_LINK_INVALID");
    for (const c of ["SAME_PASSWORD", "REAUTH_REQUIRED", "RESET_LINK_INVALID"] as const) expect(authError(c).message).not.toMatch(/_|undefined/);
  });
});

describe("closed accounts", () => {
  const citizen: TrustedProfile = { id: USER.id, role: "CITIZEN", displayName: "" };

  it("a closed account resolves to ACCOUNT_CLOSED and lands on the status screen with no retry", () => {
    const access = resolveAccess({ ...citizen, deletionRequested: true }, []);
    expect(access).toEqual({ kind: "ACCOUNT_CLOSED" });
    expect(homeFor({ mode: "BACKEND", status: "authenticated", access, accessFailed: false })).toBe(ACCOUNT_STATUS);
    const copy = accountStatusCopy({ mode: "BACKEND", status: "authenticated", user: USER, profile: { ...citizen, deletionRequested: true }, access });
    expect(copy.title).toBe("This account has been closed");
    expect(copy.canRetry).toBe(false);
    expect(resolveAccess(citizen, [])).toEqual({ kind: "CITIZEN" });
  });

  function fakeService(over: Partial<AuthService> = {}) {
    const calls: string[] = [];
    const service: AuthService = {
      getCurrentUser: async () => ({ ok: true, value: USER }),
      onAuthChange: () => () => undefined,
      signIn: async () => ({ ok: true, value: USER }),
      signUp: async () => ({ ok: true, value: { kind: "SIGNED_IN" } }),
      signOut: async () => (calls.push("signOut"), { ok: true, value: undefined }),
      loadAccess: async () => ({ ok: true, value: { profile: citizen, memberships: [] } }),
      ensureProfile: async () => ({ ok: true, value: citizen }),
      watchAppState: () => () => undefined,
      requestPasswordReset: async (email, redirectTo) => (calls.push(`reset:${email}:${redirectTo}`), { ok: true, value: undefined }),
      completePasswordReset: async () => (calls.push("complete"), { ok: true, value: undefined }),
      updatePassword: async () => (calls.push("update"), { ok: true, value: undefined }),
      requestAccountDeletion: async () => (calls.push("delete"), { ok: true, value: undefined }),
      ...over,
    };
    return { service, calls };
  }

  it("closing the account calls the server then signs out; a refusal keeps the user signed in", async () => {
    const ok = fakeService();
    const store = createAuthStore("BACKEND", ok.service);
    await store.start();
    expect((await store.closeAccount()).ok).toBe(true);
    expect(ok.calls).toEqual(["delete", "signOut"]);
    expect(store.getState().status).toBe("unauthenticated");

    const refused = fakeService({ requestAccountDeletion: async () => ({ ok: false, error: authError("FORBIDDEN") }) });
    const s2 = createAuthStore("BACKEND", refused.service);
    await s2.start();
    const r = await s2.closeAccount();
    expect(!r.ok && r.error.code).toBe("FORBIDDEN");
    expect(refused.calls).not.toContain("signOut");
    expect(s2.getState().status).toBe("authenticated");
  });

  it("store functions work UNBOUND, as AuthContext hands them to screens (regression: closeAccount used this.signOut)", async () => {
    const f = fakeService();
    const store = createAuthStore("BACKEND", f.service);
    await store.start();
    const { closeAccount } = store;
    expect((await closeAccount()).ok).toBe(true);
    expect(f.calls).toEqual(["delete", "signOut"]);
    expect(store.getState().status).toBe("unauthenticated");
    expect(read("src/auth/authStore.ts")).not.toMatch(/this./);
  });

  it("signed out: password change and closing are refused; reset email works", async () => {
    const f = fakeService({ getCurrentUser: async () => ({ ok: true, value: null }) });
    const store = createAuthStore("BACKEND", f.service);
    await store.start();
    expect((await store.changePassword("longenough1")).ok).toBe(false);
    expect((await store.closeAccount()).ok).toBe(false);
    expect((await store.requestPasswordReset("mika@example.test", "parkwatch://auth/reset-password")).ok).toBe(true);
    expect(f.calls).toEqual(["reset:mika@example.test:parkwatch://auth/reset-password"]);
  });

  it("local demo: no account operations", async () => {
    const store = createAuthStore("LOCAL_DEMO", null);
    for (const r of [await store.closeAccount(), await store.changePassword("x"), await store.requestPasswordReset("a@b.cd", "x")]) {
      expect(!r.ok && r.error.code).toBe("BACKEND_NOT_CONFIGURED");
    }
  });
});

describe("profile repository works before and after the T9.3 migration", () => {
  const client = (withColumn: boolean, deleted: boolean) => {
    const selects: string[] = [];
    const from = (table: string) => ({
      select: (cols: string) => {
        selects.push(`${table}:${cols}`);
        const q = {
          eq: () => q,
          maybeSingle: async () =>
            table === "profiles" && cols.includes("deletion_requested_at") && !withColumn
              ? { data: null, error: { code: "42703", message: "column profiles.deletion_requested_at does not exist" }, status: 400 }
              : { data: { id: USER.id, role: "CITIZEN", display_name: "", ...(withColumn ? { deletion_requested_at: deleted ? "2026-10-15T10:00:00Z" : null } : {}) }, error: null, status: 200 },
          then: (res: (v: unknown) => void) => res({ data: [], error: null, status: 200 }),
        };
        return q;
      },
    });
    return { provider: () => ({ ok: true as const, value: { from } as never }), selects };
  };

  it("reads the deletion marker when the column exists", async () => {
    const c = client(true, true);
    const r = await createProfileRepository(c.provider).getAccessData(USER.id);
    expect(r.ok && r.value.profile).toEqual({ id: USER.id, role: "CITIZEN", displayName: "", deletionRequested: true });
  });

  it("falls back to the old columns on a database without the migration (sign-in keeps working)", async () => {
    const c = client(false, false);
    const r = await createProfileRepository(c.provider).getAccessData(USER.id);
    expect(r.ok && r.value.profile).toEqual({ id: USER.id, role: "CITIZEN", displayName: "" });
    expect(c.selects.filter((s) => s.startsWith("profiles:"))).toEqual(["profiles:id, role, display_name, deletion_requested_at", "profiles:id, role, display_name"]);
  });
});

describe("screens and copy", () => {
  it("sign-in links to Forgot password; reset uses the app's own link and neutral wording", () => {
    expect(read("app/auth/sign-in.tsx")).toMatch(/router\.push\("\/auth\/forgot-password"\)/);
    const forgot = read("app/auth/forgot-password.tsx");
    expect(forgot).toMatch(/passwordResetRedirect\(/); // explicit allowed redirect, never the Site URL fallback
    expect(forgot).toMatch(/If an account exists for this email/);
    expect(read("app/auth/reset-password.tsx")).toMatch(/completePasswordReset\(link, password\)/);
  });

  it("the reset link's session is never adopted by the app (separate, non-persisting client)", () => {
    const svc = read("src/auth/authService.ts");
    expect(svc).toMatch(/const eph = createEphemeralClient\(\);/);
    expect(read("src/backend/supabase.ts")).toMatch(/persistSession: false, autoRefreshToken: false/);
    expect(read("app/auth/reset-password.tsx")).not.toMatch(/console\.|AsyncStorage/);
  });

  it("settings: Password and Delete Account work when signed in to the server; honest rows in the demo", () => {
    const s = read("app/user/settings.tsx");
    expect(s).toMatch(/router\.push\("\/user\/change-password"\)/);
    expect(s).toMatch(/router\.push\("\/user\/delete-account"\)/);
    expect(s).toMatch(/title="Delete Account" subtitle="Not available in the demo" unavailable/);
    expect(read("app/officer/profile.tsx")).toMatch(/router\.push\("\/officer\/change-password"\)/);
  });

  it("close-account copy matches the server function (what is removed and what is kept)", () => {
    const sql = read("supabase/migrations/20261015000001_account_deletion.sql");
    expect(sql).toMatch(/display_name = '', avatar_storage_path = null/);
    expect(sql).toMatch(/delete from public\.push_devices where user_id = me/);
    expect(sql).toMatch(/delete from public\.notifications where recipient_id = me/);
    expect(ACCOUNT_DELETION_COPY.removed.join(" ")).toMatch(/name and profile picture/);
    expect(ACCOUNT_DELETION_COPY.removed.join(" ")).toMatch(/notifications/);
    expect(ACCOUNT_DELETION_COPY.kept.join(" ")).toMatch(/without your name/);
    expect(JSON.stringify(ACCOUNT_DELETION_COPY)).not.toMatch(/guarantee|immediately erased|all data/i);
  });
});
