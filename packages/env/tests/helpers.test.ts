import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEVELOPMENT_PLACEHOLDER_MARKERS,
  booleanFromEnv,
  formatEnvironmentError,
  integerFromEnv,
  listFromEnv,
  looksLikeDevelopmentPlaceholder,
  postgresUrlFromEnv,
  redisUrlFromEnv,
  secretSchema,
  urlFromEnv,
} from '../src/helpers';

describe('booleanFromEnv', () => {
  it('accepts every spelling an operator actually types for true', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE', 'Yes', 'ON', '  true  ']) {
      expect(booleanFromEnv.parse(value), value).toBe(true);
    }
  });

  it('accepts every spelling for false', () => {
    for (const value of ['false', '0', 'no', 'off', 'FALSE', 'No', 'OFF', ' false ']) {
      expect(booleanFromEnv.parse(value), value).toBe(false);
    }
  });

  it('rejects junk rather than silently reading it as false', () => {
    for (const value of ['', 'maybe', '2', 'y', 'n', 'truthy', 'null', 'undefined']) {
      expect(booleanFromEnv.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('integerFromEnv', () => {
  const port = integerFromEnv(1, 65_535);

  it('parses a plain integer, tolerating surrounding whitespace', () => {
    expect(port.parse('8080')).toBe(8080);
    expect(port.parse('  443 ')).toBe(443);
  });

  it('rejects anything that is not an integer', () => {
    for (const value of ['', '80.5', 'abc', '1e3', '0x10', '8 080', '+80']) {
      expect(port.safeParse(value).success, value).toBe(false);
    }
  });

  it('enforces the declared bounds', () => {
    expect(port.safeParse('0').success).toBe(false);
    expect(port.safeParse('65536').success).toBe(false);
    expect(port.safeParse('1').success).toBe(true);
    expect(port.safeParse('65535').success).toBe(true);
  });

  it('accepts a negative integer only when the range allows it', () => {
    expect(port.safeParse('-1').success).toBe(false);
    expect(integerFromEnv(-10, 10).parse('-5')).toBe(-5);
  });
});

describe('listFromEnv', () => {
  it('splits on commas, trims entries and drops the empty ones', () => {
    expect(listFromEnv.parse('a, b ,,  c ,')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list for an empty or comma-only string', () => {
    expect(listFromEnv.parse('')).toEqual([]);
    expect(listFromEnv.parse(' , , ')).toEqual([]);
  });

  it('keeps a single entry intact', () => {
    expect(listFromEnv.parse('https://app.example.com')).toEqual(['https://app.example.com']);
  });
});

describe('urlFromEnv', () => {
  it('accepts an absolute URL and strips a trailing origin slash', () => {
    expect(urlFromEnv.parse('https://app.example.com')).toBe('https://app.example.com');
    expect(urlFromEnv.parse('https://app.example.com/')).toBe('https://app.example.com');
  });

  it('keeps a path', () => {
    expect(urlFromEnv.parse('https://app.example.com/api/v1')).toBe(
      'https://app.example.com/api/v1',
    );
  });

  it('rejects a trailing slash on a path, which would double up on every join', () => {
    expect(urlFromEnv.safeParse('https://app.example.com/api/').success).toBe(false);
  });

  it('rejects a relative or malformed URL', () => {
    for (const value of ['', 'app.example.com', '/api', 'not a url']) {
      expect(urlFromEnv.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('postgresUrlFromEnv and redisUrlFromEnv', () => {
  it('accept the documented schemes', () => {
    expect(postgresUrlFromEnv.parse('postgres://u:p@db:5432/app')).toBe('postgres://u:p@db:5432/app');
    expect(postgresUrlFromEnv.parse('postgresql://u:p@db:5432/app')).toBe(
      'postgresql://u:p@db:5432/app',
    );
    expect(redisUrlFromEnv.parse('redis://cache:6379')).toBe('redis://cache:6379');
    expect(redisUrlFromEnv.parse('rediss://cache:6379')).toBe('rediss://cache:6379');
  });

  it('reject a connection string pointing at the wrong service', () => {
    expect(postgresUrlFromEnv.safeParse('mysql://u:p@db/app').success).toBe(false);
    expect(postgresUrlFromEnv.safeParse('redis://cache:6379').success).toBe(false);
    expect(redisUrlFromEnv.safeParse('postgres://u:p@db/app').success).toBe(false);
    expect(redisUrlFromEnv.safeParse('').success).toBe(false);
  });
});

describe('looksLikeDevelopmentPlaceholder', () => {
  it('recognises every documented marker, wherever it sits in the value', () => {
    for (const marker of DEVELOPMENT_PLACEHOLDER_MARKERS) {
      expect(looksLikeDevelopmentPlaceholder(marker), marker).toBe(true);
      expect(looksLikeDevelopmentPlaceholder(`prefix-${marker}-suffix`), marker).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(looksLikeDevelopmentPlaceholder('CHANGE_ME_NOW')).toBe(true);
    expect(looksLikeDevelopmentPlaceholder('Placeholder')).toBe(true);
  });

  it('accepts a value that only looks random', () => {
    expect(looksLikeDevelopmentPlaceholder('8f3c1a9d4b7e0562af31cc9d2e64b708')).toBe(false);
    expect(looksLikeDevelopmentPlaceholder('')).toBe(false);
  });
});

describe('secretSchema', () => {
  it('enforces the minimum length in both modes', () => {
    for (const enforceProduction of [true, false]) {
      const schema = secretSchema({ minLength: 32, enforceProduction });
      expect(schema.safeParse('too-short').success).toBe(false);
      expect(schema.safeParse('a'.repeat(32)).success).toBe(true);
    }
  });

  it('names the required length in the failure message', () => {
    const issue = secretSchema({ minLength: 32, enforceProduction: false }).safeParse('short');
    expect(issue.success).toBe(false);
    expect(issue.error?.issues[0]?.message).toContain('32');
  });

  it('rejects a development placeholder only when production is enforced', () => {
    const placeholder = 'change_me_change_me_change_me_change_me';
    expect(secretSchema({ minLength: 32, enforceProduction: true }).safeParse(placeholder).success)
      .toBe(false);
    expect(secretSchema({ minLength: 32, enforceProduction: false }).safeParse(placeholder).success)
      .toBe(true);
  });

  it('never echoes the secret in the failure message', () => {
    const placeholder = 'change_me_change_me_change_me_change_me';
    const result = secretSchema({ minLength: 32, enforceProduction: true }).safeParse(placeholder);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(placeholder);
  });
});

describe('formatEnvironmentError', () => {
  function errorFor(raw: Record<string, unknown>): z.ZodError {
    const schema = z.object({
      DATABASE_URL: postgresUrlFromEnv,
      BETTER_AUTH_SECRET: secretSchema({ minLength: 32, enforceProduction: true }),
    });
    const result = schema.safeParse(raw);
    if (result.success) throw new Error('expected the fixture to fail validation');
    return result.error;
  }

  it('names the service and every offending variable', () => {
    const report = formatEnvironmentError(
      errorFor({ DATABASE_URL: 'mysql://nope', BETTER_AUTH_SECRET: 'short' }),
      'API',
    );
    expect(report).toContain('API');
    expect(report).toContain('DATABASE_URL');
    expect(report).toContain('BETTER_AUTH_SECRET');
  });

  it('never prints the offending value, which would put a secret in the logs', () => {
    const secret = 'hunter2-hunter2-hunter2-hunter2-hunter2';
    const report = formatEnvironmentError(
      errorFor({ DATABASE_URL: 'postgres://ok', BETTER_AUTH_SECRET: `insecure-${secret}` }),
      'API',
    );
    expect(report).toContain('BETTER_AUTH_SECRET');
    expect(report).not.toContain('hunter2');
  });

  it('points the operator at the example file', () => {
    const report = formatEnvironmentError(errorFor({}), 'worker');
    expect(report).toContain('.env.example');
    expect(report).toContain('worker');
  });

  it('labels a root-level issue rather than printing an empty variable name', () => {
    const result = z
      .object({ A: z.string() })
      .refine(() => false, { message: 'the combination is invalid' })
      .safeParse({ A: 'x' });
    if (result.success) throw new Error('expected the fixture to fail validation');
    const report = formatEnvironmentError(result.error, 'API');
    expect(report).toContain('(root)');
    expect(report).toContain('the combination is invalid');
  });
});
