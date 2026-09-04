import type { z } from 'zod';

import { formatEnvironmentError, looksLikeDevelopmentPlaceholder } from './helpers';
import {
  buildSchemas,
  type ApiEnvironment,
  type DatabaseEnvironment,
  type WebEnvironment,
  type WorkerEnvironment,
} from './schema';

export * from './helpers';
export * from './schema';

/**
 * `@trendhunter/env` — the only place a service is allowed to read
 * `process.env`.
 *
 * Each loader parses the raw environment once, fails fast with a readable
 * report when anything is wrong, and returns a frozen, fully typed object.
 * Nothing downstream ever sees a `string | undefined`.
 */

class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

type RawEnvironment = Record<string, string | undefined>;

function parse<TSchema extends z.ZodType>(
  schema: TSchema,
  raw: RawEnvironment,
  service: string,
): z.infer<TSchema> {
  // Empty strings are treated as "unset" so that a blank line in a .env file
  // falls back to the schema default instead of failing a min-length check.
  const cleaned: RawEnvironment = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvironmentError(formatEnvironmentError(result.error, service));
  }
  return Object.freeze(result.data) as z.infer<TSchema>;
}

function isProductionTarget(raw: RawEnvironment): boolean {
  return raw.NODE_ENV === 'production';
}

export function loadApiEnvironment(raw: RawEnvironment = process.env): ApiEnvironment {
  const { apiSchema } = buildSchemas(isProductionTarget(raw));
  return parse(apiSchema, raw, 'API');
}

export function loadWorkerEnvironment(raw: RawEnvironment = process.env): WorkerEnvironment {
  const { workerSchema } = buildSchemas(isProductionTarget(raw));
  return parse(workerSchema, raw, 'worker');
}

export function loadWebEnvironment(raw: RawEnvironment = process.env): WebEnvironment {
  const { webSchema } = buildSchemas(isProductionTarget(raw));
  return parse(webSchema, raw, 'web');
}

export function loadDatabaseEnvironment(raw: RawEnvironment = process.env): DatabaseEnvironment {
  const { databaseSchema } = buildSchemas(isProductionTarget(raw));
  return parse(databaseSchema, raw, 'database');
}

/**
 * Additional production guard applied after parsing.
 *
 * The schema already rejects placeholder-looking secrets; this catches the
 * remaining case where a credential is real-looking but the deployment is still
 * pointing at development infrastructure.
 */
export function assertProductionReadiness(env: {
  NODE_ENV: string;
  DATABASE_URL?: string;
  REDIS_URL?: string;
  BETTER_AUTH_SECRET?: string;
}): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  if (env.BETTER_AUTH_SECRET && looksLikeDevelopmentPlaceholder(env.BETTER_AUTH_SECRET)) {
    problems.push('BETTER_AUTH_SECRET is a development placeholder');
  }
  if (env.DATABASE_URL?.includes('trendhunter_dev')) {
    problems.push('DATABASE_URL still points at the development database password');
  }
  if (env.DATABASE_URL?.includes('@localhost')) {
    problems.push('DATABASE_URL points at localhost, which is not reachable inside the container');
  }

  if (problems.length > 0) {
    throw new EnvironmentError(
      ['Refusing to start in production:', ...problems.map((problem) => `  - ${problem}`)].join(
        '\n',
      ),
    );
  }
}

export { EnvironmentError };
