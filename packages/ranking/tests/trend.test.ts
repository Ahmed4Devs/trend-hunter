import { describe, expect, it } from 'vitest';

import {
  calculateCrossSourceSignal,
  calculateFreshness,
  calculateGrowthRatio,
  calculateNovelty,
  calculateSaturationPenalty,
  calculateTrendScore,
  calculateVelocity,
  type TrendInput,
} from '../src/trend';
import { SATURATION_MAX_IMPACT, TREND_TUNING } from '../src/weights';

const NOW = new Date('2026-03-15T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * HOUR);
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

function trendInput(overrides: Partial<TrendInput> = {}): TrendInput {
  return {
    recentPostCount: 4,
    previousPostCount: 4,
    totalPostCount: 20,
    distinctSourceCount: 2,
    relevance: 50,
    sourceAuthority: 50,
    arabicOpportunity: 50,
    firstDetectedAt: hoursAgo(6),
    lastPostAt: hoursAgo(1),
    now: NOW,
    ...overrides,
  };
}

describe('calculateGrowthRatio', () => {
  it('is one when nothing changed, including from nothing to nothing', () => {
    expect(calculateGrowthRatio(0, 0)).toBe(1);
    expect(calculateGrowthRatio(7, 7)).toBe(1);
  });

  it('adds one to each side so a brand new topic never divides by zero', () => {
    expect(calculateGrowthRatio(9, 0)).toBe(10);
    expect(Number.isFinite(calculateGrowthRatio(1_000, 0))).toBe(true);
  });

  it('damps the jump from one post to two', () => {
    expect(calculateGrowthRatio(2, 1)).toBe(1.5);
  });

  it('reports decline as a ratio below one', () => {
    expect(calculateGrowthRatio(1, 9)).toBe(0.2);
    expect(calculateGrowthRatio(0, 9)).toBe(0.1);
  });

  it('treats negative counts as zero', () => {
    expect(calculateGrowthRatio(-5, -5)).toBe(1);
    expect(calculateGrowthRatio(-5, 4)).toBe(0.2);
  });
});

describe('calculateVelocity', () => {
  it('is zero when there is no growth at all', () => {
    expect(calculateVelocity(0, 0)).toBe(0);
    expect(calculateVelocity(10, 10)).toBe(0);
  });

  it('is zero when the conversation is shrinking', () => {
    expect(calculateVelocity(1, 50)).toBe(0);
  });

  it('is exactly 100 at the reference growth', () => {
    // (9 + 1) / (1 + 1) = 5, the documented reference ratio.
    expect(TREND_TUNING.velocityReferenceGrowth).toBe(5);
    expect(calculateVelocity(9, 1)).toBeCloseTo(100, 10);
  });

  it('stays at 100 beyond the reference growth', () => {
    expect(calculateVelocity(99, 1)).toBe(100);
    expect(calculateVelocity(100_000, 0)).toBe(100);
  });

  it('is on a log scale: equal ratios score equally at any magnitude', () => {
    // 1 -> 3 posts and 100 -> 302 posts are both a ratio of 2.
    expect(calculateVelocity(3, 1)).toBeCloseTo(calculateVelocity(301, 150), 6);
  });

  it('rises monotonically with the recent count', () => {
    let previous = -1;
    for (const recent of [0, 1, 2, 4, 8, 16, 32]) {
      const value = calculateVelocity(recent, 4);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('stays inside the score scale', () => {
    for (const [recent, previous] of [
      [0, 0],
      [1, 0],
      [1_000_000, 1],
      [-10, -10],
    ] as const) {
      const value = calculateVelocity(recent, previous);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('calculateFreshness', () => {
  it('is 100 for a post that has just arrived', () => {
    expect(calculateFreshness(NOW, NOW)).toBe(100);
  });

  it('is exactly 50 at one half-life', () => {
    expect(calculateFreshness(hoursAgo(TREND_TUNING.freshnessHalfLifeHours), NOW)).toBeCloseTo(
      50,
      10,
    );
  });

  it('halves again at each further half-life', () => {
    expect(calculateFreshness(hoursAgo(24), NOW)).toBeCloseTo(25, 10);
    expect(calculateFreshness(hoursAgo(36), NOW)).toBeCloseTo(12.5, 10);
  });

  it('treats a clock skew into the future as brand new rather than going above 100', () => {
    expect(calculateFreshness(new Date(NOW.getTime() + 5 * HOUR), NOW)).toBe(100);
  });

  it('approaches but never reaches zero', () => {
    const value = calculateFreshness(daysAgo(30), NOW);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(0.01);
  });
});

describe('calculateNovelty', () => {
  it('is 100 for a topic detected this instant', () => {
    expect(calculateNovelty(NOW, NOW)).toBe(100);
  });

  it('is exactly 50 at one half-life', () => {
    expect(calculateNovelty(hoursAgo(TREND_TUNING.noveltyHalfLifeHours), NOW)).toBeCloseTo(50, 10);
  });

  it('decays more slowly than freshness, because a topic outlives a post', () => {
    expect(calculateNovelty(hoursAgo(12), NOW)).toBeGreaterThan(calculateFreshness(hoursAgo(12), NOW));
  });

  it('treats a future detection time as brand new', () => {
    expect(calculateNovelty(new Date(NOW.getTime() + HOUR), NOW)).toBe(100);
  });
});

describe('calculateCrossSourceSignal', () => {
  it('is zero for a single source — one loud account is not a trend', () => {
    expect(calculateCrossSourceSignal(1)).toBe(0);
    expect(calculateCrossSourceSignal(0)).toBe(0);
    expect(calculateCrossSourceSignal(-3)).toBe(0);
  });

  it('is 100 at the reference number of distinct sources', () => {
    expect(TREND_TUNING.crossSourceReferenceCount).toBe(4);
    expect(calculateCrossSourceSignal(4)).toBeCloseTo(100, 10);
  });

  it('is 50 at two sources, halfway on the log2 scale', () => {
    expect(calculateCrossSourceSignal(2)).toBeCloseTo(50, 10);
  });

  it('clamps beyond the reference', () => {
    expect(calculateCrossSourceSignal(8)).toBe(100);
    expect(calculateCrossSourceSignal(500)).toBe(100);
  });

  it('floors a fractional count', () => {
    expect(calculateCrossSourceSignal(2.9)).toBe(calculateCrossSourceSignal(2));
  });

  it('rises monotonically', () => {
    let previous = -1;
    for (let sources = 0; sources <= 10; sources += 1) {
      const value = calculateCrossSourceSignal(sources);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('calculateSaturationPenalty', () => {
  it('barely touches a young, low-volume topic', () => {
    const penalty = calculateSaturationPenalty({
      totalPostCount: 3,
      firstDetectedAt: hoursAgo(6),
      now: NOW,
    });
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(20);
  });

  it('is zero for a topic with no posts detected this instant', () => {
    expect(calculateSaturationPenalty({ totalPostCount: 0, firstDetectedAt: NOW, now: NOW })).toBe(
      0,
    );
  });

  it('is 100 for an old, thoroughly covered topic', () => {
    expect(
      calculateSaturationPenalty({
        totalPostCount: TREND_TUNING.saturationPostReference,
        firstDetectedAt: daysAgo(TREND_TUNING.saturationAgeReferenceDays),
        now: NOW,
      }),
    ).toBeCloseTo(100, 10);
    expect(
      calculateSaturationPenalty({ totalPostCount: 50_000, firstDetectedAt: daysAgo(90), now: NOW }),
    ).toBe(100);
  });

  it('separates a burst from a slow grind at the same volume', () => {
    const burst = calculateSaturationPenalty({
      totalPostCount: 300,
      firstDetectedAt: NOW,
      now: NOW,
    });
    const grind = calculateSaturationPenalty({
      totalPostCount: 300,
      firstDetectedAt: daysAgo(21),
      now: NOW,
    });
    expect(grind).toBeGreaterThan(burst);
    expect(grind - burst).toBeCloseTo((1 - TREND_TUNING.saturationVolumeShare) * 100, 6);
  });

  it('weights volume above age, as documented', () => {
    const volumeOnly = calculateSaturationPenalty({
      totalPostCount: TREND_TUNING.saturationPostReference,
      firstDetectedAt: NOW,
      now: NOW,
    });
    const ageOnly = calculateSaturationPenalty({
      totalPostCount: 0,
      firstDetectedAt: daysAgo(TREND_TUNING.saturationAgeReferenceDays),
      now: NOW,
    });
    expect(volumeOnly).toBeCloseTo(TREND_TUNING.saturationVolumeShare * 100, 6);
    expect(ageOnly).toBeCloseTo((1 - TREND_TUNING.saturationVolumeShare) * 100, 6);
  });

  it('ignores a first-detection time in the future', () => {
    expect(
      calculateSaturationPenalty({
        totalPostCount: 0,
        firstDetectedAt: new Date(NOW.getTime() + DAY),
        now: NOW,
      }),
    ).toBe(0);
  });
});

describe('calculateTrendScore', () => {
  it('is deterministic for the same input and instant', () => {
    const input = trendInput();
    expect(calculateTrendScore(input)).toEqual(calculateTrendScore(input));
  });

  it('reaches exactly 100 when every component is maximal and nothing is saturated', () => {
    const breakdown = calculateTrendScore(
      trendInput({
        relevance: 100,
        sourceAuthority: 100,
        arabicOpportunity: 100,
        recentPostCount: 9,
        previousPostCount: 1,
        distinctSourceCount: 4,
        totalPostCount: 0,
        firstDetectedAt: NOW,
        lastPostAt: NOW,
      }),
    );
    expect(breakdown.components).toEqual({
      relevance: 100,
      velocity: 100,
      freshness: 100,
      crossSourceSignal: 100,
      sourceAuthority: 100,
      novelty: 100,
      arabicOpportunity: 100,
    });
    expect(breakdown.weightedScore).toBe(100);
    expect(breakdown.saturationPenalty).toBe(0);
    expect(breakdown.trendScore).toBe(100);
  });

  it('never goes below zero, even when the penalty exceeds the weighted sum', () => {
    const breakdown = calculateTrendScore(
      trendInput({
        relevance: 0,
        sourceAuthority: 0,
        arabicOpportunity: 0,
        recentPostCount: 0,
        previousPostCount: 500,
        distinctSourceCount: 1,
        totalPostCount: 100_000,
        firstDetectedAt: daysAgo(120),
        lastPostAt: daysAgo(120),
      }),
    );
    expect(breakdown.saturationPenalty).toBe(100);
    expect(breakdown.trendScore).toBe(0);
  });

  it('clamps out-of-range inputs into the score scale', () => {
    const breakdown = calculateTrendScore(
      trendInput({ relevance: 500, sourceAuthority: -20, arabicOpportunity: Number.NaN }),
    );
    expect(breakdown.components.relevance).toBe(100);
    expect(breakdown.components.sourceAuthority).toBe(0);
    expect(breakdown.components.arabicOpportunity).toBe(0);
  });

  it('lets the saturation penalty remove at most the documented share of the scale', () => {
    const cases: Partial<TrendInput>[] = [
      { totalPostCount: 0, firstDetectedAt: NOW },
      { totalPostCount: 50, firstDetectedAt: daysAgo(2) },
      { totalPostCount: 400, firstDetectedAt: daysAgo(14) },
      { totalPostCount: 10_000, firstDetectedAt: daysAgo(60) },
    ];
    for (const overrides of cases) {
      const breakdown = calculateTrendScore(
        trendInput({ relevance: 100, sourceAuthority: 100, arabicOpportunity: 100, ...overrides }),
      );
      const drop = breakdown.weightedScore - breakdown.trendScore;
      expect(drop).toBeGreaterThanOrEqual(-0.01);
      expect(drop).toBeLessThanOrEqual(SATURATION_MAX_IMPACT * 100 + 0.01);
      expect(drop).toBeCloseTo(breakdown.saturationPenalty * SATURATION_MAX_IMPACT, 1);
    }
  });

  it('keeps the score and every component inside 0..100', () => {
    const cases: Partial<TrendInput>[] = [
      {},
      { relevance: 0, sourceAuthority: 0, arabicOpportunity: 0 },
      { recentPostCount: 0, previousPostCount: 0, distinctSourceCount: 0 },
      { lastPostAt: daysAgo(365), firstDetectedAt: daysAgo(400), totalPostCount: 9_000 },
      { relevance: 100, sourceAuthority: 100, arabicOpportunity: 100, distinctSourceCount: 99 },
    ];
    for (const overrides of cases) {
      const breakdown = calculateTrendScore(trendInput(overrides));
      for (const value of Object.values(breakdown.components)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(breakdown.trendScore).toBeGreaterThanOrEqual(0);
      expect(breakdown.trendScore).toBeLessThanOrEqual(100);
      expect(breakdown.saturationPenalty).toBeGreaterThanOrEqual(0);
      expect(breakdown.saturationPenalty).toBeLessThanOrEqual(100);
    }
  });

  it('rounds every reported number to two decimal places', () => {
    const breakdown = calculateTrendScore(trendInput({ relevance: 33.333_333 }));
    const reported = [
      ...Object.values(breakdown.components),
      breakdown.saturationPenalty,
      breakdown.weightedScore,
      breakdown.trendScore,
    ];
    for (const value of reported) {
      expect(value).toBe(Math.round(value * 100) / 100);
    }
  });

  it('reports the weighted sum before the penalty, not after', () => {
    const breakdown = calculateTrendScore(
      trendInput({ totalPostCount: 5_000, firstDetectedAt: daysAgo(30) }),
    );
    expect(breakdown.weightedScore).toBeGreaterThan(breakdown.trendScore);
  });

  it('responds to each component in the direction and proportion of its weight', () => {
    const base = calculateTrendScore(
      trendInput({ relevance: 0, sourceAuthority: 0, arabicOpportunity: 0 }),
    );
    const withRelevance = calculateTrendScore(
      trendInput({ relevance: 100, sourceAuthority: 0, arabicOpportunity: 0 }),
    );
    const withArabic = calculateTrendScore(
      trendInput({ relevance: 0, sourceAuthority: 0, arabicOpportunity: 100 }),
    );
    expect(withRelevance.trendScore - base.trendScore).toBeCloseTo(30, 1);
    expect(withArabic.trendScore - base.trendScore).toBeCloseTo(5, 1);
  });
});
