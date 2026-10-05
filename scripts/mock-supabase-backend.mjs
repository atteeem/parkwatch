// DEVELOPMENT/TEST TOOL ONLY - a local stand-in for the Supabase endpoints the
// app uses, backed by a real Postgres (PGlite) running the REAL migrations:
//   * Auth: password sign-in/up, refresh, user, logout (unsigned mock tokens)
//   * REST: profiles + organization_members reads, and /rest/v1/rpc/<function>
//     executed AS the signed-in user (role authenticated, auth.uid() set), so
//     Row Level Security and the server functions decide everything
//   * Storage: upload / remove / signed URLs for the private buckets, with the
//     storage.objects RLS policies from the migration. No public URLs.
// It is NOT Supabase and NOT a security boundary: tokens are unsigned and
// everything is in memory. Passing against it does not verify a real project.
//
//   node scripts/mock-supabase-backend.mjs     (port 54399; MOCK_PORT to change)
//   MOCK_AUTOCONFIRM=1 ...                     (sign-up signs in immediately)
//
// Then run the app with:
//   EXPO_PUBLIC_SUPABASE_URL=http://localhost:54399 EXPO_PUBLIC_SUPABASE_ANON_KEY=mock-anon npx expo start --web
//
// Test accounts (password "mock-password-1"): citizen@example.test,
// citizen2@example.test, officer@example.test and officer2@example.test (active
// members), inactive-officer@example.test, metadata-officer@example.test.
// POST /__mock/membership {"email":..., "active": false} flips a membership.

import http from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { createStubDatabase } from "./lib/stubSupabaseDb.mjs";

const PORT = Number(process.env.MOCK_PORT ?? 54399);
const AUTOCONFIRM = process.env.MOCK_AUTOCONFIRM === "1";
const PASSWORD = "mock-password-1";

const { asUser, asAdmin } = await createStubDatabase();

// --- seed (admin side) ------------------------------------------------------
const users = new Map(); // email -> { id, email, password, confirmed, user_metadata }
const tokens = new Map(); // token -> user id
const objects = new Map(); // "bucket/name" -> { bytes, contentType }
const signedTokens = new Map(); // token -> { key, exp }

const orgId = await asAdmin(async (db) => {
  const org = (await db.query(`insert into public.organizations (name) values ('Helsinki Enforcement (mock)') returning id`)).rows[0].id;
  await db.query(`insert into public.jurisdictions (id, organization_id, name) values ('helsinki-demo', $1, 'Helsinki (demo)')`, [org]);
  await db.exec(`update public.app_settings set default_jurisdiction_id = 'helsinki-demo'`);
  return org;
});

async function addUser(email, displayName, opts = {}) {
  const id = randomUUID();
  const metadata = opts.metadata ?? { display_name: displayName };
  users.set(email, { id, email, password: opts.password ?? PASSWORD, confirmed: opts.confirmed ?? true, user_metadata: metadata });
  await asAdmin(async (db) => {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [id, email, JSON.stringify(metadata)]);
    if (opts.role) await db.query(`update public.profiles set role = $2 where id = $1`, [id, opts.role]);
    if (opts.membership) {
      await db.query(`insert into public.organization_members (organization_id, user_id, member_role, active) values ($1, $2, 'OFFICER', $3)`, [
        orgId,
        id,
        opts.membership === "active",
      ]);
    }
  });
  return id;
}
await addUser("citizen@example.test", "Mia Citizen");
await addUser("citizen2@example.test", "Cai Citizen");
await addUser("officer@example.test", "Olli Officer", { role: "OFFICER", membership: "active" });
await addUser("officer2@example.test", "Oona Officer", { role: "OFFICER", membership: "active" });
await addUser("inactive-officer@example.test", "Ina Inactive", { role: "OFFICER", membership: "inactive" });
await addUser("metadata-officer@example.test", "Meta Data", { metadata: { display_name: "Meta Data", role: "OFFICER" } });

