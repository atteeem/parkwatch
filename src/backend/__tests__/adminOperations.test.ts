// T9.0 console, BACKEND client: what is sent to the server (filters only,
// never identity/organization/role), how answers are mapped, and that
// evidence becomes signed URLs (or an unreadable reference), never public.
import { createAdminOperations } from "../admin/adminOperations";
import type { EvidenceStorage } from "../storage/evidenceStorage";

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(answers: Record<string, unknown>, error?: { code: string; message: string }) {
  const calls: Call[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (error) return { data: null, error, status: 400 };
      return { data: answers[fn] ?? null, error: null, status: 200 };
    },
  };
  return { client: client as never, calls };
}

function fakeStorage(readable: string[]) {
  const signs: { bucket: string; paths: string[] }[] = [];
  const storage: EvidenceStorage = {
    upload: async () => ({ ok: true, value: { created: true } }),
    remove: async () => undefined,
    sign: async (bucket, paths) => {
      signs.push({ bucket, paths });
      return Object.fromEntries(paths.filter((p) => readable.includes(p)).map((p) => [p, `https://signed.example/${p}?token=short`]));
    },
  };
  return { storage, signs };
}

/** Every parameter the console sends is a filter or paging value. */
const ALLOWED_ARGS = new Set([
  "p_time_zone", "p_status", "p_priority", "p_case_state", "p_from", "p_to", "p_search", "p_offset", "p_limit",
  "p_public_number", "p_case_id", "p_officer", "p_outcome", "p_month_start", "p_entry_type", "p_state",
  "p_actor_role", "p_entity_type", "p_event_type", "p_ref",
]);
/** Identity/scope must come from auth.uid() on the server, never from the client. */
const IDENTITY_ARG = /^p_(user|user_id|citizen|citizen_id|org|organization|organization_id|jurisdiction|jurisdiction_id|role|caller|account|member)/;

