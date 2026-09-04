#!/usr/bin/env node
/**
 * Migration safety guard.
 *
 * PostgreSQL objects that the Prisma schema language cannot express — the
 * pgvector HNSW indexes, the generated `search_vector` columns, the trigram
 * indexes — are created by hand-written migrations. Prisma has no way to know
 * they are intentional, so on the next `prisma migrate dev` it sees them as
 * drift and helpfully proposes to drop them.
 *
 * If such a migration were ever applied, semantic search would silently
 * degrade to a sequential scan and full-text search would stop working
 * altogether. Nothing would fail loudly; the product would just get slow and
 * wrong. This script is what makes that failure loud instead.
 *
 * It scans every migration for statements that would destroy a protected
 * object and exits non-zero if it finds one.
 *
 *   node scripts/check-migration-safety.mjs
 *
 * Run automatically by `pnpm db:migrate` and in CI.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'prisma', 'migrations');

/**
 * The migration that legitimately creates these objects. Its own DROP
 * statements (`DROP COLUMN IF EXISTS "search_vector"`, which removes the plain
 * column Prisma generated before replacing it with a generated one) are
 * expected and must not trip the guard.
 */
const CREATING_MIGRATION_SUFFIX = '_search_and_vector_indexes';

/** Objects whose loss would silently break search. */
const PROTECTED_PATTERNS = [
  {
    name: 'pgvector HNSW index',
    pattern: /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?[\w]*_embedding_hnsw"?/gi,
  },
  {
    name: 'full-text GIN index',
    pattern: /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?[\w]*_search_vector_gin"?/gi,
  },
  {
    name: 'trigram index',
    pattern: /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?[\w]*_trgm"?/gi,
  },
  {
    name: 'generated search_vector column',
    pattern: /ALTER\s+TABLE\s+"?\w+"?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?search_vector"?/gi,
  },
];

/** Statements that are dangerous in any migration, protected object or not. */
const DESTRUCTIVE_PATTERNS = [
  { name: 'DROP DATABASE', pattern: /DROP\s+DATABASE/gi },
  { name: 'DROP SCHEMA', pattern: /DROP\s+SCHEMA/gi },
  { name: 'TRUNCATE', pattern: /\bTRUNCATE\b/gi },
];

function listMigrations() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return entries
    .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort()
    .map((entry) => ({ name: entry, path: join(MIGRATIONS_DIR, entry, 'migration.sql') }));
}

/** Removes `--` and block comments so a commented-out DROP is not reported. */
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function main() {
  const problems = [];

  for (const migration of listMigrations()) {
    let sql;
    try {
      sql = readFileSync(migration.path, 'utf8');
    } catch {
      continue; // A --create-only migration that has not been written yet.
    }

    const body = stripSqlComments(sql);
    const isCreatingMigration = migration.name.endsWith(CREATING_MIGRATION_SUFFIX);

    if (!isCreatingMigration) {
      for (const { name, pattern } of PROTECTED_PATTERNS) {
        const matches = body.match(pattern);
        if (matches) {
          problems.push(
            `${migration.name}: would drop a ${name} (${[...new Set(matches)].join(', ')})`,
          );
        }
      }
    }

    for (const { name, pattern } of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(body)) {
        problems.push(`${migration.name}: contains ${name}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error('\nMigration safety check FAILED:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      [
        '',
        'Prisma cannot represent the pgvector HNSW indexes, the generated',
        'search_vector columns or the trigram indexes, so `prisma migrate dev`',
        'proposes to drop them every time it diffs the schema. That is expected',
        'and must never be accepted.',
        '',
        'Fix: open the migration above, delete the offending statements, and',
        're-run. Always create migrations with `pnpm db:migrate:create` so they',
        'can be reviewed before they are applied.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log('Migration safety check passed: no protected search object is dropped.');
}

main();
