import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { NODE_ENVIRONMENTS, buildSchemas } from '../src/schema';

const DATABASE_URL = 'postgresql://trendhunter:s3cret@postgres:5432/trendhunter';
const REDIS_URL = 'redis://redis:6379';
const REAL_SECRET = '9f2c41ab7d6e05389cbb14e7a205f6d3';
const PLACEHOLDER_SECRET = 'change_me_change_me_change_me_change_me';

/** The minimum a developer needs in `.env` to boot the API locally. */
const DEV_API = {
  NODE_ENV: 'development',
  DATABASE_URL,
  REDIS_URL,
  BETTER_AUTH_SECRET: REAL_SECRET,
} as const;

/** The minimum a production API deployment needs. */
const PROD_API = {
  NODE_ENV: 'production',
  DATABASE_URL,
  REDIS_URL,
  BETTER_AUTH_SECRET: REAL_SECRET,
  APP_URL: 'https://app.example.com',
  API_URL: 'https://api.example.com',
  BETTER_AUTH_URL: 'https://api.example.com',
  TRUST_PROXY: 'true',
  ENABLE_API_DOCS: 'false',
  ENABLE_DEMO_ACCOUNT: 'false',
  ALLOW_PRIVATE_NETWORK_FETCH: 'false',
} as const;

const devApi = () => buildSchemas(false).apiSchema;
const prodApi = () => buildSchemas(true).apiSchema;

/** The variables named by the issues of a failed parse. */
function failedVariables(schema: z.ZodType, raw: Record<string, string>): string[] {
  const result = schema.safeParse(raw);
  if (result.success) throw new Error('expected the environment to be rejected');
  return result.error.issues.map((issue) => issue.path.join('.'));
}

describe('a valid development environment', () => {
  it('parses and fills in every documented default', () => {
    const result = devApi().safeParse(DEV_API);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.NODE_ENV).toBe('development');
    expect(result.data.LOG_LEVEL).toBe('info');
    expect(result.data.PORT).toBe(4000);
    expect(result.data.HOST).toBe('0.0.0.0');
    expect(result.data.APP_URL).toBe('http://localhost:3000');
    expect(result.data.API_URL).toBe('http://localhost:4000');
    expect(result.data.DATA_MODE).toBe('mock');
    expect(result.data.AI_PROVIDER).toBe('mock');
    expect(result.data.AI_MODEL).toBe('trendhunter-mock-v1');
    expect(result.data.EMBEDDING_DIMENSIONS).toBe(768);
    expect(result.data.CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(result.data.RATE_LIMIT_MAX).toBe(300);
    expect(result.data.MAX_BODY_BYTES).toBe(524_288);
    expect(result.data.ALLOW_PRIVATE_NETWORK_FETCH).toBe(false);
  });

  it('yields real booleans and numbers, not strings', () => {
    const result = devApi().safeParse({ ...DEV_API, PORT: '4100', TRUST_PROXY: 'yes' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(4100);
    expect(typeof result.data.TRUST_PROXY).toBe('boolean');
    expect(result.data.TRUST_PROXY).toBe(true);
  });

  it('defaults the development conveniences on and the production hardening off', () => {
    const result = devApi().safeParse(DEV_API);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ENABLE_API_DOCS).toBe(true);
    expect(result.data.ENABLE_DEMO_ACCOUNT).toBe(true);
    expect(result.data.TRUST_PROXY).toBe(false);
  });

  it('flips those defaults for a production build of the schema', () => {
    const result = prodApi().safeParse(PROD_API);
    expect(result.success).toBe(true);

    const bare = prodApi().safeParse({
      NODE_ENV: 'production',
      DATABASE_URL,
      REDIS_URL,
      BETTER_AUTH_SECRET: REAL_SECRET,
      APP_URL: 'https://app.example.com',
    });
    expect(bare.success).toBe(true);
    if (!bare.success) return;
    expect(bare.data.ENABLE_API_DOCS).toBe(false);
    expect(bare.data.ENABLE_DEMO_ACCOUNT).toBe(false);
    expect(bare.data.TRUST_PROXY).toBe(true);
  });

  it('requires the data-layer variables', () => {
    expect(failedVariables(devApi(), { NODE_ENV: 'development' })).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'BETTER_AUTH_SECRET']),
    );
  });

  it('parses a comma-separated CORS allow-list', () => {
    const result = devApi().safeParse({
      ...DEV_API,
      CORS_ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com ,',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.CORS_ALLOWED_ORIGINS).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('accepts every node environment it declares', () => {
    for (const nodeEnv of NODE_ENVIRONMENTS) {
      const schema = buildSchemas(nodeEnv === 'production').apiSchema;
      const raw = nodeEnv === 'production' ? { ...PROD_API } : { ...DEV_API, NODE_ENV: nodeEnv };
      expect(schema.safeParse(raw).success, nodeEnv).toBe(true);
    }
  });

  it('rejects an unknown node environment or log level', () => {
    expect(devApi().safeParse({ ...DEV_API, NODE_ENV: 'staging' }).success).toBe(false);
    expect(devApi().safeParse({ ...DEV_API, LOG_LEVEL: 'verbose' }).success).toBe(false);
  });

  it('rejects an out-of-range numeric knob', () => {
    expect(failedVariables(devApi(), { ...DEV_API, PORT: '0' })).toContain('PORT');
    expect(failedVariables(devApi(), { ...DEV_API, EMBEDDING_DIMENSIONS: '8' })).toContain(
      'EMBEDDING_DIMENSIONS',
    );
    expect(failedVariables(devApi(), { ...DEV_API, RATE_LIMIT_MAX: 'many' })).toContain(
      'RATE_LIMIT_MAX',
    );
  });
});

