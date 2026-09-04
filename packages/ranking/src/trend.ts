import {
  clamp01,
  clampScore,
  daysBetween,
  halfLifeDecay,
  hoursBetween,
  logNormalize,
  round,
} from '@trendhunter/shared';
import type { TrendScoreBreakdown, TrendScoreComponents } from '@trendhunter/types';

import { SATURATION_MAX_IMPACT, TREND_TUNING, TREND_WEIGHTS } from './weights';

/**
 * The trend detection engine.
 *
 * Deterministic by design: given the same topic statistics and the same `now`,
 * it always produces the same score. That is what makes trend snapshots
 * comparable over time and what lets the engine be unit-tested exhaustively.
 *
 * Every component is computed and returned separately. Nothing in the system
 * stores only the final number.
 */

export interface TrendInput {
  /** Posts attached to the topic in the most recent velocity window. */
  readonly recentPostCount: number;
  /** Posts attached in the window immediately before that one. */
  readonly previousPostCount: number;
  /** Total posts attached to the topic. */
  readonly totalPostCount: number;
  /** Distinct sources the topic has appeared on. */
  readonly distinctSourceCount: number;
  /** 0..100 relevance of the topic to the user's interests. */
  readonly relevance: number;
  /** 0..100 mean engagement-weighted authority of the sources involved. */
  readonly sourceAuthority: number;
  /** 0..100 Arabic opportunity score for the topic. */
  readonly arabicOpportunity: number;
  readonly firstDetectedAt: Date;
  readonly lastPostAt: Date;
  readonly now: Date;
}

/**
 * Growth ratio between the two most recent windows.
 *
 * Both counts are incremented by one before the division, which keeps the ratio
 * finite when a topic is brand new (0 previous posts) and stops a jump from
 * one post to two from registering as infinite growth.
 */
export function calculateGrowthRatio(recentCount: number, previousCount: number): number {
  const recent = Math.max(0, recentCount);
  const previous = Math.max(0, previousCount);
  return (recent + 1) / (previous + 1);
}

/**
 * Velocity: how fast the conversation is accelerating, on a log scale so that
 * growth from 2 to 10 posts scores like growth from 200 to 1 000.
 */
export function calculateVelocity(recentCount: number, previousCount: number): number {
  const ratio = calculateGrowthRatio(recentCount, previousCount);
  if (ratio <= 1) return 0;
  const normalized = Math.log(ratio) / Math.log(TREND_TUNING.velocityReferenceGrowth);
  return clampScore(clamp01(normalized) * 100);
}

/** Freshness: exponential decay from the age of the most recent post. */
export function calculateFreshness(lastPostAt: Date, now: Date): number {
  const ageHours = Math.max(0, hoursBetween(lastPostAt, now));
  return clampScore(halfLifeDecay(ageHours, TREND_TUNING.freshnessHalfLifeHours) * 100);
}

/** Novelty: exponential decay from the age of the topic itself. */
export function calculateNovelty(firstDetectedAt: Date, now: Date): number {
  const ageHours = Math.max(0, hoursBetween(firstDetectedAt, now));
  return clampScore(halfLifeDecay(ageHours, TREND_TUNING.noveltyHalfLifeHours) * 100);
}

/**
 * Cross-source signal: a story confirmed on four independent sources is a real
 * story. One source is worth nothing on this axis, which is exactly the point —
 * it is what separates a trend from a single loud account.
 */
export function calculateCrossSourceSignal(distinctSourceCount: number): number {
  const distinct = Math.max(0, Math.floor(distinctSourceCount));
  if (distinct <= 1) return 0;
  const normalized =
    Math.log2(distinct) / Math.log2(Math.max(2, TREND_TUNING.crossSourceReferenceCount));
  return clampScore(clamp01(normalized) * 100);
}

/**
 * Saturation: how thoroughly the topic has already been covered.
 *
 * Combines sheer volume with how long the topic has been running, because a
 * topic that collected 300 posts in an hour is still worth writing about while
 * one that collected 300 over three weeks is not.
 */
export function calculateSaturationPenalty(input: {
  readonly totalPostCount: number;
  readonly firstDetectedAt: Date;
  readonly now: Date;
}): number {
  const volumeFactor = logNormalize(input.totalPostCount, TREND_TUNING.saturationPostReference);
  const ageDays = Math.max(0, daysBetween(input.firstDetectedAt, input.now));
  const ageFactor = clamp01(ageDays / TREND_TUNING.saturationAgeReferenceDays);
  const combined =
    volumeFactor * TREND_TUNING.saturationVolumeShare +
    ageFactor * (1 - TREND_TUNING.saturationVolumeShare);
  return clampScore(combined * 100);
}

/**
 * Computes the trend score and every component behind it.
 *
 * The saturation penalty is applied after the weighted sum and scaled by
 * {@link SATURATION_MAX_IMPACT}, so it can shift a score by at most a quarter
 * of the scale.
 */
export function calculateTrendScore(input: TrendInput): TrendScoreBreakdown {
  const components: TrendScoreComponents = {
    relevance: clampScore(input.relevance),
    velocity: calculateVelocity(input.recentPostCount, input.previousPostCount),
    freshness: calculateFreshness(input.lastPostAt, input.now),
    crossSourceSignal: calculateCrossSourceSignal(input.distinctSourceCount),
    sourceAuthority: clampScore(input.sourceAuthority),
    novelty: calculateNovelty(input.firstDetectedAt, input.now),
    arabicOpportunity: clampScore(input.arabicOpportunity),
  };

  const weightedScore =
    components.relevance * TREND_WEIGHTS.relevance +
    components.velocity * TREND_WEIGHTS.velocity +
    components.freshness * TREND_WEIGHTS.freshness +
    components.crossSourceSignal * TREND_WEIGHTS.crossSourceSignal +
    components.sourceAuthority * TREND_WEIGHTS.sourceAuthority +
    components.novelty * TREND_WEIGHTS.novelty +
    components.arabicOpportunity * TREND_WEIGHTS.arabicOpportunity;

  const saturationPenalty = calculateSaturationPenalty({
    totalPostCount: input.totalPostCount,
    firstDetectedAt: input.firstDetectedAt,
    now: input.now,
  });

  const trendScore = clampScore(weightedScore - saturationPenalty * SATURATION_MAX_IMPACT);

  return {
    components: {
      relevance: round(components.relevance, 2),
      velocity: round(components.velocity, 2),
      freshness: round(components.freshness, 2),
      crossSourceSignal: round(components.crossSourceSignal, 2),
      sourceAuthority: round(components.sourceAuthority, 2),
      novelty: round(components.novelty, 2),
      arabicOpportunity: round(components.arabicOpportunity, 2),
    },
    saturationPenalty: round(saturationPenalty, 2),
    weightedScore: round(weightedScore, 2),
    trendScore: round(trendScore, 2),
  };
}
