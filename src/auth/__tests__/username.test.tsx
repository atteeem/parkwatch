// T9.4 citizen username: shared rules, server-outcome mapping, store refresh,
// the edit screen and the Profile row. The server (set_username) is the
// authority; scripts/verify-t94.mjs covers the database rules.
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
import * as fs from "fs";
import * as path from "path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, TextInput } from "react-native";
import { formatChangeDate, normalizeUsername, usernameChangeStatus, usernameOutcomeMessage, usernameRowSubtitle, validateUsername } from "../username";
import { createProfileRepository, toUsernameOutcome } from "../../backend/repositories/profileRepository";
import { createAuthStore } from "../authStore";
import { authError } from "../authErrors";
import type { AuthService } from "../authService";
import type { AuthState, AuthUser, TrustedProfile } from "../authTypes";

const mockAuth: { state: AuthState; mode: "BACKEND" | "LOCAL_DEMO"; setUsername: jest.Mock } = {
  state: { mode: "BACKEND", status: "loading" },
  mode: "BACKEND",
  setUsername: jest.fn(),
};
jest.mock("../AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true }) }));

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const USER: AuthUser = { id: "11111111-1111-4111-8111-111111111111", email: "aino@example.test" };
const NOW = new Date("2026-10-18T12:00:00.000Z");

describe("username rules (same as the server)", () => {
  it("normalizes by trimming and lowercasing", () => {
    expect(normalizeUsername("  Aino_Park1 ")).toBe("aino_park1");
  });
  it("accepts 3-24 of a-z 0-9 _ and rejects everything else", () => {
    for (const ok of ["abc", "a".repeat(24), "aino_park1", "ABC_123", "___"]) expect(validateUsername(ok)).toBeNull();
    expect(validateUsername("")).toMatch(/Choose/);
    expect(validateUsername("   ")).toMatch(/Choose/);
    expect(validateUsername("ab")).toMatch(/3–24/);
    expect(validateUsername("a".repeat(25))).toMatch(/3–24/);
    for (const bad of ["aino park", "aino@park", "äiti_123", "aino-park", "aino.park"]) expect(validateUsername(bad)).toMatch(/no spaces/);
  });
  it("cooldown hint: 30 days from the server's change time, never a decision", () => {
    expect(usernameChangeStatus(undefined, NOW)).toEqual({ canChange: true });
    const recent = usernameChangeStatus("2026-10-10T12:00:00.000Z", NOW);
    expect(recent.canChange).toBe(false);
    expect(recent.daysLeft).toBe(22);
    expect(formatChangeDate(recent.nextChangeAt!)).toBe("9 Nov 2026");
    expect(usernameChangeStatus("2026-09-18T12:00:00.000Z", NOW).canChange).toBe(true); // exactly 30 days
    expect(usernameChangeStatus("not-a-date", NOW).canChange).toBe(true);
  });
  it("Profile row shows the username and when it can next be changed", () => {
    expect(usernameRowSubtitle(undefined, undefined, NOW)).toBe("Choose a public username");
    expect(usernameRowSubtitle("aino", "2026-10-10T12:00:00.000Z", NOW)).toBe("@aino · can change again on 9 Nov 2026 (22 days)");
    expect(usernameRowSubtitle("aino", "2026-09-18T11:00:00.000Z", NOW)).toBe("@aino · you can change it");
    expect(usernameRowSubtitle("aino", "2026-09-19T11:00:00.000Z", NOW)).toMatch(/\(1 day\)$/);
  });
});

describe("set_username outcome mapping (no raw server text reaches the UI)", () => {
  const next = "2026-11-17T10:00:00+00:00";
  it("maps every server answer", () => {
    expect(toUsernameOutcome({ changed: true, username: "aino", next_change_at: next })).toEqual({ kind: "CHANGED", username: "aino", nextChangeAt: next });
    expect(toUsernameOutcome({ changed: false, username: "aino", next_change_at: next })).toEqual({ kind: "UNCHANGED", username: "aino", nextChangeAt: next });
    expect(toUsernameOutcome({ changed: false, reason: "COOLDOWN", username: "aino", next_change_at: next })).toEqual({ kind: "COOLDOWN", nextChangeAt: next });
    expect(toUsernameOutcome({ changed: false, reason: "TAKEN", username: null, next_change_at: null })).toEqual({ kind: "TAKEN" });
    expect(toUsernameOutcome(null)).toBeNull();
    expect(toUsernameOutcome({ changed: true })).toBeNull();
  });
  it("messages", () => {
    expect(usernameOutcomeMessage({ kind: "COOLDOWN", nextChangeAt: next })).toBe("You can change your username again on 17 Nov 2026.");
    expect(usernameOutcomeMessage({ kind: "TAKEN" })).toMatch(/taken/);
    expect(usernameOutcomeMessage({ kind: "UNAVAILABLE" })).toMatch(/not available/);
  });

  function repoWith(answer: { data?: unknown; error?: { code: string; message: string } | null; status?: number }) {
    const calls: unknown[] = [];
    const client = { rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), { data: answer.data ?? null, error: answer.error ?? null, status: answer.status ?? 200 }) };
    return { repo: createProfileRepository(() => ({ ok: true, value: client as never })), calls };
  }
  it("calls set_username with only the name (the server takes the user from the session)", async () => {
    const { repo, calls } = repoWith({ data: { changed: true, username: "aino", next_change_at: next } });
    expect(await repo.setUsername("aino")).toEqual({ ok: true, value: { kind: "CHANGED", username: "aino", nextChangeAt: next } });
    expect(calls).toEqual([{ fn: "set_username", args: { p_username: "aino" } }]);
  });
  it("server refusals become typed outcomes or safe errors", async () => {
    expect(await repoWith({ error: { code: "P0001", message: "INVALID_INPUT: This username is not available." } }).repo.setUsername("admin")).toEqual({ ok: true, value: { kind: "UNAVAILABLE" } });
    expect(await repoWith({ error: { code: "P0001", message: "INVALID_INPUT: Use 3-24 letters a-z, numbers or underscore." } }).repo.setUsername("x")).toEqual({ ok: true, value: { kind: "INVALID" } });
    const staff = await repoWith({ error: { code: "P0001", message: "FORBIDDEN: Usernames are for citizen accounts." } }).repo.setUsername("officer_one");
    expect(!staff.ok && staff.error.code).toBe("FORBIDDEN");
    const sql = await repoWith({ error: { code: "XX000", message: "relation public.profiles ... secret detail" }, status: 500 }).repo.setUsername("aino");
    expect(!sql.ok && sql.error.message).not.toMatch(/relation|secret/);
  });
});

