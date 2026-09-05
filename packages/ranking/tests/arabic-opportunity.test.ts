import { describe, expect, it } from 'vitest';

import {
  calculateArabicOpportunity,
  calculateArabicScarcity,
  type ArabicOpportunityInput,
} from '../src/arabic-opportunity';
import { ARABIC_OPPORTUNITY_TUNING } from '../src/weights';

function opportunityInput(overrides: Partial<ArabicOpportunityInput> = {}): ArabicOpportunityInput {
  return {
    englishPostCount: 200,
    arabicPostCount: 0,
    velocity: 50,
    relevance: 50,
    freshness: 50,
    sourceAuthority: 50,
    ...overrides,
  };
}

describe('calculateArabicScarcity', () => {
  it('is 1 when the topic exists only in English', () => {
    expect(calculateArabicScarcity(500, 0)).toBe(1);
  });

  it('is 0 at the coverage saturation ratio — the gap is considered filled', () => {
    expect(ARABIC_OPPORTUNITY_TUNING.arabicCoverageSaturationRatio).toBe(0.25);
    expect(calculateArabicScarcity(75, 25)).toBe(0);
  });

  it('stays 0 well past the saturation ratio rather than going negative', () => {
    expect(calculateArabicScarcity(50, 50)).toBe(0);
    expect(calculateArabicScarcity(0, 100)).toBe(0);
  });

  it('falls linearly between full and saturated coverage', () => {
    // 10% Arabic coverage is 40% of the way to "covered", so 60% of the gap remains.
    expect(calculateArabicScarcity(90, 10)).toBeCloseTo(0.6, 10);
    expect(calculateArabicScarcity(95, 5)).toBeCloseTo(0.8, 10);
  });

  it('is 0 when there is no discussion at all — an absent topic is not an opportunity', () => {
    expect(calculateArabicScarcity(0, 0)).toBe(0);
  });

  it('treats negative counts as zero', () => {
    expect(calculateArabicScarcity(-10, -10)).toBe(0);
    expect(calculateArabicScarcity(100, -5)).toBe(1);
  });

  it('falls monotonically as Arabic coverage grows', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const arabic of [0, 5, 10, 20, 25, 40, 80]) {
      const value = calculateArabicScarcity(100 - arabic, arabic);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('calculateArabicOpportunity — the product’s worked example', () => {
  const workedExample = calculateArabicOpportunity({
    englishPostCount: 4_900,
    arabicPostCount: 31,
    velocity: 85,
    relevance: 90,
    freshness: 95,
    sourceAuthority: 80,
  });

  it('scores a loud English topic with almost no Arabic coverage in the mid-90s', () => {
    expect(workedExample.arabicOpportunityScore).toBeGreaterThan(93);
    expect(workedExample.arabicOpportunityScore).toBeLessThan(97);
    expect(workedExample.arabicOpportunityScore).toBeCloseTo(94.25, 1);
  });

  it('reports the two dominant components at nearly full strength', () => {
    expect(workedExample.components.englishVolume).toBe(100);
    expect(workedExample.components.arabicScarcity).toBeGreaterThan(97);
  });

  it('echoes the raw counts back for the UI to explain the score', () => {
    expect(workedExample.englishPostCount).toBe(4_900);
    expect(workedExample.arabicPostCount).toBe(31);
  });

  it('scores far lower once a quarter of the discussion is already in Arabic', () => {
    const covered = calculateArabicOpportunity({
      englishPostCount: 4_900,
      arabicPostCount: 1_700,
      velocity: 85,
      relevance: 90,
      freshness: 95,
      sourceAuthority: 80,
    });
    expect(covered.components.arabicScarcity).toBe(0);
    expect(covered.arabicOpportunityScore).toBeLessThan(
      workedExample.arabicOpportunityScore - 25,
    );
    expect(covered.arabicOpportunityScore).toBeCloseTo(65, 1);
  });
});

describe('calculateArabicOpportunity', () => {
  it('is zero when there is nothing to write about', () => {
    const result = calculateArabicOpportunity({
      englishPostCount: 0,
      arabicPostCount: 0,
      velocity: 0,
      relevance: 0,
      freshness: 0,
      sourceAuthority: 0,
    });
    expect(result.arabicOpportunityScore).toBe(0);
  });

  it('is 100 when every factor is maximal', () => {
    const result = calculateArabicOpportunity({
      englishPostCount: ARABIC_OPPORTUNITY_TUNING.englishVolumeReference,
      arabicPostCount: 0,
      velocity: 100,
      relevance: 100,
      freshness: 100,
      sourceAuthority: 100,
    });
    expect(result.arabicOpportunityScore).toBe(100);
  });

  it('maps the volume reference to a full englishVolume component', () => {
    expect(
      calculateArabicOpportunity(
        opportunityInput({ englishPostCount: ARABIC_OPPORTUNITY_TUNING.englishVolumeReference }),
      ).components.englishVolume,
    ).toBe(100);
  });

  it('is logarithmic in English volume: early posts matter far more than late ones', () => {
    const early =
      calculateArabicOpportunity(opportunityInput({ englishPostCount: 20 })).components
        .englishVolume -
      calculateArabicOpportunity(opportunityInput({ englishPostCount: 4 })).components.englishVolume;
    const late =
      calculateArabicOpportunity(opportunityInput({ englishPostCount: 5_000 })).components
        .englishVolume -
      calculateArabicOpportunity(opportunityInput({ englishPostCount: 4_000 })).components
        .englishVolume;
    expect(early).toBeGreaterThan(late);
  });

  it('is modulated downwards by a topic nobody is discussing now', () => {
    const live = calculateArabicOpportunity(opportunityInput({ velocity: 100, freshness: 100 }));
    const dead = calculateArabicOpportunity(opportunityInput({ velocity: 0, freshness: 0 }));
    expect(dead.arabicOpportunityScore).toBeLessThan(live.arabicOpportunityScore);
    expect(live.arabicOpportunityScore - dead.arabicOpportunityScore).toBeCloseTo(20, 1);
  });

  it('is modulated downwards by irrelevance', () => {
    const relevant = calculateArabicOpportunity(opportunityInput({ relevance: 100 }));
    const irrelevant = calculateArabicOpportunity(opportunityInput({ relevance: 0 }));
    expect(relevant.arabicOpportunityScore - irrelevant.arabicOpportunityScore).toBeCloseTo(15, 1);
  });

  it('clamps out-of-range modulators', () => {
    const result = calculateArabicOpportunity(
      opportunityInput({ velocity: 500, relevance: -50, freshness: Number.NaN, sourceAuthority: 900 }),
    );
    expect(result.components.velocity).toBe(100);
    expect(result.components.relevance).toBe(0);
    expect(result.components.freshness).toBe(0);
    expect(result.components.sourceAuthority).toBe(100);
  });

  it('floors and clamps the reported post counts', () => {
    const result = calculateArabicOpportunity(
      opportunityInput({ englishPostCount: 10.9, arabicPostCount: -4 }),
    );
    expect(result.englishPostCount).toBe(10);
    expect(result.arabicPostCount).toBe(0);
  });

  it('keeps every component and the score inside 0..100', () => {
    const inputs = [
      opportunityInput(),
      opportunityInput({ englishPostCount: 0, arabicPostCount: 0 }),
      opportunityInput({ englishPostCount: 1_000_000, arabicPostCount: 1 }),
      opportunityInput({ velocity: -100, relevance: 1_000 }),
    ];
    for (const input of inputs) {
      const result = calculateArabicOpportunity(input);
      for (const value of Object.values(result.components)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(result.arabicOpportunityScore).toBeGreaterThanOrEqual(0);
      expect(result.arabicOpportunityScore).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic', () => {
    const input = opportunityInput({ englishPostCount: 733, arabicPostCount: 17 });
    expect(calculateArabicOpportunity(input)).toEqual(calculateArabicOpportunity(input));
  });

  it('rounds every reported number to two decimal places', () => {
    const result = calculateArabicOpportunity(
      opportunityInput({ englishPostCount: 733, arabicPostCount: 17, velocity: 33.333_333 }),
    );
    const values = [...Object.values(result.components), result.arabicOpportunityScore];
    for (const value of values) {
      expect(value).toBe(Math.round(value * 100) / 100);
    }
  });
});
