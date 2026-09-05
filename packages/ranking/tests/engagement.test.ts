import { describe, expect, it } from 'vitest';

import {
  calculateEngagementScore,
  weightedInteractions,
  type EngagementCounters,
} from '../src/engagement';
import { ENGAGEMENT_TUNING } from '../src/weights';

const ZERO: EngagementCounters = { likes: 0, replies: 0, reposts: 0, views: 0 };

const counters = (overrides: Partial<EngagementCounters> = {}): EngagementCounters => ({
  ...ZERO,
  ...overrides,
});

describe('weightedInteractions', () => {
  it('is zero for an untouched post', () => {
    expect(weightedInteractions(ZERO)).toBe(0);
  });

  it('applies the documented weight to each counter', () => {
    expect(weightedInteractions(counters({ likes: 10 }))).toBe(10);
    expect(weightedInteractions(counters({ replies: 10 }))).toBe(20);
    expect(weightedInteractions(counters({ reposts: 10 }))).toBe(30);
    expect(weightedInteractions(counters({ views: 10_000 }))).toBe(100);
  });

  it('sums the weighted counters', () => {
    expect(weightedInteractions({ likes: 10, replies: 5, reposts: 2, views: 1_000 })).toBe(36);
  });

  it('treats a negative counter as zero rather than subtracting attention', () => {
    expect(weightedInteractions({ likes: -50, replies: -50, reposts: -50, views: -50 })).toBe(0);
    expect(weightedInteractions(counters({ likes: -50, replies: 10 }))).toBe(20);
  });

  it('discounts views far below every other signal', () => {
    const { weights } = ENGAGEMENT_TUNING;
    const viewsWorthOneLike = weights.likes / weights.views;
    expect(weightedInteractions(counters({ views: viewsWorthOneLike }))).toBeCloseTo(
      weightedInteractions(counters({ likes: 1 })),
      10,
    );
  });
});

describe('calculateEngagementScore', () => {
  it('is zero for an untouched post', () => {
    expect(calculateEngagementScore(ZERO)).toBe(0);
  });

  it('is 100 at the interaction reference', () => {
    expect(
      calculateEngagementScore(counters({ likes: ENGAGEMENT_TUNING.interactionReference })),
    ).toBe(100);
  });

  it('is capped at 100 for a runaway post', () => {
    expect(calculateEngagementScore({ likes: 1e6, replies: 1e6, reposts: 1e6, views: 1e9 })).toBe(
      100,
    );
  });

  it('is monotone in each counter', () => {
    const keys: (keyof EngagementCounters)[] = ['likes', 'replies', 'reposts', 'views'];
    for (const key of keys) {
      let previous = -1;
      for (const value of [0, 1, 10, 100, 1_000, 10_000]) {
        const score = calculateEngagementScore(counters({ [key]: value }));
        expect(score, `${key}=${value}`).toBeGreaterThanOrEqual(previous);
        previous = score;
      }
    }
  });

  it('strictly increases for the counters that cost the reader something', () => {
    for (const key of ['likes', 'replies', 'reposts'] as const) {
      expect(calculateEngagementScore(counters({ [key]: 50 }))).toBeGreaterThan(
        calculateEngagementScore(counters({ [key]: 5 })),
      );
    }
  });

  it('ranks a repost above a reply above a like, one for one', () => {
    expect(calculateEngagementScore(counters({ reposts: 100 }))).toBeGreaterThan(
      calculateEngagementScore(counters({ replies: 100 })),
    );
    expect(calculateEngagementScore(counters({ replies: 100 }))).toBeGreaterThan(
      calculateEngagementScore(counters({ likes: 100 })),
    );
  });

  it('scores equal weighted interaction totals equally, whatever their source', () => {
    expect(calculateEngagementScore(counters({ likes: 1 }))).toBe(
      calculateEngagementScore(counters({ views: 100 })),
    );
    expect(calculateEngagementScore(counters({ reposts: 2 }))).toBe(
      calculateEngagementScore(counters({ replies: 3 })),
    );
  });

  it('stays inside the score scale for hostile input', () => {
    const cases: EngagementCounters[] = [
      ZERO,
      { likes: -1, replies: -1, reposts: -1, views: -1 },
      { likes: Number.NaN, replies: 0, reposts: 0, views: 0 },
      { likes: Number.POSITIVE_INFINITY, replies: 0, reposts: 0, views: 0 },
      { likes: 5, replies: 5, reposts: 5, views: 5 },
    ];
    for (const counter of cases) {
      const score = calculateEngagementScore(counter);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('is logarithmic: the same ten likes are worth far less on a popular post', () => {
    const firstTen = calculateEngagementScore(counters({ likes: 10 })) - calculateEngagementScore(ZERO);
    const thousandthTen =
      calculateEngagementScore(counters({ likes: 1_010 })) -
      calculateEngagementScore(counters({ likes: 1_000 }));
    expect(firstTen).toBeGreaterThan(0);
    expect(thousandthTen).toBeGreaterThan(0);
    expect(firstTen).toBeGreaterThan(thousandthTen * 10);
  });

  it('rounds to two decimal places', () => {
    const score = calculateEngagementScore({ likes: 37, replies: 11, reposts: 3, views: 999 });
    expect(score).toBe(Math.round(score * 100) / 100);
  });

  it('is deterministic', () => {
    const input = counters({ likes: 37, replies: 11 });
    expect(calculateEngagementScore(input)).toBe(calculateEngagementScore(input));
  });
});
