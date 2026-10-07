// Repositories against a tiny fake supabase client (no network). Checks the
// session requirement, error mapping and row -> domain mapping.
import { backendOk } from "../result";
import { createNotificationRepository, createReportRepository, createRewardRepository } from "../repositories";
import { submittedReport } from "../../domain/__tests__/fixtures";

jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const USER = "11111111-1111-4111-8111-111111111111";
const T = "2026-10-05T10:00:00.000Z";

type Response = { data: unknown; error: unknown; status?: number };

/** Chainable query builder that records calls and resolves to `response`. */
function fakeClient(opts: { session?: boolean; response?: Response }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return builder;
  };
  for (const m of ["select", "insert", "update", "eq", "neq", "in", "is", "order"]) builder[m] = chain(m);
  const done = () => Promise.resolve(opts.response ?? { data: [], error: null });
  builder.single = () => done();
  builder.maybeSingle = () => done();
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => done().then(resolve, reject);
  const client = {
    auth: { getSession: async () => ({ data: { session: opts.session === false ? null : { user: { id: USER } } }, error: null }) },
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  };
  return { provider: () => backendOk(client as never), calls };
}

const reportRow = {
  id: "33333333-3333-4333-8333-333333333333", public_report_number: 100023, citizen_id: USER, source_draft_id: "d1",
  jurisdiction_id: "helsinki-demo", status: "VERIFIED", priority: "NORMAL", violation_type: "no-parking",
  plate_raw: "GHC-789", plate_normalized: "GHC789", plate_country: "FI", vehicle_make: null, vehicle_model: null, vehicle_color: null,
  vehicle_source: "MOCK_DETECTED", location_address: "Street 1", latitude: null, longitude: null, location_accuracy_m: null,
  location_captured_at: null, notes: "", observed_at: T, submitted_at: T, received_at: T, resolved_at: T, incident_id: null,
  created_at: T, updated_at: T,
  report_evidence: [{ id: "e1", report_id: "33333333-3333-4333-8333-333333333333", slot: "FRONT", capture_source: "CAMERA", storage_path: "citizen/r/front.jpg", captured_at: T, created_at: T }],
};

describe("repositories", () => {
  it("require a real signed-in session (never a made-up one)", async () => {
    const { provider, calls } = fakeClient({ session: false });
    expect(await createReportRepository(provider).listMine()).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(calls).toEqual([]); // no query was even attempted
  });

  it("list my reports: scoped to the session user; uuid and public number kept apart", async () => {
    const { provider, calls } = fakeClient({ response: { data: [reportRow], error: null } });
    const r = await createReportRepository(provider).listMine();
    if (!r.ok) throw new Error(r.error.code);
    expect(calls).toContainEqual(["eq", "citizen_id", USER]);
    expect(r.value[0]).toMatchObject({ uuid: reportRow.id, publicNumber: 100023, report: { id: "100023", status: "VERIFIED" } });
    expect(r.value[0].report.evidence).toEqual([expect.objectContaining({ source: "CITIZEN", type: "FRONT" })]);
  });

  it("has no write methods: reports are created only by the submit_report server function", () => {
    const { provider } = fakeClient({ response: { data: null, error: null } });
    const repo = createReportRepository(provider) as unknown as Record<string, unknown>;
    expect(Object.keys(repo).sort()).toEqual(["getByPublicNumber", "listMine"]);
  });

  it("database errors become typed codes with safe messages", async () => {
    const { provider } = fakeClient({ response: { data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "reports"' }, status: 403 } });
    const r = await createReportRepository(provider).listMine();
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    if (!r.ok) expect(r.error.message).not.toMatch(/row-level|reports/);
    const dup = fakeClient({ response: { data: null, error: { code: "23505", message: "duplicate key" }, status: 409 } });
    expect(await createReportRepository(dup.provider).listMine()).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("notifications keep their report link as the citizen-visible number", async () => {
    const row = {
      id: "n1", recipient_id: USER, recipient_role: "CITIZEN", type: "REPORT_VERIFIED", report_id: reportRow.id, case_id: null,
      amount_cents: 500, title: null, body: null, display_hint: null, idempotency_key: "k", created_at: T, read_at: null,
      reports: { public_report_number: 100023 },
    };
    const { provider } = fakeClient({ response: { data: [row], error: null } });
    const r = await createNotificationRepository(provider).listMine();
    expect(r).toMatchObject({ ok: true, value: [{ reportId: "100023", amountCents: 500 }] });
  });

  it("balances: no ledger rows yet means zero, not an error", async () => {
    const { provider } = fakeClient({ response: { data: null, error: null } });
    expect(await createRewardRepository(provider).getMyBalances()).toEqual({ ok: true, value: { pendingCents: 0, availableCents: 0, paidOutCents: 0 } });
  });
});