describe('production hardening', () => {
  it('rejects a secret that is too short', () => {
    expect(failedVariables(prodApi(), { ...PROD_API, BETTER_AUTH_SECRET: 'short' })).toContain(
      'BETTER_AUTH_SECRET',
    );
  });

  it('rejects a secret containing a development placeholder marker', () => {
    expect(
      failedVariables(prodApi(), { ...PROD_API, BETTER_AUTH_SECRET: PLACEHOLDER_SECRET }),
    ).toContain('BETTER_AUTH_SECRET');
  });

  it('rejects disabling SSRF protection', () => {
    expect(
      failedVariables(prodApi(), { ...PROD_API, ALLOW_PRIVATE_NETWORK_FETCH: 'true' }),
    ).toContain('ALLOW_PRIVATE_NETWORK_FETCH');
  });

  it('rejects the demo account, whose password is published', () => {
    expect(failedVariables(prodApi(), { ...PROD_API, ENABLE_DEMO_ACCOUNT: 'true' })).toContain(
      'ENABLE_DEMO_ACCOUNT',
    );
  });

  it('rejects a plain-http APP_URL', () => {
    expect(
      failedVariables(prodApi(), { ...PROD_API, APP_URL: 'http://app.example.com' }),
    ).toContain('APP_URL');
  });

  it('still allows an http localhost APP_URL, which only ever means a local smoke test', () => {
    expect(prodApi().safeParse({ ...PROD_API, APP_URL: 'http://localhost:3000' }).success).toBe(
      true,
    );
  });

  it('rejects a live deployment with a real AI provider and no key', () => {
    expect(
      failedVariables(prodApi(), {
        ...PROD_API,
        DATA_MODE: 'live',
        AI_PROVIDER: 'openai',
      }),
    ).toContain('LLM_API_KEY');
  });

  it('accepts a live deployment once the key is supplied', () => {
    expect(
      prodApi().safeParse({
        ...PROD_API,
        DATA_MODE: 'live',
        AI_PROVIDER: 'openai',
        LLM_API_KEY: 'sk-live-9f2c41ab7d6e05389cbb14e7a205f6d3', // pragma: allowlist secret -- fake key fixture
      }).success,
    ).toBe(true);
  });

  it('does not demand a key while the mock provider is in use', () => {
    expect(prodApi().safeParse({ ...PROD_API, DATA_MODE: 'live' }).success).toBe(true);
  });

  it('accepts every one of those values in development', () => {
    const permissive = {
      ...DEV_API,
      BETTER_AUTH_SECRET: PLACEHOLDER_SECRET,
      ALLOW_PRIVATE_NETWORK_FETCH: 'true',
      ENABLE_DEMO_ACCOUNT: 'true',
      APP_URL: 'http://app.example.com',
      DATA_MODE: 'live',
      AI_PROVIDER: 'openai',
    };
    const result = devApi().safeParse(permissive);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ALLOW_PRIVATE_NETWORK_FETCH).toBe(true);
    expect(result.data.ENABLE_DEMO_ACCOUNT).toBe(true);
  });

  it('still rejects a short secret in development — length is never negotiable', () => {
    expect(failedVariables(devApi(), { ...DEV_API, BETTER_AUTH_SECRET: 'short' })).toContain(
      'BETTER_AUTH_SECRET',
    );
  });

  it('names the variable in every failure message and never the value', () => {
    const result = prodApi().safeParse({
      ...PROD_API,
      BETTER_AUTH_SECRET: `insecure-${REAL_SECRET}`,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const [issue] = result.error.issues;
    expect(issue?.path).toEqual(['BETTER_AUTH_SECRET']);
    expect(JSON.stringify(result.error.issues)).not.toContain(REAL_SECRET);
  });
});

describe('the worker schema', () => {
  const worker = buildSchemas(false).workerSchema;

  it('parses the minimum worker environment with its defaults', () => {
    const result = worker.safeParse({ NODE_ENV: 'development', DATABASE_URL, REDIS_URL });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.WORKER_CONCURRENCY).toBe(4);
    expect(result.data.ENABLE_SCHEDULED_SCANS).toBe(true);
    expect(result.data.SCAN_INTERVAL_MULTIPLIER).toBe(1);
    expect(result.data.RAW_ITEM_RETENTION_DAYS).toBe(90);
    expect(result.data.JOB_RUN_RETENTION_DAYS).toBe(30);
    expect(result.data.HEALTH_PORT).toBe(4001);
  });

  it('requires the data layer but not the auth secret', () => {
    const variables = failedVariables(worker, { NODE_ENV: 'development' });
    expect(variables).toEqual(expect.arrayContaining(['DATABASE_URL', 'REDIS_URL']));
    expect(variables).not.toContain('BETTER_AUTH_SECRET');
  });

  it('bounds its scheduling knobs', () => {
    expect(
      worker.safeParse({
        NODE_ENV: 'development',
        DATABASE_URL,
        REDIS_URL,
        WORKER_CONCURRENCY: '65',
      }).success,
    ).toBe(false);
    expect(
      worker.safeParse({
        NODE_ENV: 'development',
        DATABASE_URL,
        REDIS_URL,
        SCAN_INTERVAL_MULTIPLIER: '0',
      }).success,
    ).toBe(false);
  });
});

