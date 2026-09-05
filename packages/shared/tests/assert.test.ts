import { describe, expect, it } from 'vitest';

import { assertNever, invariant, isDefined, isOneOf } from '../src/assert';
import { AppError } from '../src/errors';

describe('invariant', () => {
  it('passes for any truthy value', () => {
    for (const value of [true, 1, 'x', [], {}]) {
      expect(() => {
        invariant(value, 'should hold');
      }).not.toThrow();
    }
  });

  it('throws a non-exposed internal error for any falsy value', () => {
    for (const value of [false, 0, '', null, undefined, Number.NaN]) {
      let caught: unknown;
      try {
        invariant(value, 'topic must exist');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppError);
      const error = caught as AppError;
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.expose).toBe(false);
      expect(error.message).toContain('topic must exist');
      expect(error.toClientPayload().message).not.toContain('topic must exist');
    }
  });

  it('narrows the type for the caller', () => {
    const value: string | null = 'present';
    invariant(value, 'value must be present');
    expect(value.length).toBe(7);
  });
});

describe('assertNever', () => {
  it('always throws a non-exposed internal error naming the context', () => {
    // The value only reaches here when a union gained a variant at runtime,
    // which is exactly the situation the guard exists to report.
    const rogue = 'UNKNOWN_KIND' as never;
    let caught: unknown;
    try {
      assertNever(rogue, 'source kind');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    const error = caught as AppError;
    expect(error.message).toContain('source kind');
    expect(error.message).toContain('UNKNOWN_KIND');
    expect(error.expose).toBe(false);
  });

  it('falls back to a generic context', () => {
    expect(() => assertNever(1 as never)).toThrow(/Unhandled value/);
  });
});

describe('isDefined', () => {
  it('rejects only null and undefined', () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined('')).toBe(true);
    expect(isDefined(false)).toBe(true);
    expect(isDefined(null)).toBe(false);
    expect(isDefined(undefined)).toBe(false);
  });

  it('works as an array filter that narrows', () => {
    const values: (string | null)[] = ['a', null, 'b'];
    const defined: string[] = values.filter(isDefined);
    expect(defined).toEqual(['a', 'b']);
  });
});

describe('isOneOf', () => {
  const kinds = ['X', 'REDDIT', 'RSS'] as const;

  it('accepts a member and rejects everything else', () => {
    expect(isOneOf('REDDIT', kinds)).toBe(true);
    expect(isOneOf('reddit', kinds)).toBe(false);
    expect(isOneOf('', kinds)).toBe(false);
    expect(isOneOf('TIKTOK', kinds)).toBe(false);
  });

  it('narrows without a cast', () => {
    const raw = 'RSS';
    if (isOneOf(raw, kinds)) {
      const narrowed: (typeof kinds)[number] = raw;
      expect(narrowed).toBe('RSS');
    } else {
      expect.unreachable('RSS is a member of the allow-list');
    }
  });
});
