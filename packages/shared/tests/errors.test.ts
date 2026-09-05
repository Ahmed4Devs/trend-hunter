import { describe, expect, it } from 'vitest';

import { API_ERROR_CODES, type ApiErrorCode } from '@trendhunter/types';

import {
  AppError,
  ConflictError,
  FeatureDisabledError,
  ForbiddenError,
  LlmProviderError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  UpstreamError,
  ValidationError,
  httpStatusForErrorCode,
  isAppError,
  toAppError,
} from '../src/errors';

// A deliberately secret-looking fixture: the point of the tests below is that
// it never reaches a client payload.
const SECRET = 'postgres://admin:hunter2@db.internal/trendhunter'; // pragma: allowlist secret

describe('httpStatusForErrorCode', () => {
  it('maps every code to its documented status', () => {
    const expected: Record<ApiErrorCode, number> = {
      VALIDATION_ERROR: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PAYLOAD_TOO_LARGE: 413,
      UNSUPPORTED_MEDIA_TYPE: 415,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
      UPSTREAM_UNAVAILABLE: 502,
      FEATURE_DISABLED: 503,
    };
    for (const code of API_ERROR_CODES) {
      expect(httpStatusForErrorCode(code)).toBe(expected[code]);
    }
  });

  it('covers every code the API contract declares', () => {
    for (const code of API_ERROR_CODES) {
      const status = httpStatusForErrorCode(code);
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
});

describe('AppError', () => {
  it('derives its status from its code', () => {
    expect(new AppError('NOT_FOUND', 'gone').statusCode).toBe(404);
  });

  it('exposes its message by default', () => {
    expect(new AppError('CONFLICT', 'already exists').expose).toBe(true);
  });

  it('does not expose an internal error by default', () => {
    expect(new AppError('INTERNAL_ERROR', SECRET).expose).toBe(false);
  });

  it('honours an explicit expose override in both directions', () => {
    expect(new AppError('INTERNAL_ERROR', 'x', { expose: true }).expose).toBe(true);
    expect(new AppError('CONFLICT', 'x', { expose: false }).expose).toBe(false);
  });

  it('takes its name from the concrete subclass', () => {
    expect(new AppError('CONFLICT', 'x').name).toBe('AppError');
    expect(new NotFoundError('Topic').name).toBe('NotFoundError');
    expect(new LlmProviderError('openai', 'bad json').name).toBe('LlmProviderError');
  });

  it('keeps the cause without putting it on the wire', () => {
    const cause = new Error('socket hang up');
    const error = new AppError('UPSTREAM_UNAVAILABLE', 'provider failed', { cause });
    expect(error.cause).toBe(cause);
    expect(JSON.stringify(error.toClientPayload())).not.toContain('socket hang up');
  });

  it('is a real Error with a stack', () => {
    const error = new AppError('CONFLICT', 'x');
    expect(error).toBeInstanceOf(Error);
    expect(typeof error.stack).toBe('string');
  });
});

describe('AppError.toClientPayload', () => {
  it('returns the message and details of an exposed error', () => {
    const error = new ValidationError('title is required', { details: { field: 'title' } });
    expect(error.toClientPayload()).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'title is required',
      details: { field: 'title' },
    });
  });

  it('replaces the message of a non-exposed error with a generic one', () => {
    const payload = new AppError('INTERNAL_ERROR', SECRET).toClientPayload();
    expect(payload.message).toBe('An unexpected error occurred.');
    expect(payload.message).not.toContain('hunter2');
  });

  it('withholds the details of a non-exposed error', () => {
    const error = new AppError('INTERNAL_ERROR', SECRET, {
      details: { connectionString: SECRET },
    });
    const payload = error.toClientPayload();
    expect(payload.details).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });

  it('never leaks a non-exposed message for any code', () => {
    for (const code of API_ERROR_CODES) {
      const payload = new AppError(code, SECRET, {
        expose: false,
        details: { url: SECRET },
      }).toClientPayload('req-1');
      expect(JSON.stringify(payload)).not.toContain('hunter2');
      expect(payload.code).toBe(code);
    }
  });

  it('includes the request id when one is supplied and omits the key otherwise', () => {
    expect(new ConflictError('dup').toClientPayload('req-42').requestId).toBe('req-42');
    expect('requestId' in new ConflictError('dup').toClientPayload()).toBe(false);
  });

  it('omits the details key entirely when there are none', () => {
    expect('details' in new ConflictError('dup').toClientPayload()).toBe(false);
  });

  it('never carries a stack', () => {
    expect('stack' in new ConflictError('dup').toClientPayload()).toBe(false);
  });
});

describe('the concrete error classes', () => {
  it('carry the right code, status and default message', () => {
    const cases = [
      [new ValidationError(), 'VALIDATION_ERROR', 400],
      [new UnauthenticatedError(), 'UNAUTHENTICATED', 401],
      [new ForbiddenError(), 'FORBIDDEN', 403],
      [new NotFoundError(), 'NOT_FOUND', 404],
      [new ConflictError(), 'CONFLICT', 409],
      [new RateLimitedError(), 'RATE_LIMITED', 429],
      [new FeatureDisabledError('Translation'), 'FEATURE_DISABLED', 503],
    ] as const;

    for (const [error, code, status] of cases) {
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(status);
      expect(error.expose).toBe(true);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('builds a readable NotFoundError message from the resource name', () => {
    expect(new NotFoundError('Topic').message).toBe('Topic was not found.');
    expect(new NotFoundError().message).toBe('Resource was not found.');
  });

  it('names the feature in a FeatureDisabledError', () => {
    expect(new FeatureDisabledError('Translation').message).toContain('Translation');
  });

  it('records the provider on an upstream error', () => {
    const error = new UpstreamError('reddit', 'gateway timeout');
    expect(error.provider).toBe('reddit');
    expect(error.statusCode).toBe(502);
  });

  it('treats an LLM failure as an upstream failure', () => {
    const error = new LlmProviderError('anthropic', 'response failed schema validation');
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toBeInstanceOf(AppError);
    expect(error.provider).toBe('anthropic');
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('toAppError', () => {
  it('returns an AppError untouched', () => {
    const original = new NotFoundError('Topic');
    expect(toAppError(original)).toBe(original);
  });

  it('wraps a plain Error as a non-exposed internal error', () => {
    const wrapped = toAppError(new TypeError(SECRET));
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.statusCode).toBe(500);
    expect(wrapped.expose).toBe(false);
    expect(wrapped.message).toBe(SECRET);
    expect(wrapped.toClientPayload().message).toBe('An unexpected error occurred.');
  });

  it('wraps a thrown non-Error without letting its content through', () => {
    for (const thrown of [SECRET, 42, null, undefined, { secret: SECRET }]) {
      const wrapped = toAppError(thrown);
      expect(wrapped.code).toBe('INTERNAL_ERROR');
      expect(wrapped.expose).toBe(false);
      expect(JSON.stringify(wrapped.toClientPayload())).not.toContain('hunter2');
    }
  });

  it('keeps the original as the cause for the logs', () => {
    const original = new TypeError('boom');
    expect(toAppError(original).cause).toBe(original);
  });
});

describe('isAppError', () => {
  it('recognises every subclass and rejects everything else', () => {
    expect(isAppError(new ValidationError())).toBe(true);
    expect(isAppError(new LlmProviderError('openai', 'x'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('VALIDATION_ERROR')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError({ code: 'NOT_FOUND', statusCode: 404 })).toBe(false);
  });
});
