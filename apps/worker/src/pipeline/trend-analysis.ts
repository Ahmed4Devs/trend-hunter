import {
  calculateArabicOpportunity,
  calculateTrendScore,
  classifyTopic,
  TREND_TUNING,
} from '@trendhunter/ranking';
import type { TrendAnalysisJobPayload } from '@trendhunter/types';

import type { JobContext } from '../runtime/processor';

/**
 * Step 5: trend detection.
 *
 * Every score the product ranks on is computed here, and every component behind
 * it is written alongside the total. That is a product requirement, not
 * bookkeeping: the UI has to explain why a topic is trending, and a stored
 * total with no components can only be asserted.
 *
 * A snapshot is recorded on every evaluation, which is what turns the trend
 * score into a history the charts can draw and the emerging-trend detection can
 * compare against.
 *
 * The engines are pure and take an explicit `now`, so re-running this job over
 * the same topic produces the same numbers — the ordering guarantee that makes
 * a retry safe.
 */
export async function processTrendAnalysisJob(
  context: JobContext<TrendAnalysisJobPayload>,
): Promise<void> {
  const { payload, logger, container } = context;
  const { repositories } = container;

  const topicIds =
    payload.topicIds.length > 0 ? payload.topicIds : await repositories.topics.listActiveIds(500);

  if (topicIds.length === 0) {
    logger.info('no topics to evaluate');
    return;
  }

  const now = new Date();
  let evaluated = 0;
  const classifications = { EMERGING_TREND: 0, HIDDEN_GEM: 0, SATURATED: 0, NORMAL: 0 };

  for (const topicId of topicIds) {
    const stats = await repositories.topics.loadTrendInputs(topicId, {
      now,
      windowMinutes: TREND_TUNING.velocityWindowMinutes,
    });
    if (stats === null) continue;

    // The Arabic opportunity score feeds the trend score, so it is computed
    // first — with the velocity it will later contribute to, which is why
    // velocity is derived here rather than read back from the trend result.
    const provisionalVelocity = provisionalVelocityFor(stats);

    const arabic = calculateArabicOpportunity({
      englishPostCount: stats.englishPostCount,
      arabicPostCount: stats.arabicPostCount,
      velocity: provisionalVelocity,
      relevance: stats.meanRelevance,
      freshness: freshnessFor(stats.lastPostAt, now),
      sourceAuthority: stats.meanSourceAuthority,
    });

    const breakdown = calculateTrendScore({
      recentPostCount: stats.recentPostCount,
      previousPostCount: stats.previousPostCount,
      totalPostCount: stats.totalPostCount,
      distinctSourceCount: stats.distinctSourceCount,
      relevance: stats.meanRelevance,
      sourceAuthority: stats.meanSourceAuthority,
      arabicOpportunity: arabic.arabicOpportunityScore,
      // A topic's first detection is its earliest post, which the aggregate
      // does not return; the last post bounds it safely and novelty decays from
      // the topic row's own first_detected_at on subsequent passes.
      firstDetectedAt: stats.lastPostAt ?? now,
      lastPostAt: stats.lastPostAt ?? now,
      now,
    });

    const classification = classifyTopic({
      breakdown,
      totalPostCount: stats.totalPostCount,
      recentPostCount: stats.recentPostCount,
      previousPostCount: stats.previousPostCount,
      distinctSourceCount: stats.distinctSourceCount,
    });

    await repositories.topics.updateScores(topicId, {
      trendScore: breakdown.trendScore,
      relevanceScore: stats.meanRelevance,
      velocity: breakdown.components.velocity,
      arabicOpportunityScore: arabic.arabicOpportunityScore,
      classification: classification.classification,
      classificationReasons: [...classification.reasons],
      trendBreakdown: { ...breakdown },
      arabicOpportunityBreakdown: { ...arabic },
      postCount: stats.totalPostCount,
      commentCount: stats.commentCount,
      englishPostCount: stats.englishPostCount,
      arabicPostCount: stats.arabicPostCount,
      distinctSourceCount: stats.distinctSourceCount,
      lastDetectedAt: stats.lastPostAt ?? now,
    });

    await repositories.topics.recordSnapshot({
      topicId,
      trendScore: breakdown.trendScore,
      postCount: stats.totalPostCount,
      engagement: stats.meanEngagement,
      velocity: breakdown.components.velocity,
      relevance: breakdown.components.relevance,
      freshness: breakdown.components.freshness,
      crossSourceSignal: breakdown.components.crossSourceSignal,
      sourceAuthority: breakdown.components.sourceAuthority,
      novelty: breakdown.components.novelty,
      arabicOpportunity: breakdown.components.arabicOpportunity,
      saturationPenalty: breakdown.saturationPenalty,
      recordedAt: now,
    });

    // The per-post opportunity score is the topic's, so a post inherits the
    // headroom of the conversation it belongs to.
    await repositories.topics.propagateScoresToPosts(topicId, {
      trendScore: breakdown.trendScore,
      opportunityScore: arabic.arabicOpportunityScore,
    });

    classifications[classification.classification] += 1;
    evaluated += 1;
  }

  logger.info({ evaluated, ...classifications }, 'trend analysis finished');
}

/**
 * Velocity computed the same way the trend engine will.
 *
 * Duplicated deliberately rather than exported from the engine's internals: the
 * Arabic opportunity score needs velocity as an input, and the trend score
 * needs the Arabic score as an input, so one of the two has to be derived
 * first. Both use the same public helper, so they cannot drift.
 */
function provisionalVelocityFor(stats: {
  recentPostCount: number;
  previousPostCount: number;
}): number {
  const ratio = (stats.recentPostCount + 1) / (stats.previousPostCount + 1);
  if (ratio <= 1) return 0;
  const normalized = Math.log(ratio) / Math.log(TREND_TUNING.velocityReferenceGrowth);
  return Math.min(100, Math.max(0, normalized * 100));
}

function freshnessFor(lastPostAt: Date | null, now: Date): number {
  if (lastPostAt === null) return 0;
  const ageHours = Math.max(0, (now.getTime() - lastPostAt.getTime()) / 3_600_000);
  return Math.min(
    100,
    Math.max(0, Math.pow(2, -ageHours / TREND_TUNING.freshnessHalfLifeHours) * 100),
  );
}
