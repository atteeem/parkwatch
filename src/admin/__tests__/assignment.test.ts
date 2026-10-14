// T9.2 supervisor actions in the app: domain rules (same as the server
// functions), local-demo store + console, backend console calls, "needs
// attention" and the console's assignment wording. The database side
// (authorization, organization scope, audit, push enqueue) is covered by
// scripts/verify-t92.mjs against the real migrations.
import * as fs from "fs";
import * as path from "path";
import { OfficerCase, supervisorAssign, supervisorReturnToQueue } from "../../domain";
import { buildSeedState } from "../../store/seed";
import { ParkWatchState } from "../../store/state";
import { supervisorAssignCase, supervisorUnassignCase } from "../../store/commands";
import { DEV_OFFICER_ID } from "../../store/session";
import { assignableOfficers, auditRows, caseDetail, caseRows, createLocalAdmin, LOCAL_DEMO_SECOND_OFFICER_ID, overview } from "../localAdmin";
import { ATTENTION_STATUS_TEXT, DEFAULT_ATTENTION_THRESHOLDS, formatElapsed, needsAttention, statusSince } from "../attention";
import { assignmentOptions, confirmCopy, pickerOfficers } from "../assignment";
import { auditDetails, auditEventText } from "../adminViews";
import { createAdminOperations } from "../../backend/admin/adminOperations";
import { describeDomainError } from "../../presentation/errors";
import { mapRpcError } from "../../backend/operations/rpcErrors";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const NOW = new Date("2026-10-14T12:00:00.000Z");
const AT = NOW.toISOString();
const ctx = { at: AT, actor: { role: "SUPERVISOR" as const, accountId: "sup-1" }, source: "USER_ACTION" as const };

const baseCase = (over: Partial<OfficerCase> = {}): OfficerCase => ({
  id: "case-1",
  reportId: "100001",
  jurisdictionId: "helsinki-demo",
  status: "NEW",
  priority: "NORMAL",
  createdAt: "2026-10-14T08:00:00.000Z",
  statusTimestamps: { NEW: "2026-10-14T08:00:00.000Z" },
  events: [],
  ...over,
});

describe("supervisor assignment rules (domain = server rules)", () => {
  it("assigns a NEW case: ASSIGNED, version+1, current assignment time, audited event", () => {
    const r = supervisorAssign(baseCase(), "off-1", 0, ctx);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.value.changed).toBe(true);
    expect(r.value.case).toMatchObject({ status: "ASSIGNED", assignedOfficerId: "off-1", assignmentVersion: 1 });
    expect(r.value.case.statusTimestamps.ASSIGNED).toBe(AT);
    expect(r.value.case.events.at(-1)).toMatchObject({ type: "ASSIGNMENT_CHANGED", from: "NEW", to: "ASSIGNED", toOfficerId: "off-1", actor: ctx.actor });
  });

  it("retrying the same request is a no-op; a stale version is refused", () => {
    const first = supervisorAssign(baseCase(), "off-1", 0, ctx);
    if (!first.ok) throw new Error();
    const again = supervisorAssign(first.value.case, "off-1", 0, ctx);
    expect(again.ok && again.value.changed).toBe(false);
    const stale = supervisorAssign(first.value.case, "off-2", 0, ctx);
    expect(!stale.ok && stale.error.code).toBe("STALE_ASSIGNMENT");
  });

  it("reassigns an ASSIGNED (not started) case and remembers the previous officer", () => {
    const a = supervisorAssign(baseCase(), "off-1", 0, ctx);
    if (!a.ok) throw new Error();
    const b = supervisorAssign(a.value.case, "off-2", 1, ctx);
    if (!b.ok) throw new Error(b.error.code);
    expect(b.value).toMatchObject({ changed: true, previousOfficerId: "off-1" });
    expect(b.value.case).toMatchObject({ assignedOfficerId: "off-2", assignmentVersion: 2, status: "ASSIGNED" });
  });

  it("started and completed cases are never moved", () => {
    for (const status of ["EN_ROUTE", "ON_SITE", "INSPECTION"] as const) {
      const c = baseCase({ status, assignedOfficerId: "off-1" });
      const a = supervisorAssign(c, "off-2", 0, ctx);
      const u = supervisorReturnToQueue(c, 0, ctx);
      expect([!a.ok && a.error.code, !u.ok && u.error.code]).toEqual(["NOT_ASSIGNABLE", "NOT_ASSIGNABLE"]);
    }
    const done = baseCase({ status: "COMPLETED", completedAt: AT });
    const a = supervisorAssign(done, "off-2", 0, ctx);
    expect(!a.ok && a.error.code).toBe("ALREADY_COMPLETED");
  });

  it("return to queue: ASSIGNED -> NEW, assignment time cleared; retry is a no-op", () => {
    const a = supervisorAssign(baseCase(), "off-1", 0, ctx);
    if (!a.ok) throw new Error();
    const u = supervisorReturnToQueue(a.value.case, 1, ctx);
    if (!u.ok) throw new Error(u.error.code);
    expect(u.value.case).toMatchObject({ status: "NEW", assignedOfficerId: undefined, assignmentVersion: 2 });
    expect(u.value.case.statusTimestamps.ASSIGNED).toBeUndefined();
    expect(u.value.previousOfficerId).toBe("off-1");
    const again = supervisorReturnToQueue(u.value.case, 1, ctx);
    expect(again.ok && again.value.changed).toBe(false);
  });
});