describe("auth store", () => {
  const citizen: TrustedProfile = { id: USER.id, role: "CITIZEN", displayName: "Aino" };
  function service(over: Partial<AuthService> = {}) {
    let profile = citizen;
    const s: AuthService = {
      getCurrentUser: async () => ({ ok: true, value: USER }),
      onAuthChange: () => () => undefined,
      signIn: async () => ({ ok: true, value: USER }),
      signUp: async () => ({ ok: true, value: { kind: "SIGNED_IN" } }),
      signOut: async () => ({ ok: true, value: undefined }),
      loadAccess: async () => ({ ok: true, value: { profile, memberships: [] } }),
      ensureProfile: async () => ({ ok: true, value: profile }),
      watchAppState: () => () => undefined,
      requestPasswordReset: async () => ({ ok: true, value: undefined }),
      completePasswordReset: async () => ({ ok: true, value: undefined }),
      updatePassword: async () => ({ ok: true, value: undefined }),
      requestAccountDeletion: async () => ({ ok: true, value: undefined }),
      setUsername: async (u) => {
        profile = { ...profile, username: u, usernameChangedAt: "2026-10-18T12:00:00.000Z" };
        return { ok: true, value: { kind: "CHANGED", username: u, nextChangeAt: "2026-11-17T12:00:00.000Z" } };
      },
      ...over,
    };
    return s;
  }
  it("a successful change re-reads the profile from the server", async () => {
    const store = createAuthStore("BACKEND", service());
    await store.start();
    const r = await store.setUsername("aino");
    expect(r.ok && r.value.kind).toBe("CHANGED");
    const st = store.getState();
    expect(st.status === "authenticated" && st.profile?.username).toBe("aino");
    expect(st.status === "authenticated" && st.profile?.usernameChangedAt).toBe("2026-10-18T12:00:00.000Z");
  });
  it("a refusal changes nothing; signed out or no backend is refused locally", async () => {
    const loads = jest.fn();
    const svc = service({ setUsername: async () => ({ ok: true, value: { kind: "COOLDOWN", nextChangeAt: "2026-11-01T00:00:00.000Z" } }) });
    const orig = svc.loadAccess;
    svc.loadAccess = async (u) => (loads(), orig(u));
    const store = createAuthStore("BACKEND", svc);
    await store.start();
    const before = loads.mock.calls.length;
    await store.setUsername("aino");
    expect(loads.mock.calls.length).toBe(before);
    expect((await createAuthStore("LOCAL_DEMO", null).setUsername("aino")).ok).toBe(false);
    const forbidden = createAuthStore("BACKEND", service({ setUsername: async () => ({ ok: false, error: authError("FORBIDDEN") }) }));
    await forbidden.start();
    const f = await forbidden.setUsername("aino");
    expect(!f.ok && f.error.code).toBe("FORBIDDEN");
  });
});

