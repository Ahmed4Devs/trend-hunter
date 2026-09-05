import { describe, expect, it } from 'vitest';

import {
  EnvironmentError,
  assertProductionReadiness,
  loadApiEnvironment,
  loadDatabaseEnvironment,
  loadWebEnvironment,
  loadWorkerEnvironment,
} from '../src/index';

const DATABASE_URL = 'postgresql://trendhunter:s3cret@postgres:5432/trendhunter';
const REDIS_URL = 'redis://redis:6379';
const REAL_SECRET = '9f2c41ab7d6e05389cbb14e7a205f6d3';

/**
 * Every loader is called with an explicit object: the tests must never depend
 * on — or disturb — the process environment they happen to run under.
 */
const DEV_API: Record<string, string | undefined> = {
  NODE_ENV: 'development',
  DATABASE_URL,
  REDIS_URL,
  BETTER_AUTH_SECRET: REAL_SECRET,
};

const PROD_API: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://trendhunter:s3cret@postgres:5432/trendhunter_production',
  REDIS_URL,
  BETTER_AUTH_SECRET: REAL_SECRET,
  APP_URL: 'https://app.example.com',
  ENABLE_DEMO_ACCOUNT: 'false',
};

describe('loadApiEnvironment', () => {
  it('returns a frozen, fully typed configuration', () => {
    const env = loadApiEnvironment(DEV_API);
    expect(Object.isFrozen(env)).toBe(true);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('selects the production flavour of the schema from NODE_ENV alone', () => {
    expect(() => loadApiEnvironment({ ...PROD_API, ENABLE_DEMO_ACCOUNT: 'true' })).toThrow(
      EnvironmentError,
    );
    expect(() => loadApiEnvironment({ ...DEV_API, ENABLE_DEMO_ACCOUNT: 'true' })).not.toThrow();
  });

  it('accepts a valid production environment', () => {
    const env = loadApiEnvironment(PROD_API);
    expect(env.NODE_ENV).toBe('production');
    expect(env.ENABLE_API_DOCS).toBe(false);
    expect(env.ALLOW_PRIVATE_NETWORK_FETCH).toBe(false);
  });

  it('throws an EnvironmentError naming the service and the bad variables', () => {
    let caught: unknown;
    try {
      loadApiEnvironment({ NODE_ENV: 'development' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvironmentError);
    const error = caught as EnvironmentError;
    expect(error.name).toBe('EnvironmentError');
    expect(error.message).toContain('API');
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('.env.example');
  });

  it('never puts the offending value into the report', () => {
    let message = '';
    try {
      loadApiEnvironment({ ...DEV_API, BETTER_AUTH_SECRET: 'tiny' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).not.toContain('tiny');
  });
});

describe('empty-string variables', () => {
  it('fall back to the schema default rather than failing a min-length check', () => {
    const env = loadApiEnvironment({
      ...DEV_API,
      LOG_LEVEL: '',
      APP_URL: '',
      AI_MODEL: '',
      HOST: '',
      PORT: '',
      CORS_ALLOWED_ORIGINS: '',
    });
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.AI_MODEL).toBe('trendhunter-mock-v1');
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([]);
  });

  it('leave an optional variable unset rather than storing an empty string', () => {
    const env = loadApiEnvironment({ ...DEV_API, LLM_API_KEY: '', AI_BASE_URL: '' });
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.AI_BASE_URL).toBeUndefined();
  });

  it('still fail when a required variable is blank', () => {
    expect(() => loadApiEnvironment({ ...DEV_API, DATABASE_URL: '' })).toThrow(EnvironmentError);
  });

  it('ignore an undefined entry the same way', () => {
    const env = loadApiEnvironment({ ...DEV_API, LOG_LEVEL: undefined });
    expect(env.LOG_LEVEL).toBe('info');
  });
});

describe('loadWorkerEnvironment', () => {
  it('parses the worker environment with its own defaults', () => {
    const env = loadWorkerEnvironment({ NODE_ENV: 'development', DATABASE_URL, REDIS_URL });
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.HEALTH_PORT).toBe(4001);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('names the worker service in its failure report', () => {
    expect(() => loadWorkerEnvironment({ NODE_ENV: 'development' })).toThrow(/worker/);
  });
});

describe('loadWebEnvironment', () => {
  it('parses with nothing supplied at all', () => {
    const env = loadWebEnvironment({});
    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(env.NEXT_PUBLIC_DEFAULT_LOCALE).toBe('en');
  });

  it('drops every server-only variable it is handed', () => {
    const env = loadWebEnvironment({
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://app.example.com',
      DATABASE_URL,
      BETTER_AUTH_SECRET: REAL_SECRET,
      LLM_API_KEY: 'sk-live-should-never-reach-the-browser', // pragma: allowlist secret -- fake key fixture
    });
    expect(Object.keys(env)).toEqual(
      expect.not.arrayContaining(['DATABASE_URL', 'BETTER_AUTH_SECRET', 'LLM_API_KEY']),
    );
    expect(JSON.stringify(env)).not.toContain(REAL_SECRET);
    expect(JSON.stringify(env)).not.toContain('sk-live');
  });

  it('is not subject to the production secret rules, because it holds no secrets', () => {
    expect(() =>
      loadWebEnvironment({
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://app.example.com',
      }),
    ).not.toThrow();
  });
});

describe('loadDatabaseEnvironment', () => {
  it('needs only the connection string', () => {
    const env = loadDatabaseEnvironment({ DATABASE_URL });
    expect(env.DATABASE_URL).toBe(DATABASE_URL);
    expect(env.ENABLE_DEMO_ACCOUNT).toBe(true);
  });

  it('names the database service in its failure report', () => {
    expect(() => loadDatabaseEnvironment({})).toThrow(/database/);
  });
});

describe('assertProductionReadiness', () => {
  it('does nothing outside production', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(() => {
        assertProductionReadiness({
          NODE_ENV: nodeEnv,
          DATABASE_URL: 'postgresql://trendhunter:trendhunter_dev@localhost:5432/app',
          BETTER_AUTH_SECRET: 'change_me_change_me_change_me_change_me',
        });
      }).not.toThrow();
    }
  });

  it('passes a genuinely production-ready configuration', () => {
    expect(() => {
      assertProductionReadiness({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://app:s3cret@postgres:5432/trendhunter',
        REDIS_URL,
        BETTER_AUTH_SECRET: REAL_SECRET,
      });
    }).not.toThrow();
  });

  it('refuses a placeholder auth secret that slipped past the schema', () => {
    expect(() => {
      assertProductionReadiness({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'your_secret_here_your_secret_here',
      });
    }).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('refuses a database still pointing at the development credentials', () => {
    expect(() => {
      assertProductionReadiness({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://trendhunter:trendhunter_dev@postgres:5432/app',
      });
    }).toThrow(/DATABASE_URL/);
  });

  it('refuses a database on localhost, which is unreachable inside the container', () => {
    expect(() => {
      assertProductionReadiness({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://app:s3cret@localhost:5432/app',
      });
    }).toThrow(/localhost/);
  });

  it('reports every problem at once rather than one per restart', () => {
    let message = '';
    try {
      assertProductionReadiness({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://trendhunter:trendhunter_dev@localhost:5432/app',
        BETTER_AUTH_SECRET: 'change_me_change_me_change_me_change_me',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('development database password');
    expect(message).toContain('localhost');
    expect(message.split('\n')).toHaveLength(4);
  });

  it('throws an EnvironmentError, so start-up handles it like any other config failure', () => {
    expect(() => {
      assertProductionReadiness({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'insecure_secret' });
    }).toThrow(EnvironmentError);
  });
});
