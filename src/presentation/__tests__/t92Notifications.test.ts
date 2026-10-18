// T9.2 notification rules in the app: which officer outcomes may produce a
// citizen (push) notification, in-app copy and deep links for the new
// assignment notifications, and the sign-out hook that unregisters push.
import { buildCitizenOutcomeNotification, EnforcementOutcomeCode, getCitizenOutcomeForEnforcementOutcome, Notification } from "../../domain";
import { pushContentFor, PUSH_TYPES } from "../../../supabase/functions/_shared/pushContent";
import { officerNotificationTarget } from "../../navigation/notificationTargets";
import { toNotificationView } from "../viewModels";
import { buildSeedState } from "../../store/seed";
import { createAuthStore } from "../../auth/authStore";
import type { AuthService } from "../../auth/authService";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const CASE = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("citizen outcome -> notification -> push (hard product rules)", () => {
  const notify = (code: EnforcementOutcomeCode, credited = 500) =>
    buildCitizenOutcomeNotification(getCitizenOutcomeForEnforcementOutcome(code), { citizenId: "c1", reportId: "100023", caseId: CASE, at: NOW.toISOString(), creditedCents: credited });
  const push = (n: Notification | null) =>
    n ? pushContentFor({ id: n.id, type: n.type, recipient_role: n.recipient.role, amount_cents: n.amountCents ?? null, report_number: n.reportId ?? null, case_id: n.caseId ?? null }) : null;

  it("CHARGE_ISSUED -> one 'Report verified' push mentioning the €5 reward", () => {
    const n = notify("CHARGE_ISSUED");
    expect(n?.type).toBe("REPORT_VERIFIED");
    expect(n?.idempotencyKey).toBe("REPORT_VERIFIED:100023");
    expect(push(n)).toMatchObject({ title: "Report verified", body: "Your report was verified. €5.00 reward is now available." });
  });

  it("CHARGE_ISSUED without a credited reward does not claim one", () => {
    expect(push(notify("CHARGE_ISSUED", 0))?.body).toBe("Your report was verified.");
  });

  it("REPORT_REJECTED -> one 'Report rejected' push", () => {
    const n = notify("REPORT_REJECTED");
    expect(n?.type).toBe("REPORT_REJECTED");
    expect(push(n)?.title).toBe("Report rejected");
  });

  it.each(["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"] as const)("%s -> NO citizen notification, so no 'verified'/'rejected' push", (code) => {
    const consequence = getCitizenOutcomeForEnforcementOutcome(code);
    expect(consequence.citizenNotification).toBeNull();
    expect(consequence.citizenStatus.resolution).not.toBe("RESOLVED");
    expect(notify(code)).toBeNull();
  });

  it("only REPORT_VERIFIED, REPORT_REJECTED and CASE_ASSIGNED are ever pushed", () => {
    expect([...PUSH_TYPES].sort()).toEqual(["CASE_ASSIGNED", "REPORT_REJECTED", "REPORT_VERIFIED"]);
  });
});

describe("assignment notifications in the app", () => {
  const state = buildSeedState(NOW);
  const base = { idempotencyKey: "k", recipient: { role: "OFFICER" as const, accountId: "o1" }, createdAt: NOW.toISOString(), reportId: "100023", caseId: CASE };

  it("CASE_ASSIGNED: in-app copy and a deep link to the case", () => {
    const v = toNotificationView({ ...base, id: "a", type: "CASE_ASSIGNED" }, state, NOW);
    expect(v.title).toBe("New case assigned");
    expect(v.body).toMatch(/^A supervisor assigned case #100023 to you\./);
    expect(officerNotificationTarget({ type: "CASE_ASSIGNED", caseId: CASE }, () => false, { serverScoped: true })).toEqual({ pathname: "/officer/report-details", params: { id: CASE } });
  });

  it("CASE_ASSIGNMENT_REMOVED: informational only (nothing to act on), never pushed", () => {
    const v = toNotificationView({ ...base, id: "b", type: "CASE_ASSIGNMENT_REMOVED" }, state, NOW);
    expect(v.title).toBe("Case moved");
    expect(v.body).toBe("Case #100023 is no longer assigned to you.");
    expect(officerNotificationTarget({ type: "CASE_ASSIGNMENT_REMOVED", caseId: CASE }, () => true, { serverScoped: true })).toBeNull();
    expect(pushContentFor({ id: "b", type: "CASE_ASSIGNMENT_REMOVED", recipient_role: "OFFICER", amount_cents: null, report_number: 100023, case_id: CASE })).toBeNull();
  });
});

describe("sign-out runs push cleanup while the session is still valid", () => {
  function fakeService(order: string[]): AuthService {
    return {
      getCurrentUser: async () => ({ ok: true, value: { id: "u1", email: "a@b.cd" } }),
      onAuthChange: () => () => undefined,
      signIn: async () => ({ ok: true, value: { id: "u1", email: "a@b.cd" } }),
      signUp: async () => ({ ok: true, value: { kind: "CONFIRM_EMAIL", email: "a@b.cd" } }),
      signOut: async () => {
        order.push("service.signOut");
        return { ok: true, value: undefined };
      },
      loadAccess: async () => ({ ok: true, value: { profile: { id: "u1", role: "CITIZEN", displayName: "" }, memberships: [] } }),
      ensureProfile: async () => ({ ok: true, value: { id: "u1", role: "CITIZEN", displayName: "" } }),
      watchAppState: () => () => undefined,
      requestPasswordReset: async () => ({ ok: true, value: undefined }),
      completePasswordReset: async () => ({ ok: true, value: undefined }),
      updatePassword: async () => ({ ok: true, value: undefined }),
      requestAccountDeletion: async () => ({ ok: true, value: undefined }),
      setUsername: async () => ({ ok: true, value: { kind: "TAKEN" } }),
    };
  }

  it("hooks run before the session is ended; identity is dropped first", async () => {
    const order: string[] = [];
    const store = createAuthStore("BACKEND", fakeService(order));
    await store.start();
    store.onBeforeSignOut(async () => {
      order.push(`hook (status=${store.getState().status})`);
    });
    await store.signOut();
    expect(order).toEqual(["hook (status=unauthenticated)", "service.signOut"]);
  });

  it("a failing or hanging hook never prevents sign-out", async () => {
    jest.useFakeTimers();
    try {
      const order: string[] = [];
      const store = createAuthStore("BACKEND", fakeService(order));
      await store.start();
      store.onBeforeSignOut(() => Promise.reject(new Error("offline")));
      store.onBeforeSignOut(() => new Promise(() => undefined));
      const done = store.signOut();
      await jest.advanceTimersByTimeAsync(3000);
      await done;
      expect(order).toEqual(["service.signOut"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("an unregistered hook is not called", async () => {
    const order: string[] = [];
    const store = createAuthStore("BACKEND", fakeService(order));
    await store.start();
    const off = store.onBeforeSignOut(async () => void order.push("hook"));
    off();
    await store.signOut();
    expect(order).toEqual(["service.signOut"]);
  });
});