describe("local demo store: notifications once per assignment version, never to the citizen", () => {
  const seed: ParkWatchState = buildSeedState(NOW);
  const fresh = seed.cases.find((c) => c.status === "NEW")!;

  it("assign -> one CASE_ASSIGNED for the officer; retry adds nothing; reassign -> new officer + in-app update for the old one", () => {
    const a = supervisorAssignCase(seed, { caseId: fresh.id, officerId: DEV_OFFICER_ID, expectedVersion: 0, supervisorId: "sup", at: AT });
    if (!a.ok) throw new Error(a.error.code);
    const again = supervisorAssignCase(a.value.state, { caseId: fresh.id, officerId: DEV_OFFICER_ID, expectedVersion: 0, supervisorId: "sup", at: AT });
    if (!again.ok) throw new Error();
    expect(again.value.value.changed).toBe(false);
    const forCase = (s: ParkWatchState) => s.notifications.filter((n) => n.caseId === fresh.id && n.type.startsWith("CASE_ASSIGN"));
    expect(forCase(again.value.state).map((n) => [n.type, n.recipient.accountId])).toEqual([["CASE_ASSIGNED", DEV_OFFICER_ID]]);
    const b = supervisorAssignCase(again.value.state, { caseId: fresh.id, officerId: LOCAL_DEMO_SECOND_OFFICER_ID, expectedVersion: 1, supervisorId: "sup", at: AT });
    if (!b.ok) throw new Error(b.error.code);
    expect(forCase(b.value.state).map((n) => [n.type, n.recipient.accountId])).toEqual([
      ["CASE_ASSIGNED", DEV_OFFICER_ID],
      ["CASE_ASSIGNED", LOCAL_DEMO_SECOND_OFFICER_ID],
      ["CASE_ASSIGNMENT_REMOVED", DEV_OFFICER_ID],
    ]);
    const citizenNotes = b.value.state.notifications.filter((n) => n.recipient.role === "CITIZEN").length;
    expect(citizenNotes).toBe(seed.notifications.filter((n) => n.recipient.role === "CITIZEN").length);
    const u = supervisorUnassignCase(b.value.state, { caseId: fresh.id, expectedVersion: 2, supervisorId: "sup", at: AT });
    if (!u.ok) throw new Error(u.error.code);
    expect(u.value.state.cases.find((c) => c.id === fresh.id)?.status).toBe("NEW");
  });

  it("local console: officer picker, refusal of non-officers, history with names", async () => {
    let state = seed;
    const admin = createLocalAdmin(() => state, () => NOW, {
      assign: (caseId, officerId, v, sup) => {
        const r = supervisorAssignCase(state, { caseId, officerId, expectedVersion: v, supervisorId: sup, at: AT });
        if (!r.ok) return r;
        state = r.value.state;
        return { ok: true, value: r.value.value };
      },
      unassign: (caseId, v, sup) => {
        const r = supervisorUnassignCase(state, { caseId, expectedVersion: v, supervisorId: sup, at: AT });
        if (!r.ok) return r;
        state = r.value.state;
        return { ok: true, value: r.value.value };
      },
    });
    const list = await admin.listAssignableOfficers(fresh.id);
    expect(list.ok && list.value!.map((o) => o.userId)).toEqual([DEV_OFFICER_ID, LOCAL_DEMO_SECOND_OFFICER_ID]);
    const refused = await admin.assignCase(fresh.id, "supervisor-demo", 0);
    expect(!refused.ok && refused.error.code).toBe("INVALID_OFFICER");
    expect((await admin.assignCase(fresh.id, DEV_OFFICER_ID, 0)).ok).toBe(true);
    expect((await admin.assignCase(fresh.id, LOCAL_DEMO_SECOND_OFFICER_ID, 1)).ok).toBe(true);
    const d = caseDetail(state, fresh.id, NOW)!;
    expect(d.assignmentVersion).toBe(2);
    const events = d.audit.filter((e) => e.eventType.startsWith("CASE_") && e.eventType.includes("ASSIGN"));
    expect(events.map((e) => [e.eventType, auditDetails(e.metadata)])).toEqual([
      ["CASE_ASSIGNED", "officer Mikko Virtanen · from New · to Assigned"],
      ["CASE_REASSIGNED", "officer Mikko Virtanen → Aino Korhonen · from Assigned · to Assigned"],
    ]);
    expect(auditRows(state, {}).some((e) => e.eventType === "CASE_REASSIGNED" && e.actorRole === "SUPERVISOR")).toBe(true);
    expect(assignableOfficers(state, "missing")).toBeNull();
  });
});

