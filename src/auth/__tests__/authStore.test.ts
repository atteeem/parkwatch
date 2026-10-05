import { createAuthStore } from "../authStore";
import { AuthEvent, AuthService } from "../authService";
import { authError } from "../authErrors";
import { AuthUser, Membership, TrustedProfile } from "../authTypes";
import { resolveAccess } from "../roleResolution";

const CITIZEN: AuthUser = { id: "11111111-1111-4111-8111-111111111111", email: "mika@example.test" };
const OFFICER: AuthUser = { id: "22222222-2222-4222-8222-222222222222", email: "officer@example.test" };

type Server = {
  sessionUser: AuthUser | null;
  profiles: Record<string, TrustedProfile | undefined>;
  memberships: Record<string, Membership[]>;
  ensureCalls: number;
  ensureCreates: boolean;
  signUpSession: boolean;
};

/** In-memory stand-in for Supabase Auth + the profile tables. */
function fakeService(server: Server) {
  let listener: ((e: AuthEvent, u: AuthUser | null) => void) | null = null;
  const service: AuthService = {
    getCurrentUser: async () => ({ ok: true, value: server.sessionUser }),
    onAuthChange(l) {
      listener = l;
      return () => (listener = null);
    },
    signIn: async (email, password) => {
      const user = [CITIZEN, OFFICER].find((u) => u.email === email);
      if (!user || password !== "correct horse") return { ok: false, error: authError("INVALID_CREDENTIALS") };
      server.sessionUser = user;
      return { ok: true, value: user };
    },
    signUp: async (displayName, email) => {
      const user = { id: "33333333-3333-4333-8333-333333333333", email };
      // Server trigger: always CITIZEN, whatever the client wanted.
      server.profiles[user.id] = { id: user.id, role: "CITIZEN", displayName };
      if (!server.signUpSession) return { ok: true, value: { kind: "CONFIRM_EMAIL", email } };
      server.sessionUser = user;
      return { ok: true, value: { kind: "SIGNED_IN" } };
    },
    signOut: async () => {
      server.sessionUser = null;
      return { ok: true, value: undefined };
    },
    loadAccess: async (userId) => ({ ok: true, value: { profile: server.profiles[userId] ?? null, memberships: server.memberships[userId] ?? [] } }),
    ensureProfile: async () => {
      server.ensureCalls++;
      const id = server.sessionUser!.id;
      if (!server.ensureCreates) return { ok: false, error: authError("PROFILE_NOT_FOUND") };
      server.profiles[id] = { id, role: "CITIZEN", displayName: "" };
      return { ok: true, value: server.profiles[id]! };
    },
    watchAppState: () => () => {},
  };
  return { service, emit: (e: AuthEvent, u: AuthUser | null) => listener?.(e, u) };
}

function setup(over: Partial<Server> = {}) {
  const server: Server = {
    sessionUser: null,
    profiles: {
      [CITIZEN.id]: { id: CITIZEN.id, role: "CITIZEN", displayName: "Mika Salo" },
      [OFFICER.id]: { id: OFFICER.id, role: "OFFICER", displayName: "Olli Officer" },
    },
    memberships: { [OFFICER.id]: [{ organizationId: "org-1", organizationName: "Helsinki Enforcement", memberRole: "OFFICER", active: true }] },
    ensureCalls: 0,
    ensureCreates: true,
    signUpSession: false,
    ...over,
  };
  const fake = fakeService(server);
  const store = createAuthStore("BACKEND", fake.service);
  return { server, store, emit: fake.emit };
}

