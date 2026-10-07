// Source-level guards for the auth foundation.
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
function listFiles(dir: string, re: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ["node_modules", "__tests__", "__cloudqa__"].includes(e.name) ? [] : listFiles(p, re);
    return re.test(e.name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
const read = (p: string) => fs.readFileSync(p, "utf8");
/** Source without comments (docs may mention what the code deliberately does NOT do). */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const screens = listFiles(path.join(ROOT, "app"), /\.tsx?$/);
const source = [...screens, ...listFiles(path.join(ROOT, "src"), /\.tsx?$/)];

describe("auth stays below the screens", () => {
  it("no screen uses Supabase, the auth service or the auth store directly", () => {
    const hits = screens.filter((f) => /@supabase|supabase\.|authService|authStore|src\/backend/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it(".auth.* calls exist only in the auth service (and the repository session helper)", () => {
    const hits = source.filter((f) => /\.auth\.(sign|get|on|start|stop|refresh|update|set)/.test(code(f))).map(rel).sort();
    expect(hits).toEqual(["src/auth/authService.ts", "src/backend/repositories/base.ts"]);
  });
});

describe("no client-chosen roles", () => {
  it("sign-up has no role selector and sends no role", () => {
    const signUp = code(path.join(ROOT, "app/auth/sign-up.tsx"));
    expect(signUp).not.toMatch(/\b(OFFICER|SUPERVISOR|ADMIN)\b|roleSelector|selectRole|setRole|\brole\b/i);
    expect(signUp).toMatch(/signUp\(displayName, email, password\)/);
    const service = read(path.join(ROOT, "src/auth/authService.ts"));
    expect(service).toMatch(/options: \{ data: \{ display_name: displayName\.trim\(\) \} \}/);
  });

  it("user/app metadata is never read for authorization", () => {
    const hits = source.filter((f) => /user_metadata|app_metadata|raw_user_meta_data|raw_app_meta_data/.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("role resolution reads only the profile and memberships", () => {
    const src = code(path.join(ROOT, "src/auth/roleResolution.ts"));
    expect(src).toMatch(/export function resolveAccess\(profile: TrustedProfile \| null, memberships: readonly Membership\[\]\)/);
    expect(src).not.toMatch(/metadata|AsyncStorage|DEV_ROLE|params/);
  });

  it("the dev role switch exists only in LOCAL_DEMO development builds", () => {
    const session = read(path.join(ROOT, "src/context/SessionContext.tsx"));
    expect(session).toMatch(/devSwitchRole: __DEV__ && isDemo \? switchTo : undefined/);
    expect(session).toMatch(/if \(!__DEV__ \|\| !isDemo\) return;/);
    const tools = read(path.join(ROOT, "src/components/DemoTools.tsx"));
    expect(tools).toMatch(/if \(!__DEV__ \|\| !devSwitchRole\) return null;/);
  });
});

describe("no secrets in logs or storage", () => {
  it("no console output of passwords, tokens or sessions", () => {
    const hits = source.filter((f) => /console\.(log|info|warn|error|debug)\([^)]*(password|token|session|authorization)/i.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("no manual token/session storage (supabase-js persists its own session via the storage adapter)", () => {
    // The audit sanitizer's deny-list names these keys in order to DROP them.
    const hits = source
      .filter(
        (f) =>
          /AsyncStorage\.setItem\([^)]*(token|session|auth)/i.test(code(f)) ||
          code(f).split("\n").some((l) => /access_token|refresh_token/.test(l) && !/FORBIDDEN_KEYS/.test(l))
      )
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("password state exists only on the sign-in and sign-up screens", () => {
    const hits = source.filter((f) => /useState[^;\n]*\(\s*""\s*\)/.test(code(f)) && /\[\s*password\b/.test(code(f))).map(rel).sort();
    expect(hits).toEqual(["app/auth/sign-in.tsx", "app/auth/sign-up.tsx"]);
  });
});

describe("migration for auth", () => {
  const sql = read(path.join(ROOT, "supabase/migrations/20261006000001_auth_profiles.sql"));
  it("new accounts are always CITIZEN and metadata never sets a role", () => {
    expect(sql).toMatch(/values \(new\.id, 'CITIZEN', requested_name\)/);
    expect(sql).not.toMatch(/raw_user_meta_data\s*->>\s*'role'/);
  });
  it("ensure_my_profile only creates CITIZEN for the caller and is not callable anonymously", () => {
    expect(sql).toMatch(/values \(me, 'CITIZEN', ''\)/);
    expect(sql).toMatch(/revoke all on function public\.ensure_my_profile\(\) from public, anon/);
  });
  it("officer data access requires membership AND a server-set officer profile role", () => {
    expect(sql).toMatch(/m\.active[\s\S]*p\.role in \('OFFICER', 'SUPERVISOR'\)/);
  });
});