describe("needs attention (lifecycle timestamps only)", () => {
  it("thresholds equal the migration's server defaults", () => {
    const sql = read("supabase/migrations/20261014000003_t92_case_assignment.sql");
    const def = (col: string) => Number(new RegExp(`add column ${col} integer not null default (\\d+)`).exec(sql)?.[1]);
    expect({
      NEW: def("attention_new_minutes"),
      ASSIGNED: def("attention_assigned_minutes"),
      EN_ROUTE: def("attention_en_route_minutes"),
      ON_SITE: def("attention_on_site_minutes"),
      INSPECTION: def("attention_inspection_minutes"),
    }).toEqual(DEFAULT_ATTENTION_THRESHOLDS);
  });

  it("measures from the CURRENT status's timestamp; completed is never flagged", () => {
    const t = { createdAt: "2026-10-14T08:00:00.000Z", assignedAt: "2026-10-14T11:30:00.000Z", enRouteAt: "2026-10-14T11:50:00.000Z" };
    expect(statusSince("NEW", t)).toBe(t.createdAt);
    expect(statusSince("ASSIGNED", t)).toBe(t.assignedAt);
    expect(statusSince("EN_ROUTE", t)).toBe(t.enRouteAt);
    expect(statusSince("COMPLETED", t)).toBeNull();
    expect(needsAttention("NEW", t.createdAt, NOW)).toBe(true); // 4 h > 30 min
    expect(needsAttention("ASSIGNED", t.assignedAt, NOW)).toBe(true); // 30 min > 20
    expect(needsAttention("EN_ROUTE", t.enRouteAt, NOW)).toBe(false); // 10 min < 45
    expect(needsAttention("COMPLETED", t.createdAt, NOW)).toBe(false);
    expect(needsAttention("EN_ROUTE", t.enRouteAt, NOW, { ...DEFAULT_ATTENTION_THRESHOLDS, EN_ROUTE: 5 })).toBe(true);
  });

  it("formats elapsed time plainly", () => {
    expect(formatElapsed("2026-10-14T11:15:00.000Z", NOW)).toBe("45 min");
    expect(formatElapsed("2026-10-14T09:55:00.000Z", NOW)).toBe("2 h 05 min");
    expect(formatElapsed("2026-10-11T08:00:00.000Z", NOW)).toBe("3 d 4 h");
    expect(ATTENTION_STATUS_TEXT.EN_ROUTE).toBe("on the way");
  });

  it("local console: flags, filter and overview count agree; completed never flagged", () => {
    const seed = buildSeedState(new Date(NOW.getTime() - 3 * 3600_000));
    const rows = caseRows(seed, {}, NOW);
    const flagged = caseRows(seed, { attention: true }, NOW);
    expect(flagged.every((r) => r.needsAttention)).toBe(true);
    expect(rows.filter((r) => r.status === "COMPLETED").some((r) => r.needsAttention)).toBe(false);
    expect(overview(seed, NOW).casesNeedingAttention).toBe(flagged.length);
  });

  it("the attention signal reads no location data", () => {
    const code = read("src/admin/attention.ts")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/latitude|longitude|location|gps|coordinates/i);
  });
});

