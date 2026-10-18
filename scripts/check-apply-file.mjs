// Checks a generated scripts/sql/tNN-apply-dev.sql file on PGlite: applies
// every migration BEFORE the given version, then the apply file (which must
// add the migration and its schema_migrations row in one transaction).
//
//   node scripts/check-apply-file.mjs 20261018000001 scripts/sql/t94-apply-dev.sql

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_STUB_SQL } from "./lib/stubSupabaseDb.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [version, applyFile] = process.argv.slice(2);
if (!/^\d{14}$/.test(version ?? "") || !applyFile) {
  console.log("usage: node scripts/check-apply-file.mjs <version> <apply-file>");
  process.exit(2);
}
const db = new PGlite();
await db.exec(SUPABASE_STUB_SQL);
const dir = join(root, "supabase", "migrations");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql") && x.slice(0, 14) < version).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
await db.exec(`create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
await db.exec(readFileSync(join(root, applyFile), "utf8"));
const r = await db.query(`select count(*)::int as rows, max(array_length(statements, 1)) as statements from supabase_migrations.schema_migrations where version = $1`, [version]);
console.log(JSON.stringify({ version, history_rows: r.rows[0].rows, statements: r.rows[0].statements }));
process.exit(r.rows[0].rows === 1 ? 0 : 1);