describe("auth store", () => {
  it("LOCAL_DEMO: no session, no network, nothing to start", async () => {
    const store = createAuthStore("LOCAL_DEMO", null);
    await store.start();
    expect(store.getState()).toEqual({ mode: "LOCAL_DEMO", status: "backend-not-configured" });
    expect(await store.signIn("a@b.cd", "x")).toMatchObject({ ok: false, error: { code: "BACKEND_NOT_CONFIGURED" } });
  });

  it("loading -> unauthenticated when there is no stored session (no session is invented)", async () => {
    const { store } = setup();
    expect(store.getState()).toEqual({ mode: "BACKEND", status: "loading" });
    await store.start();
    expect(store.getState()).toEqual({ mode: "BACKEND", status: "unauthenticated" });
  });

  it("a restored session becomes authenticated with server-resolved CITIZEN access", async () => {
    const { store } = setup({ sessionUser: CITIZEN });
    await store.start();
    expect(store.getState()).toMatchObject({ status: "authenticated", user: CITIZEN, profile: { role: "CITIZEN", displayName: "Mika Salo" }, access: { kind: "CITIZEN" } });
  });

  it("an officer with an active membership resolves to OFFICER", async () => {
    const { store } = setup({ sessionUser: OFFICER });
    await store.start();
    expect(store.getState()).toMatchObject({ access: { kind: "OFFICER", organizations: [{ id: "org-1", name: "Helsinki Enforcement" }] } });
  });

  it("sign in with wrong password stays signed out with a mapped error", async () => {
    const { store } = setup();
    await store.start();
    expect(await store.signIn(CITIZEN.email!, "nope")).toMatchObject({ ok: false, error: { code: "INVALID_CREDENTIALS" } });
    expect(store.getState().status).toBe("unauthenticated");
  });

  it("sign in -> authenticated; sign out clears the trusted profile and access", async () => {
    const { store } = setup();
    await store.start();
    expect(await store.signIn(OFFICER.email!, "correct horse")).toEqual({ ok: true, value: undefined });
    expect(store.getState()).toMatchObject({ status: "authenticated", access: { kind: "OFFICER" } });
    await store.signOut();
    expect(store.getState()).toEqual({ mode: "BACKEND", status: "unauthenticated" });
  });

  it("a SIGNED_OUT event (e.g. refresh token revoked) removes protected access", async () => {
    const { store, emit } = setup({ sessionUser: CITIZEN });
    await store.start();
    emit("SIGNED_OUT", null);
    expect(store.getState().status).toBe("unauthenticated");
  });

  it("refresh after the session expired elsewhere -> signed out with a notice", async () => {
    const { store, server } = setup({ sessionUser: CITIZEN });
    await store.start();
    server.sessionUser = null;
    await store.refreshAccess();
    expect(store.getState()).toMatchObject({ status: "unauthenticated", notice: expect.stringContaining("session has ended") });
  });

  it("removing the officer membership revokes officer access on refresh (no stale OFFICER)", async () => {
    const { store, server } = setup({ sessionUser: OFFICER });
    await store.start();
    expect(store.getState()).toMatchObject({ access: { kind: "OFFICER" } });
    server.memberships[OFFICER.id] = [{ organizationId: "org-1", memberRole: "OFFICER", active: false }];
    await store.refreshAccess();
    expect(store.getState()).toMatchObject({ access: { kind: "OFFICER_NOT_AUTHORIZED" } });
    server.memberships[OFFICER.id] = [];
    await store.refreshAccess();
    expect(store.getState()).toMatchObject({ access: { kind: "OFFICER_NOT_AUTHORIZED" } });
  });

  it("user_metadata claiming OFFICER changes nothing: the server profile decides", async () => {
    const tampered = { ...CITIZEN, user_metadata: { role: "OFFICER" }, app_metadata: { role: "ADMIN" } } as unknown as AuthUser;
    const { store } = setup({ sessionUser: tampered });
    await store.start();
    expect(store.getState()).toMatchObject({ access: { kind: "CITIZEN" } });
  });

  it("missing profile: the server bootstraps a CITIZEN profile (never anything else)", async () => {
    const { store, server } = setup({ sessionUser: { id: "44444444-4444-4444-8444-444444444444" } });
    await store.start();
    expect(server.ensureCalls).toBe(1);
    expect(store.getState()).toMatchObject({ access: { kind: "CITIZEN" } });
  });

  it("unrecoverable profile -> access error state (no crash, no fallback role)", async () => {
    const { store } = setup({ sessionUser: { id: "55555555-5555-4555-8555-555555555555" }, ensureCreates: false });
    await store.start();
    expect(store.getState()).toMatchObject({ status: "authenticated", access: null, accessError: { code: "PROFILE_NOT_FOUND" } });
  });

  it("sign up with email confirmation: NOT signed in, told to check email", async () => {
    const { store } = setup({ signUpSession: false });
    await store.start();
    expect(await store.signUp("New Person", "new@example.test", "longpassword")).toEqual({ ok: true, value: { kind: "CONFIRM_EMAIL", email: "new@example.test" } });
    expect(store.getState().status).toBe("unauthenticated");
  });

  it("sign up without confirmation: signed in as CITIZEN", async () => {
    const { store } = setup({ signUpSession: true });
    await store.start();
    expect(await store.signUp("New Person", "new@example.test", "longpassword")).toMatchObject({ ok: true, value: { kind: "SIGNED_IN" } });
    expect(store.getState()).toMatchObject({ status: "authenticated", profile: { role: "CITIZEN", displayName: "New Person" }, access: { kind: "CITIZEN" } });
  });

  it("a stale access load for a previous user never overwrites the current one", async () => {
    const { store, server } = setup({ sessionUser: OFFICER });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = fakeService(server);
    const slow = { ...fake.service, loadAccess: async (id: string) => { if (id === OFFICER.id) await gate; return fake.service.loadAccess(id); } };
    const s2 = createAuthStore("BACKEND", slow);
    const starting = s2.start();
    await new Promise((r) => setTimeout(r, 0));
    await s2.signOut();
    release();
    await starting;
    expect(s2.getState().status).toBe("unauthenticated");
    expect(store).toBeDefined();
  });
});