describe("console wording and options", () => {
  it("offers only what the server allows", () => {
    expect(assignmentOptions("NEW")).toMatchObject({ assign: true, reassign: false, returnToQueue: false, lockedReason: null });
    expect(assignmentOptions("ASSIGNED")).toMatchObject({ assign: false, reassign: true, returnToQueue: true });
    for (const s of ["EN_ROUTE", "ON_SITE", "INSPECTION", "COMPLETED"] as const) expect(assignmentOptions(s).lockedReason).toBeTruthy();
  });

  it("picker: current officer excluded, least busy first", () => {
    expect(
      pickerOfficers([
        { userId: "a", displayName: "A", activeCases: 3, isCurrent: false },
        { userId: "b", displayName: "B", activeCases: 0, isCurrent: false },
        { userId: "c", displayName: "C", activeCases: 0, isCurrent: true },
      ]).map((o) => o.userId)
    ).toEqual(["b", "a"]);
  });

  it("reassignment and return to queue are confirmed with plain wording", () => {
    expect(confirmCopy("reassign", "Aino", "Mikko").message).toMatch(/from Mikko to Aino/);
    expect(confirmCopy("return", undefined, "Mikko").confirm).toBe("Return to queue");
    expect(auditEventText("CASE_REASSIGNED")).toBe("Case reassigned");
    expect(auditEventText("CASE_UNASSIGNED")).toBe("Case returned to the queue");
  });

  it("server refusals map to plain messages", () => {
    for (const code of ["STALE_ASSIGNMENT", "NOT_ASSIGNABLE", "INVALID_OFFICER"]) {
      const e = mapRpcError({ code: "P0001", message: `${code}: whatever` });
      expect(e.code).toBe(code);
      expect(describeDomainError(e).message).not.toMatch(/_/);
    }
  });
});

describe("backend console calls (assignment)", () => {
  type Call = { fn: string; args: Record<string, unknown> };
  const fake = (answers: Record<string, unknown>) => {
    const calls: Call[] = [];
    const client = { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { data: answers[fn] ?? null, error: null, status: 200 }) };
    const storage = { upload: async () => ({ ok: true, value: { created: true } }), remove: async () => undefined, sign: async () => ({}) };
    return { api: createAdminOperations(client as never, storage as never, { timeZone: () => "UTC" }), calls };
  };
  const CASE = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  const OFF = "3f1c2b4a-9d8e-4c7b-a6f5-0e1d2c3b4a59";

  it("send only the case, the chosen officer and the version shown - never identity, organization or role", async () => {
    const { api, calls } = fake({ admin_assign_case: { changed: true, assignment_version: 1 }, admin_unassign_case: { changed: true, assignment_version: 2 }, admin_list_assignable_officers: [] });
    expect(await api.assignCase(CASE, OFF, 0)).toEqual({ ok: true, value: { changed: true, assignmentVersion: 1 } });
    expect(await api.unassignCase(CASE, 1)).toEqual({ ok: true, value: { changed: true, assignmentVersion: 2 } });
    await api.listAssignableOfficers(CASE);
    expect(calls).toEqual([
      { fn: "admin_assign_case", args: { p_case_id: CASE, p_officer_id: OFF, p_expected_version: 0 } },
      { fn: "admin_unassign_case", args: { p_case_id: CASE, p_expected_version: 1 } },
      { fn: "admin_list_assignable_officers", args: { p_case_id: CASE } },
    ]);
  });

  it("malformed ids are never sent; malformed answers are BACKEND_ERROR", async () => {
    const { api, calls } = fake({ admin_assign_case: { changed: true } });
    expect((await api.assignCase("x", OFF, 0)).ok).toBe(false);
    expect((await api.assignCase(CASE, "x", 0)).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const r = await api.assignCase(CASE, OFF, 0);
    expect(!r.ok && r.error.code).toBe("BACKEND_ERROR");
  });

  it("officer list: no tokens, emails or locations are parsed into the console", async () => {
    const { api } = fake({ admin_list_assignable_officers: [{ user_id: OFF, display_name: "Olga", active_cases: 2, is_current: false, email: "x@y", expo_push_token: "ExponentPushToken[zzzzzzzzzz]" }] });
    const r = await api.listAssignableOfficers(CASE);
    expect(r).toEqual({ ok: true, value: [{ userId: OFF, displayName: "Olga", activeCases: 2, isCurrent: false }] });
  });

  it("no raw push token can reach the console", () => {
    for (const f of ["src/backend/admin/adminOperations.ts", "src/admin/adminTypes.ts", "src/admin/localAdmin.ts", "src/admin/CaseAssignmentPanel.tsx", "app/admin/cases/[id].tsx"]) {
      expect(read(f)).not.toMatch(/push_token|expo_push|push_devices/i);
    }
  });
});
