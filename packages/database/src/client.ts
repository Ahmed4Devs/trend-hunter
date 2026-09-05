import { PrismaPg } from '@prisma/adapter-pg';
import { maskConnectionString } from '@trendhunter/observability';
import type { Logger } from '@trendhunter/observability';

import { Prisma, PrismaClient } from './generated/prisma/client';

/**
 * The database client.
 *
 * Prisma 7 removed the Rust query engine, so a JavaScript driver adapter is
 * mandatory — there is no "just give it a URL" mode any more. That is a net
 * win here: the pool is now a plain node-postgres pool, so its sizing and
 * timeouts are ours to set explicitly rather than being hidden behind
 * connection-string parameters.
 */

export interface DatabaseConfig {
  readonly connectionString: string;
  /**
   * Maximum pooled connections for this process.
   *
   * Sized against PostgreSQL's `max_connections` divided by the number of
   * processes that talk to it (API + worker, times replicas). Too high and a
   * deploy exhausts the server's connection slots; too low and requests queue
   * behind the pool instead of behind the database.
   */
  readonly poolMax?: number;
  readonly connectionTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  /** Statement timeout, so one pathological query cannot hold a connection. */
  readonly statementTimeoutMs?: number;
  readonly schema?: string;
  readonly logger?: Logger;
  /** Logs every query at debug level. Never enable in production. */
  readonly logQueries?: boolean;
}

const DEFAULTS = {
  poolMax: 10,
  connectionTimeoutMs: 10_000,
  idleTimeoutMs: 30_000,
  statementTimeoutMs: 30_000,
  schema: 'public',
} as const;

export type Database = PrismaClient;

/**
 * Creates a client. Each service creates exactly one and passes it down;
 * there is no module-level singleton, because a hidden global connection is
 * impossible to close deterministically in tests or on shutdown.
 */
export function createDatabaseClient(config: DatabaseConfig): PrismaClient {
  const adapter = new PrismaPg(
    {
      connectionString: config.connectionString,
      max: config.poolMax ?? DEFAULTS.poolMax,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? DEFAULTS.connectionTimeoutMs,
      idleTimeoutMillis: config.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs,
      // Applied per connection by node-postgres; a runaway query is cancelled
      // by PostgreSQL rather than pinning a pool slot until the client gives up.
      statement_timeout: config.statementTimeoutMs ?? DEFAULTS.statementTimeoutMs,
      application_name: 'trendhunter',
    },
    { schema: config.schema ?? DEFAULTS.schema },
  );

  const client = new PrismaClient({
    adapter,
    log: config.logQueries === true ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

  config.logger?.debug(
    { connection: maskConnectionString(config.connectionString) },
    'database client created',
  );

  return client;
}

/**
 * Verifies the connection is usable. Called by the readiness probe, which must
 * answer "can this process serve traffic", not merely "is the process alive".
 */
export async function checkDatabaseHealth(
  client: PrismaClient,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = performance.now();
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      // The message may name the host, so it is only ever logged server-side.
      error: error instanceof Error ? error.message : 'unknown database error',
    };
  }
}

export async function disconnectDatabase(client: PrismaClient): Promise<void> {
  await client.$disconnect();
}

export { Prisma, PrismaClient };
export type { PrismaPg };