describe("Username screen", () => {
  const { UsernameScreen } = require("../AccountScreens") as typeof import("../AccountScreens");
  const signedIn = (profile: Partial<TrustedProfile>, kind: "CITIZEN" | "OFFICER" = "CITIZEN"): AuthState => ({
    mode: "BACKEND",
    status: "authenticated",
    user: USER,
    profile: { id: USER.id, role: kind, displayName: "Aino", ...profile },
    access: kind === "CITIZEN" ? { kind: "CITIZEN" } : { kind: "OFFICER", organizations: [] },
  });
  const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [].concat(t.props.children).join(""));
  const pressByLabel = (r: TestRenderer.ReactTestRenderer, label: string) => {
    // Buttons are found by their visible text (innermost pressable containing it).
    const hasText = (n: TestRenderer.ReactTestInstance) => n.findAllByType(Text).some((t) => [].concat(t.props.children).join("") === label);
    const btn = r.root.findAll((n) => typeof n.props.onPress === "function" && hasText(n)).pop();
    if (!btn) throw new Error(`no button ${label}`);
    return act(async () => btn.props.onPress());
  };
  const render = (el: React.ReactElement) => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(el);
    });
    return r;
  };
  beforeEach(() => mockAuth.setUsername.mockReset());

  it("inside the cooldown it shows the next change date and no form", () => {
    mockAuth.state = signedIn({ username: "aino", usernameChangedAt: "2026-10-10T12:00:00.000Z" });
    const r = render(<UsernameScreen now={NOW} />);
    expect(texts(r)).toContain("@aino");
    expect(texts(r).some((t) => /You can change it again on 9 Nov 2026 \(22 days\)/.test(t))).toBe(true);
    expect(r.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it("invalid input is explained locally; a valid name is confirmed, then saved via the server", async () => {
    mockAuth.state = signedIn({});
    mockAuth.setUsername.mockResolvedValue({ ok: true, value: { kind: "CHANGED", username: "aino_park", nextChangeAt: "2026-11-17T12:00:00.000Z" } });
    const r = render(<UsernameScreen now={NOW} />);
    const input = () => r.root.findByType(TextInput);
    act(() => input().props.onChangeText("aino park"));
    await pressByLabel(r, "Save username");
    expect(texts(r).some((t) => /no spaces/.test(t))).toBe(true);
    expect(mockAuth.setUsername).not.toHaveBeenCalled();

    act(() => input().props.onChangeText(" Aino_Park "));
    await pressByLabel(r, "Save username");
    expect(texts(r).some((t) => /can't change your username again for 30 days/.test(t))).toBe(true);
    await pressByLabel(r, "Save");
    expect(mockAuth.setUsername).toHaveBeenCalledWith("aino_park");
    expect(texts(r)).toContain("Your username is now @aino_park.");
  });

  it("taken / cooldown answers from the server are shown, never hidden", async () => {
    mockAuth.state = signedIn({});
    mockAuth.setUsername.mockResolvedValue({ ok: true, value: { kind: "TAKEN" } });
    const r = render(<UsernameScreen now={NOW} />);
    act(() => r.root.findByType(TextInput).props.onChangeText("taken_name"));
    await pressByLabel(r, "Save username");
    await pressByLabel(r, "Save");
    expect(texts(r)).toContain("That username is taken. Try another one.");
  });

  it("same name: no server call, no cooldown restart", async () => {
    mockAuth.state = signedIn({ username: "aino" });
    const r = render(<UsernameScreen now={NOW} />);
    act(() => r.root.findByType(TextInput).props.onChangeText("AINO"));
    await pressByLabel(r, "Save username");
    expect(mockAuth.setUsername).not.toHaveBeenCalled();
    expect(texts(r)).toContain("@aino is already your username.");
  });

  it("staff accounts and the local demo get no form", () => {
    mockAuth.state = signedIn({}, "OFFICER");
    expect(texts(render(<UsernameScreen now={NOW} />))).toContain("Usernames are for citizen accounts. Staff accounts use their name.");
    mockAuth.state = { mode: "LOCAL_DEMO", status: "backend-not-configured" };
    mockAuth.mode = "LOCAL_DEMO";
    expect(texts(render(<UsernameScreen now={NOW} />))).toContain("Usernames are not used in the demo.");
    mockAuth.mode = "BACKEND";
  });
});

describe("wiring and privacy", () => {
  it("Profile has the Username row (real in backend mode, dimmed in the demo) and the route exists", () => {
    const profile = read("app/user/profile.tsx");
    expect(profile).toMatch(/title="Username" subtitle=\{usernameRowSubtitle\(profile\?\.username, profile\?\.usernameChangedAt\)\} onPress=\{\(\) => router\.push\("\/user\/username"\)\}/);
    expect(profile).toMatch(/title="Username" subtitle="Not used in the demo" unavailable/);
    expect(read("app/user/username.tsx")).toMatch(/UsernameScreen/);
  });
  it("display_name is untouched and no username is ever derived from the email", () => {
    const src = read("src/auth/username.ts") + read("src/auth/AccountScreens.tsx") + read("src/backend/repositories/profileRepository.ts");
    expect(src).not.toMatch(/email\.split|\.email\b.*username|username.*\.email\b/);
    expect(read("src/auth/authService.ts")).toMatch(/options: \{ data: \{ display_name: displayName\.trim\(\) \} \}/);
  });
  it("profile loading: reads the username when present, and works on a database with T9.3 but not T9.4", async () => {
    const make = (hasUsername: boolean) => {
      const selects: string[] = [];
      const from = (table: string) => ({
        select: (cols: string) => {
          selects.push(cols);
          const q = {
            eq: () => q,
            maybeSingle: async () =>
              cols.includes("username") && !hasUsername
                ? { data: null, error: { code: "42703", message: "column profiles.username does not exist" }, status: 400 }
                : { data: { id: USER.id, role: "CITIZEN", display_name: "Aino", deletion_requested_at: null, ...(hasUsername ? { username: "aino", username_changed_at: "2026-10-18T12:00:00Z" } : {}) }, error: null, status: 200 },
            then: (res: (v: unknown) => void) => res({ data: table === "organization_members" ? [] : [], error: null, status: 200 }),
          };
          return q;
        },
      });
      return { repo: createProfileRepository(() => ({ ok: true, value: { from } as never })), selects };
    };
    const withT94 = make(true);
    const a = await withT94.repo.getAccessData(USER.id);
    expect(a.ok && a.value.profile).toEqual({ id: USER.id, role: "CITIZEN", displayName: "Aino", username: "aino", usernameChangedAt: "2026-10-18T12:00:00Z" });
    const onlyT93 = make(false);
    const b = await onlyT93.repo.getAccessData(USER.id);
    expect(b.ok && b.value.profile).toEqual({ id: USER.id, role: "CITIZEN", displayName: "Aino" });
    expect(onlyT93.selects.slice(0, 2)).toEqual(["id, role, display_name, deletion_requested_at, username, username_changed_at", "id, role, display_name, deletion_requested_at"]);
  });

  it("profile loading falls back when the T9.4 columns are missing (app works before the migration)", () => {
    const repo = read("src/backend/repositories/profileRepository.ts");
    expect(repo).toMatch(/"id, role, display_name, deletion_requested_at, username, username_changed_at"/);
    expect(repo).toMatch(/"id, role, display_name, deletion_requested_at"/);
    expect(repo).toMatch(/deletion_requested_at\|username/);
  });
});
