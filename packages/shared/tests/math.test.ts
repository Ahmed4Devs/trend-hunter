import { describe, expect, it } from 'vitest';

import {
  centroid,
  clamp,
  clamp01,
  clampScore,
  cosineSimilarity,
  halfLifeDecay,
  logNormalize,
  mean,
  normalizeVector,
  percentageChange,
  percentageOf,
  rescaleSimilarity,
  round,
  sum,
  vectorNorm,
} from '../src/math';

describe('clamp', () => {
  it('passes an in-range value through', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to both bounds', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('collapses non-finite input to the minimum rather than leaking NaN', () => {
    expect(clamp(Number.NaN, 3, 10)).toBe(3);
    expect(clamp(Number.POSITIVE_INFINITY, 3, 10)).toBe(3);
    expect(clamp(Number.NEGATIVE_INFINITY, 3, 10)).toBe(3);
  });

  it('honours the bounds even when they are equal', () => {
    expect(clamp(9, 4, 4)).toBe(4);
  });

  it('clamp01 and clampScore use the documented intervals', () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-0.5)).toBe(0);
    expect(clampScore(120)).toBe(100);
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
  });
});

describe('round', () => {
  it('rounds to the requested number of places', () => {
    expect(round(1.2345, 2)).toBe(1.23);
    expect(round(1.2355, 3)).toBe(1.236);
    expect(round(2.5, 0)).toBe(3);
  });

  it('defaults to two decimal places', () => {
    expect(round(3.14159)).toBe(3.14);
  });

  it('never returns negative zero', () => {
    expect(Object.is(round(-0.001, 2), 0)).toBe(true);
    expect(Object.is(round(-0), 0)).toBe(true);
    expect(Object.is(round(0), 0)).toBe(true);
  });

  it('keeps genuinely negative values negative', () => {
    expect(round(-1.239, 2)).toBe(-1.24);
  });

  it('removes floating point dust', () => {
    expect(round(0.1 + 0.2, 2)).toBe(0.3);
  });

  it('returns zero for non-finite input', () => {
    expect(round(Number.NaN)).toBe(0);
    expect(round(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('mean and sum', () => {
  it('averages and totals a list', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sum([1, 2, 3, 4])).toBe(10);
  });

  it('treats an empty list as zero rather than NaN', () => {
    expect(mean([])).toBe(0);
    expect(sum([])).toBe(0);
  });

  it('ignores non-finite entries instead of poisoning the result', () => {
    expect(sum([1, Number.NaN, 2])).toBe(3);
    expect(mean([1, Number.POSITIVE_INFINITY, 2])).toBe(1);
  });
});

describe('logNormalize', () => {
  it('maps zero to zero and the reference to one', () => {
    expect(logNormalize(0, 100)).toBe(0);
    expect(logNormalize(100, 100)).toBe(1);
  });

  it('is concave: the first items count for far more than the last', () => {
    const early = logNormalize(10, 1_000) - logNormalize(0, 1_000);
    const late = logNormalize(1_000, 1_000) - logNormalize(990, 1_000);
    expect(early).toBeGreaterThan(late);
  });

  it('clamps beyond the reference', () => {
    expect(logNormalize(10_000, 100)).toBe(1);
  });

  it('treats a negative or non-finite count as zero', () => {
    expect(logNormalize(-5, 100)).toBe(0);
    expect(logNormalize(Number.NaN, 100)).toBe(0);
  });

  it('returns zero for a non-positive reference', () => {
    expect(logNormalize(50, 0)).toBe(0);
    expect(logNormalize(50, -1)).toBe(0);
  });
});

describe('halfLifeDecay', () => {
  it('returns one at age zero', () => {
    expect(halfLifeDecay(0, 12)).toBe(1);
  });

  it('returns exactly one half at the half-life', () => {
    expect(halfLifeDecay(12, 12)).toBeCloseTo(0.5, 12);
  });

  it('halves again at each further half-life', () => {
    expect(halfLifeDecay(24, 12)).toBeCloseTo(0.25, 12);
    expect(halfLifeDecay(36, 12)).toBeCloseTo(0.125, 12);
  });

  it('treats a negative age as zero age', () => {
    expect(halfLifeDecay(-10, 12)).toBe(1);
  });

  it('returns zero for a non-positive half-life', () => {
    expect(halfLifeDecay(5, 0)).toBe(0);
    expect(halfLifeDecay(5, -1)).toBe(0);
  });

  it('is monotonically decreasing', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let age = 0; age <= 100; age += 5) {
      const value = halfLifeDecay(age, 12);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('cosineSimilarity', () => {
  it('returns one for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  it('returns one for parallel vectors of different magnitude', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
  });

  it('returns zero for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns minus one for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 12);
  });

  it('returns zero when either vector is the zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('returns zero for mismatched lengths rather than comparing prefixes', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns zero for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('stays inside [-1, 1] for large values', () => {
    const value = cosineSimilarity([1e150, 2e150], [1e150, 2e150]);
    expect(value).toBeLessThanOrEqual(1);
    expect(value).toBeGreaterThanOrEqual(-1);
  });
});

describe('rescaleSimilarity', () => {
  it('maps the floor to zero and the ceiling to one', () => {
    expect(rescaleSimilarity(0.2, 0.2, 0.9)).toBe(0);
    expect(rescaleSimilarity(0.9, 0.2, 0.9)).toBe(1);
  });

  it('maps the midpoint to one half', () => {
    expect(rescaleSimilarity(0.55, 0.2, 0.9)).toBeCloseTo(0.5, 12);
  });

  it('clamps outside the band', () => {
    expect(rescaleSimilarity(-1, 0.2, 0.9)).toBe(0);
    expect(rescaleSimilarity(1, 0.2, 0.9)).toBe(1);
  });

  it('returns zero for a degenerate band', () => {
    expect(rescaleSimilarity(0.5, 0.9, 0.9)).toBe(0);
    expect(rescaleSimilarity(0.5, 0.9, 0.2)).toBe(0);
  });
});

describe('percentageChange', () => {
  it('reports growth and decline', () => {
    expect(percentageChange(150, 100)).toBe(50);
    expect(percentageChange(50, 100)).toBe(-50);
    expect(percentageChange(100, 100)).toBe(0);
  });

  it('is null when the previous value is zero, because the change is undefined', () => {
    expect(percentageChange(10, 0)).toBeNull();
    expect(percentageChange(0, 0)).toBeNull();
  });

  it('uses the absolute previous value so a negative baseline still reads sensibly', () => {
    expect(percentageChange(100, -50)).toBe(300);
  });

  it('is null for non-finite input', () => {
    expect(percentageChange(Number.NaN, 10)).toBeNull();
    expect(percentageChange(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(percentageChange(1, 3)).toBe(-66.7);
  });
});

describe('percentageOf', () => {
  it('computes a share as a percentage', () => {
    expect(percentageOf(25, 100)).toBe(25);
    expect(percentageOf(1, 3)).toBe(33.3);
  });

  it('returns zero for a non-positive or non-finite total', () => {
    expect(percentageOf(5, 0)).toBe(0);
    expect(percentageOf(5, -10)).toBe(0);
    expect(percentageOf(5, Number.NaN)).toBe(0);
  });
});

describe('vector helpers', () => {
  it('computes the Euclidean norm', () => {
    expect(vectorNorm([3, 4])).toBe(5);
    expect(vectorNorm([])).toBe(0);
  });

  it('produces a unit vector', () => {
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
    expect(vectorNorm(normalizeVector([1, 2, 3, 4]))).toBeCloseTo(1, 12);
  });

  it('returns a zero vector unchanged, as a copy', () => {
    const zero = [0, 0, 0];
    const result = normalizeVector(zero);
    expect(result).toEqual(zero);
    expect(result).not.toBe(zero);
  });

  it('averages vectors element-wise', () => {
    expect(centroid([[1, 2], [3, 4]])).toEqual([2, 3]);
  });

  it('returns an empty centroid for no vectors', () => {
    expect(centroid([])).toEqual([]);
  });

  it('skips vectors whose dimensionality does not match the first', () => {
    expect(
      centroid([
        [1, 2],
        [9, 9, 9],
        [3, 4],
      ]),
    ).toEqual([2, 3]);
  });

  it('returns the zero vector when every candidate was skipped', () => {
    expect(centroid([[], [1]])).toEqual([]);
  });
});