describe("role resolution", () => {
  const p = (role: TrustedProfile["role"]): TrustedProfile => ({ id: "u", role, displayName: "x" });
  const m = (memberRole: Membership["memberRole"], active = true): Membership => ({ organizationId: "o", memberRole, active });

  it.each([
    ["CITIZEN profile", p("CITIZEN"), [], "CITIZEN"],
    ["CITIZEN profile even with a membership row", p("CITIZEN"), [m("OFFICER")], "CITIZEN"],
    ["OFFICER profile + active OFFICER membership", p("OFFICER"), [m("OFFICER")], "OFFICER"],
    ["OFFICER profile + active SUPERVISOR membership", p("OFFICER"), [m("SUPERVISOR")], "OFFICER"],
    ["OFFICER profile + inactive membership", p("OFFICER"), [m("OFFICER", false)], "OFFICER_NOT_AUTHORIZED"],
    ["OFFICER profile + only an ADMIN membership", p("OFFICER"), [m("ADMIN")], "OFFICER_NOT_AUTHORIZED"],
    ["OFFICER profile + no membership", p("OFFICER"), [], "OFFICER_NOT_AUTHORIZED"],
    ["SUPERVISOR", p("SUPERVISOR"), [m("SUPERVISOR")], "STAFF"],
    ["ADMIN", p("ADMIN"), [], "STAFF"],
  ] as const)("%s -> %s", (_label, profile, memberships, kind) => {
    expect(resolveAccess(profile, memberships as readonly Membership[]).kind).toBe(kind);
  });

  it("no profile or an unknown role is invalid (never a default role)", () => {
    expect(resolveAccess(null, [m("OFFICER")]).kind).toBe("PROFILE_INVALID");
    expect(resolveAccess({ id: "u", role: "SUPERUSER" as never, displayName: "" }, []).kind).toBe("PROFILE_INVALID");
  });
});
