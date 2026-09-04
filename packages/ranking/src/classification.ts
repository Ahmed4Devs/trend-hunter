import { round } from '@trendhunter/shared';
import type {
  TopicClassification,
  TopicSignalExplanation,
  TrendScoreBreakdown,
} from '@trendhunter/types';

import { calculateGrowthRatio } from './trend';
import { CLASSIFICATION_THRESHOLDS } from './weights';

/**
 * Topic classification.
 *
 * A high trend score alone is not interesting — the loudest topic of the day is
 * usually the one everybody has already written about. These classifications
 * pick out the two cases the product exists to surface:
 *
 *  - **EMERGING_TREND** — small but accelerating hard. Caught early enough to
 *    still be first.
 *  - **HIDDEN_GEM** — relevant, confirmed by several sources, and almost
 *    untouched in Arabic.
 *
 * Every decision returns its reasons with the numbers that produced them, so
 * the UI can show *why* a topic was flagged rather than asking the user to
 * trust a label.
 */

export interface ClassificationInput {
  readonly breakdown: TrendScoreBreakdown;
  readonly totalPostCount: number;
  readonly recentPostCount: number;
  readonly previousPostCount: number;
  readonly distinctSourceCount: number;
}

export interface ClassificationResult {
  readonly classification: TopicClassification;
  readonly reasons: readonly TopicSignalExplanation[];
}

export function classifyTopic(input: ClassificationInput): ClassificationResult {
  const { components, saturationPenalty } = input.breakdown;
  const growthRatio = calculateGrowthRatio(input.recentPostCount, input.previousPostCount);
  const thresholds = CLASSIFICATION_THRESHOLDS;

  const reasons: TopicSignalExplanation[] = [];

  // Saturation is checked first: a topic that has already been covered to death
  // cannot simultaneously be an early find, whatever its velocity says.
  if (saturationPenalty >= thresholds.saturated.minSaturationPenalty) {
    reasons.push({
      reason: 'HIGH_SATURATION',
      detail: {
        saturationPenalty: round(saturationPenalty, 2),
        threshold: thresholds.saturated.minSaturationPenalty,
        totalPostCount: input.totalPostCount,
      },
    });
    return { classification: 'SATURATED', reasons };
  }

  const isHiddenGem =
    components.relevance >= thresholds.hiddenGem.minRelevance &&
    components.arabicOpportunity >= thresholds.hiddenGem.minArabicOpportunity &&
    input.totalPostCount <= thresholds.hiddenGem.maxPostCount &&
    input.distinctSourceCount >= thresholds.hiddenGem.minDistinctSources;

  if (isHiddenGem) {
    reasons.push(
      {
        reason: 'ARABIC_GAP',
        detail: {
          arabicOpportunity: round(components.arabicOpportunity, 2),
          threshold: thresholds.hiddenGem.minArabicOpportunity,
        },
      },
      {
        reason: 'HIGH_RELEVANCE',
        detail: {
          relevance: round(components.relevance, 2),
          threshold: thresholds.hiddenGem.minRelevance,
        },
      },
      {
        reason: 'MULTI_SOURCE_CONFIRMATION',
        detail: {
          distinctSourceCount: input.distinctSourceCount,
          threshold: thresholds.hiddenGem.minDistinctSources,
        },
      },
      {
        reason: 'LOW_VOLUME',
        detail: {
          totalPostCount: input.totalPostCount,
          threshold: thresholds.hiddenGem.maxPostCount,
        },
      },
    );
    return { classification: 'HIDDEN_GEM', reasons };
  }

  const isEmerging =
    components.velocity >= thresholds.emerging.minVelocity &&
    components.freshness >= thresholds.emerging.minFreshness &&
    growthRatio >= thresholds.emerging.minGrowthRatio &&
    input.totalPostCount <= thresholds.emerging.maxPostCount;

  if (isEmerging) {
    reasons.push(
      {
        reason: 'HIGH_VELOCITY',
        detail: {
          velocity: round(components.velocity, 2),
          growthRatio: round(growthRatio, 2),
          threshold: thresholds.emerging.minVelocity,
        },
      },
      {
        reason: 'LOW_VOLUME',
        detail: {
          totalPostCount: input.totalPostCount,
          threshold: thresholds.emerging.maxPostCount,
        },
      },
      {
        reason: 'RECENT_FIRST_DETECTION',
        detail: {
          novelty: round(components.novelty, 2),
          freshness: round(components.freshness, 2),
        },
      },
    );
    if (input.distinctSourceCount >= 2) {
      reasons.push({
        reason: 'MULTI_SOURCE_CONFIRMATION',
        detail: { distinctSourceCount: input.distinctSourceCount, threshold: 2 },
      });
    }
    return { classification: 'EMERGING_TREND', reasons };
  }

  // Nothing special: still record why, so the topic page can explain the
  // absence of a badge rather than showing an empty panel.
  if (input.distinctSourceCount <= 1) {
    reasons.push({
      reason: 'SINGLE_SOURCE_ONLY',
      detail: { distinctSourceCount: input.distinctSourceCount },
    });
  }
  if (components.freshness < thresholds.emerging.minFreshness) {
    reasons.push({
      reason: 'STALE_ACTIVITY',
      detail: {
        freshness: round(components.freshness, 2),
        threshold: thresholds.emerging.minFreshness,
      },
    });
  }

  return { classification: 'NORMAL', reasons };
}

/** Percentage growth of the recent window over the previous one, for display. */
export function growthPercentage(recentCount: number, previousCount: number): number {
  return round((calculateGrowthRatio(recentCount, previousCount) - 1) * 100, 1);
}
