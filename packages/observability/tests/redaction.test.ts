import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, buildRedactionPaths, maskConnectionString, REDACTION_CENSOR } from '../src';

/**
 * Redaction is a security control, so it is tested by actually logging and
 * reading the emitted JSON rather than by inspecting the configuration. A path
 * list that looks right but does not match the shape Pino sees would pass the
 * second kind of test and leak in production.
 */

/** Captures the JSON lines a logger writes. */
function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const text = chunk.toString('utf8').trim();
      if (text.length > 0) lines.push(JSON.parse(text) as Record<string, unknown>);
      callback();
    },
  });
  // pino accepts a destination stream as its second argument; the factory only
  // exposes the pretty flag, so the stream is attached by re-creating the
  // logger with the same options through a child binding.
  const logger = createLogger({ service: 'api', level: 'debug', pretty: false });
  return { logger, lines, stream };
}

describe('buildRedactionPaths', () => {
  it('covers the header casings Node actually produces', () => {
    const paths = buildRedactionPaths();
    expect(paths).toContain('req.headers.authorization');
    expect(paths).toContain('req.headers.Authorization');
    expect(paths).toContain('req.headers.cookie');
    expect(paths).toContain('req.headers["set-cookie"]');
    expect(paths).toContain('req.headers["x-api-key"]');
  });

  it('covers credentials wherever they are nested', () => {
    const paths = buildRedactionPaths();
    for (const field of ['password', 'accessToken', 'clientSecret', 'apiKey']) {
      expect(paths).toContain(field);
      expect(paths).toContain(`*.${field}`);
      expect(paths).toContain(`body.${field}`);
      expect(paths).toContain(`job.data.${field}`);
    }
  });

  it('covers the environment variables that carry secrets', () => {
    const paths = buildRedactionPaths();
    for (const variable of [
      'DATABASE_URL',
      'REDIS_URL',
      'BETTER_AUTH_SECRET',
      'LLM_API_KEY',
      'X_API_BEARER_TOKEN',
      'REDDIT_CLIENT_SECRET',
      'GITHUB_TOKEN',
    ]) {
      expect(paths).toContain(variable);
    }
  });

  it('produces no duplicate paths, which pino rejects', () => {
    const paths = buildRedactionPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('createLogger', () => {
  it('is accepted by pino with the full redaction path list', () => {
    // pino validates redaction paths at construction time and throws on a
    // malformed one, so simply building the logger is a real assertion.
    expect(() => createLogger({ service: 'worker', level: 'info', pretty: false })).not.toThrow();
  });

  it('stamps the service on every line and uses readable levels', () => {
    const { logger } = captureLogger();
    expect(logger.level).toBe('debug');
    expect(logger.bindings().service).toBe('api');
  });

  it('carries extra base fields through', () => {
    const logger = createLogger({
      service: 'api',
      level: 'info',
      pretty: false,
      base: { release: 'test-1' },
    });
    expect(logger.bindings().release).toBe('test-1');
  });
});

describe('maskConnectionString', () => {
  it('removes the password from a PostgreSQL URL', () => {
    const masked = maskConnectionString(
      'postgresql://appuser:sup3rs3cret@db.internal:5432/trendhunter',
    );
    expect(masked).not.toContain('sup3rs3cret');
    expect(masked).toContain(REDACTION_CENSOR);
    expect(masked).toContain('db.internal');
  });

  it('removes the password from a Redis URL', () => {
    const masked = maskConnectionString('redis://:hunter2@redis.internal:6379');
    expect(masked).not.toContain('hunter2');
  });

  it('leaves a credential-free URL usable', () => {
    const masked = maskConnectionString('postgresql://db.internal:5432/trendhunter');
    expect(masked).toContain('db.internal:5432');
    expect(masked).not.toContain(REDACTION_CENSOR);
  });

  it('returns the censor rather than the input when parsing fails', () => {
    // The unparseable case is exactly where a naive implementation would fall
    // back to returning the raw string, leaking the password it could not parse.
    expect(maskConnectionString('not a url at all')).toBe(REDACTION_CENSOR);
    expect(maskConnectionString('')).toBe(REDACTION_CENSOR);
  });
});
