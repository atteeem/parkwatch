// DEVELOPMENT/TEST ONLY: an in-process Postgres (PGlite) with a minimal
// stand-in for Supabase's auth/storage schemas and roles, with every
// migration in supabase/migrations applied. Shared by the mock backend.
// This is NOT Supabase: it reproduces the database behaviour (RLS, grants,
// server functions), not Supabase's services.

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SUPABASE_STUB_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text not null, owner uuid, created_at timestamptz default now(), metadata jsonb, unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

export async function createStubDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB_SQL);
  const dir = join(root, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  await db.exec(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;`);

  // PGlite has one connection: run each unit of work exclusively.
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };

  /** Run `fn` as an authenticated user (RLS applies), or as anon when userId is null. */
  const asUser = (userId, fn) =>
    exclusive(async () => {
      if (userId) await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
      await db.exec(userId ? "set role authenticated" : "set role anon");
      try {
        return await fn(db);
      } finally {
        await db.exec("reset role");
        await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      }
    });

  /** Server/admin side (bypasses RLS): seeding and mock admin endpoints only. */
  const asAdmin = (fn) => exclusive(() => fn(db));

  return { db, asUser, asAdmin };
}