describe('the web schema', () => {
  const web = buildSchemas(false).webSchema;

  it('parses with nothing but the defaults', () => {
    const result = web.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(result.data.NEXT_PUBLIC_API_URL).toBe('http://localhost:4000');
    expect(result.data.NEXT_PUBLIC_DEFAULT_LOCALE).toBe('en');
    expect(result.data.LOG_LEVEL).toBe('info');
  });

  it('does not accept or expose any server-only secret', () => {
    const result = web.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL,
      REDIS_URL,
      BETTER_AUTH_SECRET: REAL_SECRET,
      LLM_API_KEY: 'sk-live-should-never-reach-the-browser', // pragma: allowlist secret -- fake key fixture
      NEXT_PUBLIC_APP_URL: 'https://app.example.com',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(Object.keys(result.data)).not.toContain('DATABASE_URL');
    expect(Object.keys(result.data)).not.toContain('REDIS_URL');
    expect(Object.keys(result.data)).not.toContain('BETTER_AUTH_SECRET');
    expect(Object.keys(result.data)).not.toContain('LLM_API_KEY');
    expect(JSON.stringify(result.data)).not.toContain(REAL_SECRET);
    expect(JSON.stringify(result.data)).not.toContain('sk-live');
  });

  it('accepts only the two supported locales', () => {
    expect(web.safeParse({ NEXT_PUBLIC_DEFAULT_LOCALE: 'ar' }).success).toBe(true);
    expect(web.safeParse({ NEXT_PUBLIC_DEFAULT_LOCALE: 'fr' }).success).toBe(false);
  });

  it('keeps the server-side internal API URL optional', () => {
    const result = web.safeParse({ API_INTERNAL_URL: 'http://api:4000' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.API_INTERNAL_URL).toBe('http://api:4000');
    expect(web.safeParse({}).success).toBe(true);
  });
});

describe('the database schema', () => {
  const database = buildSchemas(false).databaseSchema;

  it('needs only the connection string', () => {
    const result = database.safeParse({ DATABASE_URL });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.NODE_ENV).toBe('development');
    expect(result.data.EMBEDDING_DIMENSIONS).toBe(768);
    expect(result.data.ENABLE_DEMO_ACCOUNT).toBe(true);
  });

  it('refuses to seed a demo account by default in production', () => {
    const result = buildSchemas(true).databaseSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ENABLE_DEMO_ACCOUNT).toBe(false);
  });

  it('rejects a missing or malformed connection string', () => {
    expect(database.safeParse({}).success).toBe(false);
    expect(database.safeParse({ DATABASE_URL: 'mysql://db/app' }).success).toBe(false);
  });
});
