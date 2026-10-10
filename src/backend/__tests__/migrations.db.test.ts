// Applies supabase/migrations to a real Postgres (PGlite, in-process, offline)
// and runs constraint + Row Level Security scenarios as different users.
// The scenarios live in scripts/verify-migrations.mjs (ESM, run with node).
import { execFileSync } from "child_process";
import * as path from "path";

type Check = { name: string; ok: boolean; detail?: string };

const ROOT = path.resolve(__dirname, "../../..");
let report: { ok: boolean; total: number; failed: number; results: Check[] };

beforeAll(() => {
  let out: string;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "verify-migrations.mjs")], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? "";
  }
  report = JSON.parse(out.slice(out.indexOf("{")));
}, 150_000);

describe("migrations on a real Postgres", () => {
  it("apply cleanly and every scenario passes", () => {
    expect(report.results.filter((r) => !r.ok)).toEqual([]);
    expect(report.total).toBeGreaterThan(60);
  });

  it.each([
    "citizen cannot make themselves an officer",
    "a user whose profile merely SAYS officer sees no cases",
    "an authorized officer (active member) sees the case",
    "a deactivated officer loses access immediately",
    "another citizen cannot see the report",
    "citizen cannot fake the trusted received_at time",
    "a library image cannot fill a required angle",
    "officer evidence cannot come from the photo library",
    "replaying the same operation never credits twice",
    "the same withdrawal cannot be debited twice",
    "the ledger is append-only (no updates)",
    "audit events are append-only",
    "clients cannot read audit events",
    "officers cannot change cases directly (server functions only)",
    "no policy is unconditionally true",
    // T9.0 operations console
    "T9.0: a citizen is refused by every console function",
    "T9.0: an officer is refused by every console function",
    "T9.0: an inactive supervisor is refused by every console function",
    "T9.0: an ADMIN profile without membership (no global admin) is refused by every console function",
    "T9.0: anonymous users cannot execute any console function",
    "T9.0: an active supervisor sees their own organization",
    "T9.0: Supervisor A's report list = exactly organization A's reports (B never appears)",
    "T9.0: Supervisor A cannot open organization B's report or case (looks missing)",
    "T9.0: officer lists never include another organization's members; inactive members are marked",
    "T9.0: the audit log is organization-scoped",
    "T9.0: a supervisor cannot read another organization's evidence objects",
    "T9.0: reward summary counts one reward per report (pending + release is not double-counted)",
    "T9.0: console functions are read-only (no row changes)",
    "T9.0: existing RLS is unchanged: supervisors still cannot read ledger/audit tables directly",
    // T8.7
    "T8.7: a GPS point is stored with its accuracy, time and source GPS",
    "T8.7: a point picked on the map is stored as MAP_SELECTED without accuracy/time",
    "T8.7: data minimization - no column or submit_report parameter stores the raw reporter GPS",
    "T8.7: submit_report rejects a raw device fix argument",
    "T8.7: a map-picked point cannot carry GPS accuracy/time (it would pose as a GPS fix)",
    "T8.7: renaming VEHICLE_OVERVIEW/VIOLATION_CONTEXT keeps existing officer photos (old rows read back as FRONT/REAR)",
    "T8.7: monthly stats = exactly the outcomes this officer decided (server-side)",
    "T8.7: another officer's statistics never include the first officer's decisions",
    "T8.7: a citizen gets no officer statistics",
    "T8.7: the profile-avatars bucket exists and is private",
    "T8.7: a user cannot upload into someone else's avatar folder",
    "T8.7: another user cannot read someone's avatar object",
    "T8.7: the avatar path column is not directly writable by clients",
    "T8.7: set_my_avatar refuses another user's folder",
  ])("%s", (name) => {
    const r = report.results.find((x) => x.name === name);
    expect(r).toBeDefined();
    expect(r).toMatchObject({ ok: true });
  });
});
