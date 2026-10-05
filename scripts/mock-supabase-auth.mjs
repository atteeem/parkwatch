// DEVELOPMENT/TEST TOOL ONLY - a tiny local stand-in for the Supabase Auth and
// REST endpoints the app uses for sign-in and role resolution, so backend mode
// can be exercised in a browser without a cloud project. It is NOT Supabase:
// no real security, tokens are unsigned, data is in memory.
//
//   node scripts/mock-supabase-auth.mjs            (port 54399, email confirmation ON)
//   MOCK_AUTOCONFIRM=1 node scripts/mock-supabase-auth.mjs
//
// Then run the app with:
//   EXPO_PUBLIC_SUPABASE_URL=http://localhost:54399 EXPO_PUBLIC_SUPABASE_ANON_KEY=mock-anon npx expo start --web
//
// Test accounts (password "mock-password-1"): citizen@example.test,
// officer@example.test (active member), inactive-officer@example.test,
// metadata-officer@example.test (CITIZEN profile, user_metadata.role = OFFICER).
// POST /__mock/membership {"email":..., "active": false} flips a membership.

import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 54399);
const AUTOCONFIRM = process.env.MOCK_AUTOCONFIRM === "1";
const PASSWORD = "mock-password-1";
const ORG = { id: "0a7c0000-0000-4000-8000-000000000001", name: "Helsinki Enforcement (mock)" };

const users = new Map(); // email -> user
const profiles = new Map(); // id -> profile
const memberships = new Map(); // user id -> membership[]
const tokens = new Map(); // access/refresh token -> user id

function addUser(email, role, displayName, opts = {}) {
  const id = randomUUID();
  users.set(email, { id, email, password: PASSWORD, confirmed: true, user_metadata: opts.metadata ?? { display_name: displayName } });
  profiles.set(id, { id, role, display_name: displayName });
  if (opts.membership) memberships.set(id, [{ organization_id: ORG.id, member_role: "OFFICER", active: opts.membership === "active" }]);
}
addUser("citizen@example.test", "CITIZEN", "Mia Citizen");
addUser("officer@example.test", "OFFICER", "Olli Officer", { membership: "active" });
addUser("inactive-officer@example.test", "OFFICER", "Ina Inactive", { membership: "inactive" });
addUser("metadata-officer@example.test", "CITIZEN", "Meta Data", { metadata: { display_name: "Meta Data", role: "OFFICER" } });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function session(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: user.id, role: "authenticated", exp, email: user.email })}.mock`;
  const refresh = randomUUID();
  tokens.set(access, user.id);
  tokens.set(refresh, user.id);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: publicUser(user) };
}
const publicUser = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, user_metadata: u.user_metadata, app_metadata: {}, identities: [{}], created_at: new Date().toISOString() });
const userFromAuth = (req) => {
  const t = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const id = tokens.get(t);
  return id ? [...users.values()].find((u) => u.id === id) : undefined;
};

function send(res, status, body, extra = {}) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", ...extra });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const authErr = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg, message: msg });
const wantsObject = (req) => (req.headers.accept ?? "").includes("vnd.pgrst.object");

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = {};
  if (req.method === "POST" || req.method === "PATCH") {
    const raw = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  }
  const p = url.pathname;

  if (p === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const u = users.get(String(body.email ?? "").toLowerCase());
    if (!u || u.password !== body.password) return authErr(res, 400, "invalid_credentials", "Invalid login credentials");
    if (!u.confirmed) return authErr(res, 400, "email_not_confirmed", "Email not confirmed");
    return send(res, 200, session(u));
  }
  if (p === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const id = tokens.get(body.refresh_token);
    const u = id && [...users.values()].find((x) => x.id === id);
    return u ? send(res, 200, session(u)) : authErr(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
  }
  if (p === "/auth/v1/signup") {
    const email = String(body.email ?? "").toLowerCase();
    if (String(body.password ?? "").length < 8) return authErr(res, 422, "weak_password", "Password should be at least 8 characters.");
    if (users.has(email)) return AUTOCONFIRM ? authErr(res, 422, "user_already_exists", "User already registered") : send(res, 200, { ...publicUser(users.get(email)), identities: [] });
    const id = randomUUID();
    const metadata = body.data ?? {};
    const u = { id, email, password: body.password, confirmed: AUTOCONFIRM, user_metadata: metadata };
    users.set(email, u);
    // Same rule as the database trigger: always CITIZEN; any role in metadata is ignored.
    profiles.set(id, { id, role: "CITIZEN", display_name: String(metadata.display_name ?? "").trim().slice(0, 80) });
    return send(res, 200, AUTOCONFIRM ? session(u) : publicUser(u));
  }
  if (p === "/auth/v1/logout") {
    const t = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    tokens.delete(t);
    return send(res, 204);
  }
  if (p === "/auth/v1/user") {
    const u = userFromAuth(req);
    return u ? send(res, 200, publicUser(u)) : authErr(res, 401, "bad_jwt", "invalid JWT");
  }

  // REST (RLS-like: only the caller's own rows)
  const me = userFromAuth(req);
  if (p.startsWith("/rest/v1/") && !me) return send(res, 401, { code: "PGRST301", message: "JWT expired" });
  if (p === "/rest/v1/profiles") {
    const rows = [profiles.get(me.id)].filter(Boolean);
    return send(res, 200, wantsObject(req) ? rows[0] ?? null : rows);
  }
  if (p === "/rest/v1/organization_members") {
    const rows = (memberships.get(me.id) ?? []).map((m) => ({ ...m, organizations: { name: ORG.name } }));
    return send(res, 200, rows);
  }
  if (p === "/rest/v1/rpc/ensure_my_profile") {
    if (!profiles.has(me.id)) profiles.set(me.id, { id: me.id, role: "CITIZEN", display_name: "" });
    const row = profiles.get(me.id);
    return send(res, 200, wantsObject(req) ? row : [row]);
  }
  if (p === "/__mock/membership") {
    const u = users.get(String(body.email ?? "").toLowerCase());
    if (!u) return send(res, 404, { error: "no such user" });
    memberships.set(u.id, [{ organization_id: ORG.id, member_role: "OFFICER", active: body.active === true }]);
    return send(res, 200, { ok: true });
  }
  if (p === "/__mock/confirm") {
    const u = users.get(String(body.email ?? "").toLowerCase());
    if (u) u.confirmed = true;
    return send(res, u ? 200 : 404, { ok: !!u });
  }
  return send(res, 404, { message: "not mocked" });
});

server.listen(PORT, () => console.log(`[mock-supabase-auth] listening on http://localhost:${PORT} (autoconfirm=${AUTOCONFIRM})`));
