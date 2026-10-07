// T8.3 source-level security guards (offline): the server owns the core
// workflow, evidence stays private, and the app never sends trusted values.
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
function listFiles(dir: string, re: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ["node_modules", ".git", "__tests__", "__cloudqa__", ".expo", "dist"].includes(e.name) ? [] : listFiles(p, re);
    return re.test(e.name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
const read = (p: string) => fs.readFileSync(p, "utf8");
const appSource = [...listFiles(path.join(ROOT, "app"), /\.tsx?$/), ...listFiles(path.join(ROOT, "src"), /\.tsx?$/)];
const sql = read(path.join(ROOT, "supabase/migrations/20261007000001_core_workflow.sql"));
const ops = read(path.join(ROOT, "src/backend/operations/coreOperations.ts"));

describe("private evidence", () => {
  it("no public URLs anywhere in the app", () => {
    expect(appSource.filter((f) => /getPublicUrl|\/object\/public\//.test(read(f))).map(rel)).toEqual([]);
  });

  it("both evidence buckets are created private", () => {
    expect(sql).toMatch(/\('report-evidence', 'report-evidence', false/);
    expect(sql).toMatch(/\('officer-evidence', 'officer-evidence', false/);
    expect(sql).not.toMatch(/public\s*=\s*true/i);
  });

  it("storage is only touched by src/backend/storage", () => {
    const hits = appSource.filter((f) => /\.storage\s*\.\s*from\(/.test(read(f)) && !rel(f).startsWith("src/backend/storage/")).map(rel);
    expect(hits).toEqual([]);
  });

  it("uploads never overwrite (upsert: false)", () => {
    const s = read(path.join(ROOT, "src/backend/storage/evidenceStorage.ts"));
    expect(s).toMatch(/upsert:\s*false/);
    expect(s).not.toMatch(/upsert:\s*true/);
  });
});

describe("the server owns the core workflow", () => {
  it("the app has no direct table writes (insert/update/upsert/delete)", () => {
    const hits = appSource
      .filter((f) => /\.from\(["'`][a-z_]+["'`]\)\s*\.\s*(insert|update|upsert|delete)\(/.test(read(f).replace(/\n\s*/g, "")))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("mutating RPC wrappers never send trusted values", () => {
    // Mutations: from submitReport up to the read section (reads only filter/page; they change nothing).
    const mutations = ops.slice(ops.indexOf("async submitReport("), ops.indexOf("getCitizenSummary: ("));
    const params = [...mutations.matchAll(/\b(p_[a-z_]+)\s*:/g)].map((m) => m[1]);
    expect(params.length).toBeGreaterThan(10);
    for (const forbidden of ["p_citizen_id", "p_status", "p_report_status", "p_case_status", "p_public_report_number", "p_received_at", "p_reward_amount_cents", "p_amount_cents", "p_parking_charge_amount_cents", "p_officer_id", "p_assigned_officer_id", "p_jurisdiction_id", "p_priority"]) {
      expect(params).not.toContain(forbidden);
    }
  });

  it("read wrappers only send filters, cursors and page sizes", () => {
    const reads = ops.slice(ops.indexOf("getCitizenSummary: ("));
    const params = new Set([...reads.matchAll(/\b(p_[a-z_]+)\s*:/g)].map((m) => m[1]));
    // T8.7 monthly statistics: a period (p_from, p_to) and the officer's time zone for day buckets. No officer id: the server uses auth.uid().
    const allowed = ["p_since", "p_status", "p_before_ts", "p_before_id", "p_limit", "p_filter", "p_lat", "p_lng", "p_offset", "p_tab", "p_case_id", "p_public_number", "p_from", "p_to", "p_time_zone"];
    expect([...params].filter((p) => !allowed.includes(p))).toEqual([]);
    expect(params.size).toBeGreaterThan(8);
  });

  it("the server functions take no trusted values either", () => {
    const signature = (fn: string) => new RegExp(`create function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*(returns|$)`).exec(sql)?.[1] ?? "";
    expect(signature("submit_report")).not.toMatch(/citizen_id|p_status|report_number|received_at|reward|amount|priority|jurisdiction/);
    expect(signature("complete_case")).not.toMatch(/amount|officer/);
    expect(signature("accept_case")).not.toMatch(/officer/);
  });

  it("direct client inserts into reports/evidence are revoked", () => {
    expect(sql).toMatch(/revoke insert on public\.reports, public\.report_evidence from authenticated/);
    expect(sql).toMatch(/drop policy if exists reports_insert_own|drop policy reports_insert_own/);
  });

  it("every SECURITY DEFINER function pins search_path", () => {
    const defs = sql.match(/create function[\s\S]*?\$\$;/g) ?? [];
    const bad = defs.filter((d) => /security definer/.test(d) && !/set search_path = ''/.test(d)).map((d) => d.slice(0, 60));
    expect(bad).toEqual([]);
  });

  it("no unconditional policies", () => {
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/with check\s*\(\s*true\s*\)/i);
  });
});

describe("backend mode behaviour", () => {
  const ctx = read(path.join(ROOT, "src/context/AppContext.tsx"));

  it("withdrawals are disabled in BACKEND mode with the agreed copy", () => {
    expect(ctx).toMatch(/WITHDRAWALS_UNAVAILABLE_COPY = "Withdrawals are not available in the backend preview yet\."/);
    const backend = ctx.slice(ctx.indexOf("function BackendAppProvider"));
    expect(backend).toMatch(/capabilities: \{ withdrawals: false, demoTools: false \}/);
    expect(backend).toMatch(/withdraw: noWithdrawals/);
  });

  it("the BACKEND provider never falls back to demo accounts or seed data", () => {
    const backend = ctx.slice(ctx.indexOf("function BackendAppProvider"), ctx.indexOf("export function AppProvider"));
    expect(backend).not.toMatch(/DEV_CITIZEN_ID|DEV_OFFICER_ID|buildSeedState|getReporterDisplayProfile\(/);
  });

  it("screens never import the backend layer", () => {
    const hits = listFiles(path.join(ROOT, "app"), /\.tsx?$/).filter((f) => /src\/backend|@supabase\//.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("no tokens, passwords or signed URLs are logged", () => {
    const hits = appSource.filter((f) => /console\.(log|warn|error|info)\([^)]*(token|password|signedUrl|access_token|authorization)/i.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
});

describe("test-only code stays out of the app (T8.5)", () => {
  it("nothing in app/ or src/ imports the real-cloud QA suite or test helpers", () => {
    const hits = appSource.filter((f) => /from ["'][^"']*(__cloudqa__|__tests__)/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the real-cloud QA suite is not matched by the default Jest run", () => {
    const pkg = JSON.parse(read(path.join(ROOT, "package.json")));
    const patterns: string[] = pkg.jest.testMatch;
    expect(patterns.some((p) => p.includes("cloudqa"))).toBe(false);
    expect(pkg.scripts["test:cloud-qa"]).toMatch(/__cloudqa__/);
  });
});
