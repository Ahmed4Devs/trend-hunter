import { describe, expect, it } from 'vitest';

import type { TopicSignalReason, TrendScoreBreakdown, TrendScoreComponents } from '@trendhunter/types';

import {
  classifyTopic,
  growthPercentage,
  type ClassificationInput,
} from '../src/classification';
import { CLASSIFICATION_THRESHOLDS } from '../src/weights';

const { emerging, hiddenGem, saturated } = CLASSIFICATION_THRESHOLDS;

function breakdown(
  components: Partial<TrendScoreComponents>,
  saturationPenalty = 0,
): TrendScoreBreakdown {
  return {
    components: {
      relevance: 0,
      velocity: 0,
      freshness: 0,
      crossSourceSignal: 0,
      sourceAuthority: 0,
      novelty: 0,
      arabicOpportunity: 0,
      ...components,
    },
    saturationPenalty,
    weightedScore: 0,
    trendScore: 0,
  };
}

const reasonsOf = (input: ClassificationInput): TopicSignalReason[] =>
  classifyTopic(input).reasons.map((reason) => reason.reason);

/** A topic that clears every emerging-trend threshold. */
const EMERGING: ClassificationInput = {
  breakdown: breakdown({ velocity: 80, freshness: 90, novelty: 95, arabicOpportunity: 10 }),
  totalPostCount: 18,
  recentPostCount: 11,
  previousPostCount: 2,
  distinctSourceCount: 3,
};

/** A topic that clears every hidden-gem threshold. */
const HIDDEN_GEM: ClassificationInput = {
  breakdown: breakdown({ relevance: 82, arabicOpportunity: 91, velocity: 10, freshness: 40 }),
  totalPostCount: 12,
  recentPostCount: 3,
  previousPostCount: 2,
  distinctSourceCount: 3,
};

describe('classifyTopic — SATURATED', () => {
  it('labels a thoroughly covered topic and explains why', () => {
    const result = classifyTopic({
      ...EMERGING,
      breakdown: breakdown({ velocity: 80, freshness: 90 }, 84),
      totalPostCount: 900,
    });
    expect(result.classification).toBe('SATURATED');
    expect(result.reasons).toEqual([
      {
        reason: 'HIGH_SATURATION',
        detail: {
          saturationPenalty: 84,
          threshold: saturated.minSaturationPenalty,
          totalPostCount: 900,
        },
      },
    ]);
  });

  it('takes precedence over both other classifications', () => {
    const emergingButSaturated = classifyTopic({
      ...EMERGING,
      breakdown: breakdown(EMERGING.breakdown.components, saturated.minSaturationPenalty),
    });
    expect(emergingButSaturated.classification).toBe('SATURATED');

    const gemButSaturated: ClassificationInput = {
      ...HIDDEN_GEM,
      breakdown: breakdown(HIDDEN_GEM.breakdown.components, 95),
    };
    expect(classifyTopic(gemButSaturated).classification).toBe('SATURATED');
    expect(reasonsOf(gemButSaturated)).toEqual(['HIGH_SATURATION']);
  });

  it('triggers exactly at the threshold and not just below it', () => {
    const at = classifyTopic({
      ...EMERGING,
      breakdown: breakdown(EMERGING.breakdown.components, saturated.minSaturationPenalty),
    });
    const below = classifyTopic({
      ...EMERGING,
      breakdown: breakdown(EMERGING.breakdown.components, saturated.minSaturationPenalty - 0.01),
    });
    expect(at.classification).toBe('SATURATED');
    expect(below.classification).not.toBe('SATURATED');
  });
});

