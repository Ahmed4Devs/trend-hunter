import { z } from 'zod';

import {
  booleanFromEnv,
  integerFromEnv,
  listFromEnv,
  postgresUrlFromEnv,
  redisUrlFromEnv,
  secretSchema,
  urlFromEnv,
} from './helpers';

/**
 * Environment schemas, one per runtime.
 *
 * Each service parses only what it actually needs. The web app in particular
 * gets a deliberately tiny schema: anything the browser must not see (database
 * URLs, the auth secret, provider keys) simply is not part of it, so it cannot
 * accidentally end up in a client bundle.
 */

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

const nodeEnvSchema = z.enum(NODE_ENVIRONMENTS).default('development');

const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

const dataModeSchema = z.enum(['mock', 'live']).default('mock');
const aiProviderSchema = z.enum(['mock', 'openai', 'anthropic', 'openai-compatible']).default('mock');

/**
 * Builds the schemas for a given target environment.
 *
 * The `production` flavour is strictly stronger: secrets get a minimum length
 * and are rejected when they look like the documented development
 * placeholders, and permissive development conveniences (fetching private
 * network URLs, serving the OpenAPI explorer) default to off.
 */
function buildSchemas(isProduction: boolean) {
  const requiredSecret = secretSchema({ minLength: 32, enforceProduction: isProduction });
  const providerCredential = secretSchema({ minLength: 8, enforceProduction: false });

  const shared = {
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    APP_URL: urlFromEnv.default('http://localhost:3000'),
    API_URL: urlFromEnv.default('http://localhost:4000'),
  };

  const dataAndAi = {
    DATA_MODE: dataModeSchema,
    AI_PROVIDER: aiProviderSchema,
    AI_MODEL: z.string().trim().min(1).default('trendhunter-mock-v1'),
    AI_BASE_URL: urlFromEnv.optional(),
    LLM_API_KEY: providerCredential.optional(),
    EMBEDDING_DIMENSIONS: integerFromEnv(64, 4096).default(768),
  };

  const providerCredentials = {
    X_API_BEARER_TOKEN: providerCredential.optional(),
    REDDIT_CLIENT_ID: providerCredential.optional(),
    REDDIT_CLIENT_SECRET: providerCredential.optional(),
    GITHUB_TOKEN: providerCredential.optional(),
  };

  /** Fastify API. */
  const apiSchema = z
    .object({
      ...shared,
      ...dataAndAi,
      ...providerCredentials,
      PORT: integerFromEnv(1, 65535).default(4000),
      HOST: z.string().trim().min(1).default('0.0.0.0'),
      DATABASE_URL: postgresUrlFromEnv,
      REDIS_URL: redisUrlFromEnv,
      BETTER_AUTH_SECRET: requiredSecret,
      BETTER_AUTH_URL: urlFromEnv.default('http://localhost:4000'),
      /** Extra origins allowed by CORS, on top of APP_URL. */
      CORS_ALLOWED_ORIGINS: listFromEnv.default([]),
      /** Serves /docs. Defaults to off in production. */
      ENABLE_API_DOCS: booleanFromEnv.default(!isProduction),
      /** Requests per window, per client, for general endpoints. */
      RATE_LIMIT_MAX: integerFromEnv(1, 100_000).default(300),
      RATE_LIMIT_WINDOW_SECONDS: integerFromEnv(1, 86_400).default(60),
      /** Stricter budget for authentication endpoints. */
      AUTH_RATE_LIMIT_MAX: integerFromEnv(1, 1_000).default(10),
      AUTH_RATE_LIMIT_WINDOW_SECONDS: integerFromEnv(1, 86_400).default(60),
      /** Stricter budget for AI, translation, search and scan endpoints. */
      EXPENSIVE_RATE_LIMIT_MAX: integerFromEnv(1, 10_000).default(30),
      EXPENSIVE_RATE_LIMIT_WINDOW_SECONDS: integerFromEnv(1, 86_400).default(60),
      /** Trust X-Forwarded-* headers. Only ever true behind our own proxy. */
      TRUST_PROXY: booleanFromEnv.default(isProduction),
      MAX_BODY_BYTES: integerFromEnv(1_024, 10 * 1024 * 1024).default(524_288),
      /** Allows outbound fetches to private addresses. Never in production. */
      ALLOW_PRIVATE_NETWORK_FETCH: booleanFromEnv.default(false),
      /** Seed / demo account creation. Refused in production. */
      ENABLE_DEMO_ACCOUNT: booleanFromEnv.default(!isProduction),
    })
    .superRefine((env, ctx) => {
      if (env.NODE_ENV !== 'production') return;

      if (env.ALLOW_PRIVATE_NETWORK_FETCH) {
        ctx.addIssue({
          code: 'custom',
          path: ['ALLOW_PRIVATE_NETWORK_FETCH'],
          message: 'must be false in production: it disables SSRF protection',
        });
      }
      if (env.ENABLE_DEMO_ACCOUNT) {
        ctx.addIssue({
          code: 'custom',
          path: ['ENABLE_DEMO_ACCOUNT'],
          message: 'must be false in production: the demo account has a published password',
        });
      }
      if (env.APP_URL.startsWith('http://') && !env.APP_URL.startsWith('http://localhost')) {
        ctx.addIssue({
          code: 'custom',
          path: ['APP_URL'],
          message: 'must use https in production',
        });
      }
      if (env.DATA_MODE === 'live' && env.AI_PROVIDER !== 'mock' && !env.LLM_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['LLM_API_KEY'],
          message: 'is required when AI_PROVIDER is not "mock"',
        });
      }
    });

  /** BullMQ worker. Shares the data layer, adds scheduling knobs. */
  const workerSchema = z.object({
    ...shared,
    ...dataAndAi,
    ...providerCredentials,
    DATABASE_URL: postgresUrlFromEnv,
    REDIS_URL: redisUrlFromEnv,
    WORKER_CONCURRENCY: integerFromEnv(1, 64).default(4),
    /** Registers the repeatable collection schedules on start-up. */
    ENABLE_SCHEDULED_SCANS: booleanFromEnv.default(true),
    /** Multiplies every configured scan interval; useful in demos. */
    SCAN_INTERVAL_MULTIPLIER: integerFromEnv(1, 60).default(1),
    /** Days of raw payloads to keep before the maintenance job prunes them. */
    RAW_ITEM_RETENTION_DAYS: integerFromEnv(1, 3_650).default(90),
    JOB_RUN_RETENTION_DAYS: integerFromEnv(1, 365).default(30),
    ALLOW_PRIVATE_NETWORK_FETCH: booleanFromEnv.default(false),
    HEALTH_PORT: integerFromEnv(1, 65535).default(4001),
  });

  /**
   * Next.js. Everything here is safe for the browser: only the two public URLs
   * and the locale defaults. Server-only values never enter this schema.
   */
  const webSchema = z.object({
    NODE_ENV: nodeEnvSchema,
    NEXT_PUBLIC_APP_URL: urlFromEnv.default('http://localhost:3000'),
    NEXT_PUBLIC_API_URL: urlFromEnv.default('http://localhost:4000'),
    NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['en', 'ar']).default('en'),
    /** Server-side only: used by Server Components talking to the API. */
    API_INTERNAL_URL: urlFromEnv.optional(),
    LOG_LEVEL: logLevelSchema,
  });

  /** Prisma CLI / seed scripts. */
  const databaseSchema = z.object({
    NODE_ENV: nodeEnvSchema,
    DATABASE_URL: postgresUrlFromEnv,
    LOG_LEVEL: logLevelSchema,
    ENABLE_DEMO_ACCOUNT: booleanFromEnv.default(!isProduction),
    EMBEDDING_DIMENSIONS: integerFromEnv(64, 4096).default(768),
  });

  return { apiSchema, workerSchema, webSchema, databaseSchema };
}

export type ApiEnvironment = z.infer<ReturnType<typeof buildSchemas>['apiSchema']>;
export type WorkerEnvironment = z.infer<ReturnType<typeof buildSchemas>['workerSchema']>;
export type WebEnvironment = z.infer<ReturnType<typeof buildSchemas>['webSchema']>;
export type DatabaseEnvironment = z.infer<ReturnType<typeof buildSchemas>['databaseSchema']>;

export { buildSchemas };
