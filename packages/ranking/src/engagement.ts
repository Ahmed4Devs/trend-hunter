import { clampScore, logNormalize, round } from '@trendhunter/shared';

import { ENGAGEMENT_TUNING } from './weights';

/**
 * Normalised engagement.
 *
 * Raw counters are not comparable across sources — a Hacker News story with 300
 * points and an X post with 300 likes represent very different amounts of
 * attention — so every post is reduced to one 0..100 signal built from
 * weighted interactions on a logarithmic curve.
 */

export interface EngagementCounters {
  readonly likes: number;
  readonly replies: number;
  readonly reposts: number;
  readonly views: number;
}

/**
 * Weighted interaction total. Replies and reposts count for more than likes
 * because they cost the reader more, and views are discounted heavily because
 * they are cheap and only some providers report them.
 */
export function weightedInteractions(counters: EngagementCounters): number {
  const { weights } = ENGAGEMENT_TUNING;
  return (
    Math.max(0, counters.likes) * weights.likes +
    Math.max(0, counters.replies) * weights.replies +
    Math.max(0, counters.reposts) * weights.reposts +
    Math.max(0, counters.views) * weights.views
  );
}

/** Maps raw counters onto the platform-wide 0..100 engagement scale. */
export function calculateEngagementScore(counters: EngagementCounters): number {
  const interactions = weightedInteractions(counters);
  const normalized = logNormalize(interactions, ENGAGEMENT_TUNING.interactionReference);
  return round(clampScore(normalized * 100), 2);
}