describe('classifyTopic — HIDDEN_GEM', () => {
  it('labels a relevant, multi-source, low-volume Arabic gap', () => {
    const result = classifyTopic(HIDDEN_GEM);
    expect(result.classification).toBe('HIDDEN_GEM');
    expect(reasonsOf(HIDDEN_GEM)).toEqual([
      'ARABIC_GAP',
      'HIGH_RELEVANCE',
      'MULTI_SOURCE_CONFIRMATION',
      'LOW_VOLUME',
    ]);
  });

  it('reports the observed numbers alongside the thresholds that were cleared', () => {
    const [arabicGap, highRelevance, multiSource, lowVolume] = classifyTopic(HIDDEN_GEM).reasons;
    expect(arabicGap?.detail).toEqual({
      arabicOpportunity: 91,
      threshold: hiddenGem.minArabicOpportunity,
    });
    expect(highRelevance?.detail).toEqual({
      relevance: 82,
      threshold: hiddenGem.minRelevance,
    });
    expect(multiSource?.detail).toEqual({
      distinctSourceCount: 3,
      threshold: hiddenGem.minDistinctSources,
    });
    expect(lowVolume?.detail).toEqual({ totalPostCount: 12, threshold: hiddenGem.maxPostCount });
  });

  it('accepts values exactly on every threshold', () => {
    const result = classifyTopic({
      breakdown: breakdown({
        relevance: hiddenGem.minRelevance,
        arabicOpportunity: hiddenGem.minArabicOpportunity,
      }),
      totalPostCount: hiddenGem.maxPostCount,
      recentPostCount: 1,
      previousPostCount: 1,
      distinctSourceCount: hiddenGem.minDistinctSources,
    });
    expect(result.classification).toBe('HIDDEN_GEM');
  });

  it('is refused when any single condition fails', () => {
    const failures: Partial<ClassificationInput>[] = [
      { breakdown: breakdown({ relevance: 59, arabicOpportunity: 91 }) },
      { breakdown: breakdown({ relevance: 82, arabicOpportunity: 69 }) },
      { totalPostCount: hiddenGem.maxPostCount + 1 },
      { distinctSourceCount: 1 },
    ];
    for (const failure of failures) {
      expect(classifyTopic({ ...HIDDEN_GEM, ...failure }).classification).not.toBe('HIDDEN_GEM');
    }
  });

  it('outranks an emerging trend when a topic qualifies as both', () => {
    const both: ClassificationInput = {
      breakdown: breakdown({
        relevance: 90,
        arabicOpportunity: 95,
        velocity: 90,
        freshness: 90,
        novelty: 95,
      }),
      totalPostCount: 15,
      recentPostCount: 11,
      previousPostCount: 2,
      distinctSourceCount: 3,
    };
    expect(classifyTopic(both).classification).toBe('HIDDEN_GEM');
  });
});

describe('classifyTopic — EMERGING_TREND', () => {
  it('labels a small, fast-accelerating topic', () => {
    const result = classifyTopic(EMERGING);
    expect(result.classification).toBe('EMERGING_TREND');
    expect(reasonsOf(EMERGING)).toEqual([
      'HIGH_VELOCITY',
      'LOW_VOLUME',
      'RECENT_FIRST_DETECTION',
      'MULTI_SOURCE_CONFIRMATION',
    ]);
  });

  it('reports the growth ratio that produced the label', () => {
    const [highVelocity] = classifyTopic(EMERGING).reasons;
    expect(highVelocity?.detail).toEqual({
      velocity: 80,
      growthRatio: 4,
      threshold: emerging.minVelocity,
    });
  });

  it('omits the multi-source reason when only one source has the story', () => {
    const single = { ...EMERGING, distinctSourceCount: 1 };
    expect(classifyTopic(single).classification).toBe('EMERGING_TREND');
    expect(reasonsOf(single)).toEqual([
      'HIGH_VELOCITY',
      'LOW_VOLUME',
      'RECENT_FIRST_DETECTION',
    ]);
  });

  it('accepts values exactly on every threshold', () => {
    const result = classifyTopic({
      breakdown: breakdown({
        velocity: emerging.minVelocity,
        freshness: emerging.minFreshness,
      }),
      totalPostCount: emerging.maxPostCount,
      // (5 + 1) / (2 + 1) = 2, exactly the minimum growth ratio.
      recentPostCount: 5,
      previousPostCount: 2,
      distinctSourceCount: 1,
    });
    expect(result.classification).toBe('EMERGING_TREND');
  });

  it('is refused when any single condition fails', () => {
    const failures: Partial<ClassificationInput>[] = [
      { breakdown: breakdown({ velocity: 59, freshness: 90 }) },
      { breakdown: breakdown({ velocity: 80, freshness: 49 }) },
      { totalPostCount: emerging.maxPostCount + 1 },
      { recentPostCount: 2, previousPostCount: 2 },
    ];
    for (const failure of failures) {
      expect(classifyTopic({ ...EMERGING, ...failure }).classification).not.toBe('EMERGING_TREND');
    }
  });

  it('is refused for a high-velocity topic that is already large', () => {
    expect(
      classifyTopic({ ...EMERGING, totalPostCount: 500 }).classification,
    ).toBe('NORMAL');
  });
});

