// Source-level security guards for the backend foundation (offline).
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");

function listFiles(dir: string, re: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ["node_modules", ".git", "__tests__", ".expo", "dist"].includes(e.name) ? [] : listFiles(p, re);
    return re.test(e.name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
const read = (p: string) => fs.readFileSync(p, "utf8");

const appSource = [...listFiles(path.join(ROOT, "app"), /\.tsx?$/), ...listFiles(path.join(ROOT, "src"), /\.tsx?$/)];
const shipped = [...appSource, path.join(ROOT, "app.json"), path.join(ROOT, ".env.example")];
const migrations = listFiles(path.join(ROOT, "supabase", "migrations"), /\.sql$/).sort();
const allSql = migrations.map(read).join("\n");

describe("no secrets in the app", () => {
  it("no service-role key, secret key or hardcoded JWT in shipped source", () => {
    const hits = shipped.flatMap((f) => {
      const s = read(f);
      const found: string[] = [];
      if (/service_role|SUPABASE_SERVICE|SERVICE_ROLE_KEY/i.test(s) && !/src\/backend\/config\.ts$/.test(rel(f))) found.push("service role reference");
      if (/sb_secret_[A-Za-z0-9]/.test(s)) found.push("secret key");
      if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(s)) found.push("JWT");
      return found.map((x) => `${rel(f)}: ${x}`);
    });
    expect(hits).toEqual([]);
  });

  it("the config module only mentions service_role to REFUSE it", () => {
    const s = read(path.join(ROOT, "src/backend/config.ts"));
    expect(s).toMatch(/SERVICE_ROLE_KEY_REJECTED/);
    expect(s).not.toMatch(/process\.env\.[A-Z_]*SERVICE/);
  });

  it("no hardcoded Supabase project URL", () => {
    const hits = shipped.filter((f) => /https:\/\/[a-z0-9]{10,}\.supabase\.(co|in)/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it(".env is git-ignored and .env.example holds placeholders only", () => {
    expect(read(path.join(ROOT, ".gitignore"))).toMatch(/^\.env$/m);
    const example = read(path.join(ROOT, ".env.example"));
    expect(example).toMatch(/^EXPO_PUBLIC_SUPABASE_URL=$/m);
    expect(example).toMatch(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=$/m);
  });
});

describe("Supabase stays behind the backend layer", () => {
  it("no screen imports Supabase or the backend client", () => {
    const hits = listFiles(path.join(ROOT, "app"), /\.tsx?$/).filter((f) => /@supabase\/|src\/backend/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it(".from(...) table queries appear only in src/backend/repositories", () => {
    const hits = appSource
      .filter((f) => !rel(f).startsWith("src/backend/repositories/"))
      .filter((f) => /\bclient\.from\(|supabase\.from\(|\.from\("(reports|officer_cases|notifications|reward_ledger|profiles)/.test(read(f)))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("only the identity layer (src/auth) uses the backend; app data (store/context/presentation/screens) does not", () => {
    const hits = appSource
      .filter((f) => !rel(f).startsWith("src/backend/") && !rel(f).startsWith("src/auth/"))
      .filter((f) => /from "(\.\.\/)+(src\/)?backend|src\/backend/.test(read(f)))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("@supabase/supabase-js is imported only by the client factory and repository base", () => {
    const hits = appSource.filter((f) => /@supabase\/supabase-js/.test(read(f))).map(rel).sort();
    expect(hits).toEqual(["src/backend/repositories/base.ts", "src/backend/supabase.ts"]);
  });
});

describe("migrations", () => {
  const tables = [...allSql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);

  it("are ordered, versioned SQL files", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    for (const f of migrations) expect(path.basename(f)).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("create every required table", () => {
    for (const t of [
      "profiles", "reports", "report_evidence", "officer_cases", "inspections", "inspection_checks", "officer_evidence",
      "enforcement_outcomes", "reward_ledger", "notifications", "audit_events", "organizations", "jurisdictions", "organization_members",
    ]) expect(tables).toContain(t);
  });

  it("enable RLS on every table they create", () => {
    const missing = tables.filter((t) => !new RegExp(`alter table public\\.${t} enable row level security`).test(allSql));
    expect(missing).toEqual([]);
  });

  it("contain no permissive USING (true) / WITH CHECK (true) policy", () => {
    expect(allSql).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(allSql).not.toMatch(/with\s+check\s*\(\s*true\s*\)/i);
  });

  it("officer access is never based on profiles.role", () => {
    const policies = allSql.split(/create policy/i).slice(1).join("\n");
    expect(policies).not.toMatch(/role\s*=\s*'OFFICER'/i);
    expect(allSql).toMatch(/organization_members/);
  });

  it("append-only history is enforced in the database", () => {
    for (const t of ["reward_ledger", "audit_events", "enforcement_outcomes"]) {
      expect(allSql).toMatch(new RegExp(`before update or delete on public\\.${t}`));
    }
  });

  it("the optional dev seed is clearly development-only and not a migration", () => {
    const seed = path.join(ROOT, "supabase", "seed.dev.sql");
    expect(fs.existsSync(seed)).toBe(true);
    expect(read(seed)).toMatch(/DEVELOPMENT ONLY/);
    expect(migrations.map((m) => path.basename(m))).not.toContain("seed.dev.sql");
    expect(allSql).not.toMatch(/citizen-demo|officer-demo/);
  });
});