// --- helpers -----------------------------------------------------------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const publicUser = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, user_metadata: u.user_metadata, app_metadata: {}, identities: [{}], created_at: new Date().toISOString() });
function session(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: user.id, role: "authenticated", exp, email: user.email })}.mock`;
  const refresh = randomUUID();
  tokens.set(access, user.id);
  tokens.set(refresh, user.id);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: publicUser(user) };
}
const userFromAuth = (req) => {
  const id = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  return id ? [...users.values()].find((u) => u.id === id) : undefined;
};

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" };
function send(res, status, body, extra = {}) {
  res.writeHead(status, { "content-type": "application/json", ...CORS, ...extra });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const authErr = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg, message: msg });
const wantsObject = (req) => (req.headers.accept ?? "").includes("vnd.pgrst.object");
const readRaw = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
const json = (buf) => {
  try {
    return buf.length ? JSON.parse(buf.toString("utf8")) : {};
  } catch {
    return {};
  }
};
/** Postgres error -> PostgREST-style response (no stack, no internals beyond the message). */
function pgError(res, e, signedIn) {
  const code = e?.code ?? "";
  const status = code === "42501" ? (signedIn ? 403 : 401) : code === "42883" ? 404 : 400;
  return send(res, status, { code: code === "42883" ? "PGRST202" : code, message: String(e?.message ?? "error"), details: null, hint: null });
}
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const argValue = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
const storageErr = (res, status, error, message) => send(res, status, { statusCode: String(status), error, message });

// --- server --------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = decodeURIComponent(url.pathname);
    const raw = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : await readRaw(req);

    // ---- Auth
    if (p === "/auth/v1/token") {
      const body = json(raw);
      if (url.searchParams.get("grant_type") === "password") {
        const u = users.get(String(body.email ?? "").toLowerCase());
        if (!u || u.password !== body.password) return authErr(res, 400, "invalid_credentials", "Invalid login credentials");
        if (!u.confirmed) return authErr(res, 400, "email_not_confirmed", "Email not confirmed");
        return send(res, 200, session(u));
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const id = tokens.get(body.refresh_token);
        const u = id && [...users.values()].find((x) => x.id === id);
        return u ? send(res, 200, session(u)) : authErr(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      }
    }
    if (p === "/auth/v1/signup") {
      const body = json(raw);
      const email = String(body.email ?? "").toLowerCase();
      if (String(body.password ?? "").length < 8) return authErr(res, 422, "weak_password", "Password should be at least 8 characters.");
      if (users.has(email)) return AUTOCONFIRM ? authErr(res, 422, "user_already_exists", "User already registered") : send(res, 200, { ...publicUser(users.get(email)), identities: [] });
      // Same as the real trigger: the profile is always CITIZEN; a role in metadata is ignored.
      await addUser(email, String(body.data?.display_name ?? ""), { metadata: body.data ?? {}, password: body.password, confirmed: AUTOCONFIRM });
      const u = users.get(email);
      return send(res, 200, AUTOCONFIRM ? session(u) : publicUser(u));
    }
    if (p === "/auth/v1/logout") {
      tokens.delete((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      return send(res, 204);
    }
    if (p === "/auth/v1/user") {
      const u = userFromAuth(req);
      return u ? send(res, 200, publicUser(u)) : authErr(res, 401, "bad_jwt", "invalid JWT");
    }

    // ---- Mock admin (test tooling only)
    if (p === "/__mock/health") return send(res, 200, { ok: true });
    if (p === "/__mock/membership") {
      const body = json(raw);
      const u = users.get(String(body.email ?? "").toLowerCase());
      if (!u) return send(res, 404, { error: "no such user" });
      await asAdmin((db) => db.query(`update public.organization_members set active = $2 where user_id = $1`, [u.id, body.active === true]));
      return send(res, 200, { ok: true });
    }
    if (p === "/__mock/confirm") {
      const u = users.get(String(json(raw).email ?? "").toLowerCase());
      if (u) u.confirmed = true;
      return send(res, u ? 200 : 404, { ok: !!u });
    }

    // ---- Storage: signed download (the token is the authorization)
    const signedGet = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(p);
    if (req.method === "GET" && signedGet) {
      const t = signedTokens.get(url.searchParams.get("token") ?? "");
      const key = `${signedGet[1]}/${signedGet[2]}`;
      if (!t || t.key !== key || t.exp < Date.now()) return storageErr(res, 400, "InvalidSignature", "Invalid or expired signature");
      const obj = objects.get(key);
      if (!obj) return storageErr(res, 404, "not_found", "Object not found");
      res.writeHead(200, { "content-type": obj.contentType, ...CORS });
      return res.end(obj.bytes);
    }
    if (/^\/storage\/v1\/object\/public\//.test(p)) return storageErr(res, 400, "InvalidRequest", "Bucket is not public");

    // Everything below needs a signed-in user.
    const me = userFromAuth(req);
    if ((p.startsWith("/rest/v1/") || p.startsWith("/storage/v1/")) && !me) {
      return p.startsWith("/storage/") ? storageErr(res, 401, "Unauthorized", "Invalid JWT") : send(res, 401, { code: "PGRST301", message: "JWT expired" });
    }

    // ---- REST reads used by role resolution (as the user: RLS applies)
    if (p === "/rest/v1/profiles" && req.method === "GET") {
      const rows = (await asUser(me.id, (db) => db.query(`select id, role, display_name from public.profiles where id = $1`, [me.id]))).rows;
      return send(res, 200, wantsObject(req) ? rows[0] ?? null : rows);
    }
    if (p === "/rest/v1/organization_members" && req.method === "GET") {
      const rows = (
        await asUser(me.id, (db) =>
          db.query(
            `select m.organization_id, m.member_role, m.active, case when o.id is null then null else jsonb_build_object('name', o.name) end as organizations
             from public.organization_members m left join public.organizations o on o.id = m.organization_id where m.user_id = $1`,
            [me.id]
          )
        )
      ).rows;
      return send(res, 200, rows);
    }

    // ---- RPC passthrough: the server function runs as the user
    const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(p);
    if (rpc && req.method === "POST") {
      const fn = rpc[1];
      const args = json(raw);
      const names = Object.keys(args);
      if (!names.every((n) => IDENT.test(n))) return send(res, 400, { code: "PGRST100", message: "bad argument name" });
      const sql = `select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
      try {
        const r = await asUser(me.id, (db) => db.query(sql, names.map((n) => argValue(args[n]))));
        const cols = r.fields.map((f) => f.name);
        if (cols.length === 1 && cols[0] === fn) return send(res, 200, r.rows[0]?.[fn] ?? null); // scalar function
        return send(res, 200, wantsObject(req) ? r.rows[0] ?? null : r.rows);
      } catch (e) {
        return pgError(res, e, true);
      }
    }

    // ---- Storage (as the user: storage.objects RLS applies)
    const sign = /^\/storage\/v1\/object\/sign\/([^/]+)(?:\/(.+))?$/.exec(p);
    if (sign && req.method === "POST") {
      const bucket = sign[1];
      const body = json(raw);
      const paths = sign[2] ? [sign[2]] : Array.isArray(body.paths) ? body.paths.map(String) : [];
      const expiresIn = Math.max(1, Math.min(Number(body.expiresIn ?? 60), 7 * 24 * 3600));
      const visible = new Set(
        (await asUser(me.id, (db) => db.query(`select name from storage.objects where bucket_id = $1 and name = any($2::text[])`, [bucket, paths]))).rows.map((r) => r.name)
      );
      const out = paths.map((path) => {
        if (!visible.has(path)) return { error: "Either the object does not exist or you do not have access to it", path, signedURL: null };
        const token = randomBytes(18).toString("base64url");
        signedTokens.set(token, { key: `${bucket}/${path}`, exp: Date.now() + expiresIn * 1000 });
        return { error: null, path, signedURL: `/object/sign/${bucket}/${path}?token=${token}` };
      });
      if (sign[2]) return out[0].signedURL ? send(res, 200, { signedURL: out[0].signedURL }) : storageErr(res, 400, "not_found", out[0].error);
      return send(res, 200, out);
    }
    const objectPath = /^\/storage\/v1\/object\/([^/]+)(?:\/(.+))?$/.exec(p);
    if (objectPath && req.method === "DELETE") {
      const bucket = objectPath[1];
      const prefixes = Array.isArray(json(raw).prefixes) ? json(raw).prefixes.map(String) : [];
      const deleted = (
        await asUser(me.id, (db) => db.query(`delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`, [bucket, prefixes]))
      ).rows;
      for (const d of deleted) objects.delete(`${bucket}/${d.name}`);
      return send(res, 200, deleted.map((d) => ({ name: d.name, bucket_id: bucket })));
    }
    if (objectPath && objectPath[2] && (req.method === "POST" || req.method === "PUT")) {
      const [, bucket, name] = objectPath;
      const contentType = String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0];
      const b = (await asAdmin((db) => db.query(`select allowed_mime_types, file_size_limit from storage.buckets where id = $1`, [bucket]))).rows[0];
      if (!b) return storageErr(res, 404, "Bucket not found", "Bucket not found");
      if (b.allowed_mime_types && !b.allowed_mime_types.includes(contentType)) return storageErr(res, 415, "invalid_mime_type", `mime type ${contentType} is not supported`);
      if (b.file_size_limit && raw.length > Number(b.file_size_limit)) return storageErr(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
      try {
        await asUser(me.id, (db) => db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)`, [bucket, name, me.id, JSON.stringify({ mimetype: contentType, size: raw.length })]));
      } catch (e) {
        if (e?.code === "23505") return storageErr(res, 409, "Duplicate", "The resource already exists");
        if (e?.code === "42501") return storageErr(res, 403, "Unauthorized", "new row violates row-level security policy");
        return storageErr(res, 400, "InvalidRequest", "Upload failed");
      }
      objects.set(`${bucket}/${name}`, { bytes: raw, contentType });
      return send(res, 200, { Key: `${bucket}/${name}`, Id: randomUUID() });
    }

    return send(res, 404, { message: "not mocked" });
  } catch (e) {
    return send(res, 500, { message: "mock server error" });
  }
});

server.listen(PORT, () => console.log(`[mock-supabase-backend] listening on http://localhost:${PORT} (autoconfirm=${AUTOCONFIRM})`));