describe('classifyTopic — NORMAL', () => {
  it('labels an ordinary topic with no reasons when nothing is remarkable', () => {
    const result = classifyTopic({
      breakdown: breakdown({ relevance: 40, velocity: 10, freshness: 80, arabicOpportunity: 20 }),
      totalPostCount: 120,
      recentPostCount: 5,
      previousPostCount: 5,
      distinctSourceCount: 3,
    });
    expect(result.classification).toBe('NORMAL');
    expect(result.reasons).toEqual([]);
  });

  it('explains a single-source topic', () => {
    const input: ClassificationInput = {
      breakdown: breakdown({ freshness: 90 }),
      totalPostCount: 120,
      recentPostCount: 1,
      previousPostCount: 1,
      distinctSourceCount: 1,
    };
    expect(classifyTopic(input).classification).toBe('NORMAL');
    expect(reasonsOf(input)).toEqual(['SINGLE_SOURCE_ONLY']);
    expect(classifyTopic(input).reasons[0]?.detail).toEqual({ distinctSourceCount: 1 });
  });

  it('explains a stale topic', () => {
    const input: ClassificationInput = {
      breakdown: breakdown({ freshness: 12.345 }),
      totalPostCount: 120,
      recentPostCount: 1,
      previousPostCount: 1,
      distinctSourceCount: 4,
    };
    expect(reasonsOf(input)).toEqual(['STALE_ACTIVITY']);
    expect(classifyTopic(input).reasons[0]?.detail).toEqual({
      freshness: 12.35,
      threshold: emerging.minFreshness,
    });
  });

  it('reports both reasons when a topic is stale and alone', () => {
    const input: ClassificationInput = {
      breakdown: breakdown({ freshness: 5 }),
      totalPostCount: 120,
      recentPostCount: 0,
      previousPostCount: 0,
      distinctSourceCount: 0,
    };
    expect(reasonsOf(input)).toEqual(['SINGLE_SOURCE_ONLY', 'STALE_ACTIVITY']);
  });
});

describe('classifyTopic — general contract', () => {
  it('is deterministic', () => {
    expect(classifyTopic(EMERGING)).toEqual(classifyTopic(EMERGING));
  });

  it('always returns one of the four documented labels', () => {
    const inputs = [EMERGING, HIDDEN_GEM, { ...EMERGING, totalPostCount: 9_000 }];
    for (const input of inputs) {
      expect(['NORMAL', 'EMERGING_TREND', 'HIDDEN_GEM', 'SATURATED']).toContain(
        classifyTopic(input).classification,
      );
    }
  });

  it('only ever reports numeric detail values, so the UI never has to parse strings', () => {
    for (const input of [EMERGING, HIDDEN_GEM]) {
      for (const reason of classifyTopic(input).reasons) {
        for (const value of Object.values(reason.detail)) {
          expect(typeof value).toBe('number');
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });
});

describe('growthPercentage', () => {
  it('is zero when nothing changed', () => {
    expect(growthPercentage(0, 0)).toBe(0);
    expect(growthPercentage(7, 7)).toBe(0);
  });

  it('reports a doubling as +100%', () => {
    expect(growthPercentage(5, 2)).toBe(100);
  });

  it('reports a collapse as a negative percentage', () => {
    expect(growthPercentage(0, 9)).toBe(-90);
  });

  it('is finite for a brand new topic', () => {
    expect(growthPercentage(99, 0)).toBe(9_900);
  });

  it('rounds to one decimal place', () => {
    expect(growthPercentage(1, 2)).toBe(-33.3);
  });
});
