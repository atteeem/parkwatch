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
  ])("%s", (name) => {
    const r = report.results.find((x) => x.name === name);
    expect(r).toBeDefined();
    expect(r).toMatchObject({ ok: true });
  });
});
