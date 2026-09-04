import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 removed `url` from the datasource block, so the CLI learns the
 * connection string here while the runtime client gets a driver adapter (see
 * `src/client.ts`). `env()` throws when the variable is missing, which is the
 * behaviour we want: a migration must never run against a guessed database.
 */

// Prisma 7 no longer auto-loads .env. The repository keeps a single .env at the
// root; dotenv never overwrites variables that are already set, so a container
// or CI environment always wins over the file.
for (const candidate of ['../../.env', '.env']) {
  const path = resolve(import.meta.dirname, candidate);
  if (existsSync(path)) loadDotenv({ path });
}

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    // tsx, not `node --experimental-strip-types`: the seed imports workspace
    // packages through pnpm symlinks, and Node refuses to strip types inside
    // node_modules.
    seed: 'tsx prisma/seed.ts',
  },

  datasource: {
    url: env('DATABASE_URL'),
  },
});
