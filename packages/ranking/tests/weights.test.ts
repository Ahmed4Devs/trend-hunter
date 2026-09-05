import { describe, expect, it } from 'vitest';

import {
  ARABIC_OPPORTUNITY_TUNING,
  ARABIC_OPPORTUNITY_WEIGHTS,
  ARABIC_OPPORTUNITY_WEIGHT_TOTAL,
  CLASSIFICATION_THRESHOLDS,
  ENGAGEMENT_TUNING,
  RELEVANCE_TUNING,
  RELEVANCE_WEIGHTS_WITHOUT_AI,
  RELEVANCE_WEIGHTS_WITH_AI,
  SATURATION_MAX_IMPACT,
  TREND_TUNING,
  TREND_WEIGHTS,
  TREND_WEIGHT_TOTAL,
} from '../src/weights';

const sumOf = (weights: Readonly<Record<string, number>>): number =>
  Object.values(weights).reduce((total, weight) => total + weight, 0);

describe('trend weights', () => {
  it('sum to exactly one', () => {
    // Not `toBeCloseTo`: these values are chosen to add up exactly, and a
    // future edit that breaks that would silently rescale every trend score.
    expect(TREND_WEIGHT_TOTAL).toBe(1);
    expect(sumOf(TREND_WEIGHTS)).toBe(1);
  });

  it('match the documented split', () => {
    expect(TREND_WEIGHTS).toEqual({
      relevance: 0.3,
      velocity: 0.2,
      freshness: 0.15,
      crossSourceSignal: 0.1,
      sourceAuthority: 0.1,
      novelty: 0.1,
      arabicOpportunity: 0.05,
    });
  });

  it('are all strictly positive, so every component can move the score', () => {
    for (const [name, weight] of Object.entries(TREND_WEIGHTS)) {
      expect(weight, name).toBeGreaterThan(0);
      expect(weight, name).toBeLessThan(1);
    }
  });

  it('cap the saturation penalty at a quarter of the scale', () => {
    expect(SATURATION_MAX_IMPACT).toBe(0.25);
    expect(SATURATION_MAX_IMPACT).toBeGreaterThan(0);
    expect(SATURATION_MAX_IMPACT).toBeLessThan(1);
  });
});

describe('relevance weights', () => {
  it('sum to exactly one in both modes', () => {
    expect(sumOf(RELEVANCE_WEIGHTS_WITH_AI)).toBe(1);
    expect(sumOf(RELEVANCE_WEIGHTS_WITHOUT_AI)).toBe(1);
  });

  it('renormalise the surviving terms in the same proportions when AI is off', () => {
    const scale = 1 / (1 - RELEVANCE_WEIGHTS_WITH_AI.aiClassification);
    expect(RELEVANCE_WEIGHTS_WITHOUT_AI.keyword).toBeCloseTo(
      RELEVANCE_WEIGHTS_WITH_AI.keyword * scale,
      10,
    );
    expect(RELEVANCE_WEIGHTS_WITHOUT_AI.semantic).toBeCloseTo(
      RELEVANCE_WEIGHTS_WITH_AI.semantic * scale,
      10,
    );
    expect(RELEVANCE_WEIGHTS_WITHOUT_AI.sourceQuality).toBeCloseTo(
      RELEVANCE_WEIGHTS_WITH_AI.sourceQuality * scale,
      10,
    );
    expect(RELEVANCE_WEIGHTS_WITHOUT_AI.aiClassification).toBe(0);
  });
});

describe('Arabic opportunity weights', () => {
  it('sum to exactly one', () => {
    expect(ARABIC_OPPORTUNITY_WEIGHT_TOTAL).toBe(1);
    expect(sumOf(ARABIC_OPPORTUNITY_WEIGHTS)).toBe(1);
  });

  it('let volume and scarcity dominate, as the product intends', () => {
    const dominant =
      ARABIC_OPPORTUNITY_WEIGHTS.englishVolume + ARABIC_OPPORTUNITY_WEIGHTS.arabicScarcity;
    expect(dominant).toBeGreaterThanOrEqual(0.6);
  });
});

describe('tuning constants', () => {
  it('keep the saturation volume share inside the unit interval', () => {
    expect(TREND_TUNING.saturationVolumeShare).toBeGreaterThan(0);
    expect(TREND_TUNING.saturationVolumeShare).toBeLessThan(1);
  });

  it('use references that make the log and decay curves meaningful', () => {
    expect(TREND_TUNING.velocityReferenceGrowth).toBeGreaterThan(1);
    expect(TREND_TUNING.freshnessHalfLifeHours).toBeGreaterThan(0);
    expect(TREND_TUNING.noveltyHalfLifeHours).toBeGreaterThan(
      TREND_TUNING.freshnessHalfLifeHours,
    );
    expect(TREND_TUNING.crossSourceReferenceCount).toBeGreaterThanOrEqual(2);
    expect(TREND_TUNING.saturationPostReference).toBeGreaterThan(0);
    expect(TREND_TUNING.saturationAgeReferenceDays).toBeGreaterThan(0);
  });

  it('define an Arabic coverage saturation point inside the unit interval', () => {
    expect(ARABIC_OPPORTUNITY_TUNING.arabicCoverageSaturationRatio).toBeGreaterThan(0);
    expect(ARABIC_OPPORTUNITY_TUNING.arabicCoverageSaturationRatio).toBeLessThan(1);
    expect(ARABIC_OPPORTUNITY_TUNING.englishVolumeReference).toBeGreaterThan(0);
  });

  it('boost titles above bodies without doubling them', () => {
    expect(RELEVANCE_TUNING.titleMatchBoost).toBeGreaterThan(1);
    expect(RELEVANCE_TUNING.semanticFloor).toBeLessThan(RELEVANCE_TUNING.semanticCeiling);
    expect(RELEVANCE_TUNING.keywordSaturation).toBeGreaterThan(0);
  });

  it('rank engagement signals by how much they cost the reader', () => {
    const { weights } = ENGAGEMENT_TUNING;
    expect(weights.reposts).toBeGreaterThan(weights.replies);
    expect(weights.replies).toBeGreaterThan(weights.likes);
    expect(weights.views).toBeLessThan(weights.likes);
    expect(ENGAGEMENT_TUNING.interactionReference).toBeGreaterThan(0);
  });

  it('keep the classification thresholds inside the score scale', () => {
    const { emerging, hiddenGem, saturated } = CLASSIFICATION_THRESHOLDS;
    for (const value of [
      emerging.minVelocity,
      emerging.minFreshness,
      hiddenGem.minRelevance,
      hiddenGem.minArabicOpportunity,
      saturated.minSaturationPenalty,
    ]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(hiddenGem.maxPostCount).toBeLessThanOrEqual(emerging.maxPostCount);
    expect(emerging.minGrowthRatio).toBeGreaterThan(1);
    expect(hiddenGem.minDistinctSources).toBeGreaterThanOrEqual(2);
  });
});