describe("admin operations (backend)", () => {
  it("list/filter calls send only filters and paging; never identity, organization or role", async () => {
    const { client, calls } = fakeClient({});
    const api = createAdminOperations(client, fakeStorage([]).storage, { timeZone: () => "Europe/Helsinki" });
    await api.whoami();
    await api.overview();
    await api.pageReports({ status: "VERIFIED", priority: "HIGH", caseState: "active", search: " ABC-123 ", from: "2026-10-01T00:00:00.000Z" }, 25);
    await api.pageCases({ status: "NEW", outcome: "CHARGE_ISSUED", priority: "HIGH" }, 0);
    await api.listOfficers();
    await api.pageRewards({ state: "PENDING" }, 0);
    await api.pageAudit({ actorRole: "OFFICER", entityType: "report", ref: "100023" }, 50);
    for (const c of calls) {
      for (const k of Object.keys(c.args)) {
        expect([c.fn, k, ALLOWED_ARGS.has(k)]).toEqual([c.fn, k, true]);
        expect([c.fn, k, IDENTITY_ARG.test(k)]).toEqual([c.fn, k, false]);
      }
    }
    expect(calls.find((c) => c.fn === "admin_page_reports")!.args).toMatchObject({ p_status: "VERIFIED", p_priority: "HIGH", p_case_state: "active", p_search: "ABC-123", p_offset: 25, p_limit: 25 });
    expect(calls.find((c) => c.fn === "admin_overview")!.args).toEqual({ p_time_zone: "Europe/Helsinki" });
    expect(calls.find((c) => c.fn === "admin_page_audit")!.args).toMatchObject({ p_ref: "100023", p_limit: 50, p_offset: 50 });
  });

  it("the officer filter is a filter value only (the server still scopes to the caller's organization)", async () => {
    const { client, calls } = fakeClient({});
    await createAdminOperations(client, fakeStorage([]).storage, { timeZone: () => "UTC" }).pageCases({ officerId: "u-1" }, 0);
    expect(calls[0].args.p_officer).toBe("u-1");
  });

  it("pages: rows, total, next offset; parking charge kept only for CHARGE_ISSUED", async () => {
    const { client } = fakeClient({
      admin_page_cases: {
        total: 3,
        next_offset: 2,
        rows: [
          { id: "c1", public_report_number: 100001, status: "COMPLETED", priority: "NORMAL", outcome_code: "CHARGE_ISSUED", parking_charge_amount_cents: 6000, created_at: "t" },
          { id: "c2", public_report_number: 100002, status: "COMPLETED", priority: "NORMAL", outcome_code: "REPORT_REJECTED", parking_charge_amount_cents: 6000, created_at: "t" },
        ],
      },
    });
    const r = await createAdminOperations(client, fakeStorage([]).storage, { timeZone: () => "UTC" }).pageCases({}, 0);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.total).toBe(3);
    expect(r.value.nextOffset).toBe(2);
    expect(r.value.rows.map((x) => x.parkingChargeCents)).toEqual([6000, undefined]);
  });

  it("report detail: evidence via signed URLs; unreadable objects stay unreadable references (no public URL)", async () => {
    const { client } = fakeClient({
      admin_get_report: {
        report: { id: "r1", public_report_number: 100005, status: "UNDER_REVIEW", priority: "NORMAL", location_source: "MAP_SELECTED", latitude: 60.1, longitude: 24.9, location_accuracy_m: 5, citizen_ref: "C-0000ABCD", notes: "" },
        evidence: [
          { slot: "REAR", storage_path: "u/d/rear.jpg" },
          { slot: "FRONT", storage_path: "u/d/front.jpg" },
        ],
        case: null,
        outcome: null,
        reward_state: "PENDING",
        ledger: [{ id: "l1", entry_type: "REWARD_PENDING", amount_cents: 500, created_at: "t" }],
        audit: [{ id: "a1", created_at: "t", actor_role: "CITIZEN", actor_label: "C-0000ABCD", entity_type: "report", event_type: "REPORT_SUBMITTED", metadata: {} }],
      },
    });
    const { storage, signs } = fakeStorage(["u/d/front.jpg"]);
    const r = await createAdminOperations(client, storage, { timeZone: () => "UTC" }).getReport(100005);
    if (!r.ok || !r.value) throw new Error("expected a report");
    expect(signs).toEqual([{ bucket: "report-evidence", paths: ["u/d/rear.jpg", "u/d/front.jpg"] }]);
    expect(r.value.evidence.map((e) => e.caption)).toEqual(["Front", "Rear"]);
    expect(r.value.evidence[0].uri).toMatch(/^https:\/\/signed\.example\//);
    expect(r.value.evidence[1].uri).not.toMatch(/^https?:/); // unreadable -> storage reference -> "Photo unavailable"
    expect(r.value.locationSource).toBe("MAP_SELECTED");
    expect(r.value.accuracyMeters).toBeUndefined(); // a map-picked point never shows GPS accuracy
    expect(r.value.rewardState).toBe("PENDING");
    expect(r.value.ledger[0].amountCents).toBe(500);
  });

  it("missing or out-of-organization detail -> null (not found); bad ids are not sent", async () => {
    const { client, calls } = fakeClient({ admin_get_report: null, admin_get_case: null });
    const api = createAdminOperations(client, fakeStorage([]).storage, { timeZone: () => "UTC" });
    expect(await api.getReport(100099)).toEqual({ ok: true, value: null });
    expect(await api.getCase("00000000-0000-4000-8000-000000000001")).toEqual({ ok: true, value: null });
    expect(await api.getReport(-1)).toEqual({ ok: true, value: null });
    expect(await api.getCase("not-a-uuid")).toEqual({ ok: true, value: null });
    expect(calls.map((c) => c.fn)).toEqual(["admin_get_report", "admin_get_case"]);
  });

  it("server refusals map to codes (no raw text); an expired session asks the auth layer to re-check", async () => {
    const onUnauthenticated = jest.fn();
    const forbidden = fakeClient({}, { code: "P0001", message: "FORBIDDEN: The operations console is for active supervisors and administrators." });
    const r1 = await createAdminOperations(forbidden.client, fakeStorage([]).storage, { timeZone: () => "UTC", onUnauthenticated }).overview();
    expect(r1).toEqual({ ok: false, error: { code: "FORBIDDEN", message: "FORBIDDEN" } });
    const expired = fakeClient({}, { code: "PGRST301", message: "JWT expired" });
    const r2 = await createAdminOperations(expired.client, fakeStorage([]).storage, { timeZone: () => "UTC", onUnauthenticated }).pageReports({}, 0);
    expect(r2).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("reward summary is taken from the server's one-per-report counts", async () => {
    const { client } = fakeClient({
      admin_page_rewards: { total: 0, next_offset: null, rows: [], summary: { pending_count: 2, available_count: 1, voided_count: 1, pending_cents: 1000, available_cents: 500 } },
    });
    const r = await createAdminOperations(client, fakeStorage([]).storage, { timeZone: () => "UTC" }).pageRewards({}, 0);
    expect(r).toMatchObject({ ok: true, value: { summary: { pendingCount: 2, availableCount: 1, voidedCount: 1, pendingCents: 1000, availableCents: 500 } } });
  });
});
