import { clamp01, clampScore, logNormalize, round } from '@trendhunter/shared';
import type {
  ArabicOpportunityBreakdown,
  ArabicOpportunityComponents,
} from '@trendhunter/types';

import { ARABIC_OPPORTUNITY_TUNING, ARABIC_OPPORTUNITY_WEIGHTS } from './weights';

/**
 * The Arabic opportunity score.
 *
 * It answers a single editorial question: *is this topic loud in English and
 * quiet in Arabic?* A high score marks a topic the user could cover in Arabic
 * before anyone else does.
 *
 * Two factors dominate by design:
 *
 *  - `englishVolume` — proxy for demand. Logarithmic, so the difference between
 *    20 and 200 English posts matters far more than between 4 000 and 5 000.
 *  - `arabicScarcity` — how far the Arabic share is below the point where the
 *    topic counts as covered. Once a quarter of the discussion is already in
 *    Arabic, the gap is considered filled and this factor is 0.
 *
 * The remaining factors (velocity, relevance, freshness, source authority) only
 * modulate the result: a topic nobody is talking about *now*, or one that has
 * nothing to do with the user's interests, is not an opportunity worth chasing.
 */

export interface ArabicOpportunityInput {
  readonly englishPostCount: number;
  readonly arabicPostCount: number;
  /** 0..100 trend velocity of the topic. */
  readonly velocity: number;
  /** 0..100 relevance of the topic to the user's interests. */
  readonly relevance: number;
  /** 0..100 freshness of the topic's most recent post. */
  readonly freshness: number;
  /** 0..100 authority of the sources discussing the topic. */
  readonly sourceAuthority: number;
}

/**
 * Share of the discussion that already exists in Arabic, mapped so that 0 means
 * "fully covered" and 1 means "no Arabic coverage at all".
 */
export function calculateArabicScarcity(englishCount: number, arabicCount: number): number {
  const english = Math.max(0, englishCount);
  const arabic = Math.max(0, arabicCount);
  const total = english + arabic;
  if (total === 0) return 0;

  const coverage = arabic / total;
  return clamp01(1 - coverage / ARABIC_OPPORTUNITY_TUNING.arabicCoverageSaturationRatio);
}

export function calculateArabicOpportunity(
  input: ArabicOpportunityInput,
): ArabicOpportunityBreakdown {
  const englishVolume = logNormalize(
    input.englishPostCount,
    ARABIC_OPPORTUNITY_TUNING.englishVolumeReference,
  );
  const arabicScarcity = calculateArabicScarcity(input.englishPostCount, input.arabicPostCount);
  const velocity = clamp01(input.velocity / 100);
  const relevance = clamp01(input.relevance / 100);
  const freshness = clamp01(input.freshness / 100);
  const sourceAuthority = clamp01(input.sourceAuthority / 100);

  const weighted =
    englishVolume * ARABIC_OPPORTUNITY_WEIGHTS.englishVolume +
    arabicScarcity * ARABIC_OPPORTUNITY_WEIGHTS.arabicScarcity +
    velocity * ARABIC_OPPORTUNITY_WEIGHTS.velocity +
    relevance * ARABIC_OPPORTUNITY_WEIGHTS.relevance +
    freshness * ARABIC_OPPORTUNITY_WEIGHTS.freshness +
    sourceAuthority * ARABIC_OPPORTUNITY_WEIGHTS.sourceAuthority;

  const components: ArabicOpportunityComponents = {
    englishVolume: round(englishVolume * 100, 2),
    arabicScarcity: round(arabicScarcity * 100, 2),
    velocity: round(velocity * 100, 2),
    relevance: round(relevance * 100, 2),
    freshness: round(freshness * 100, 2),
    sourceAuthority: round(sourceAuthority * 100, 2),
  };

  return {
    components,
    englishPostCount: Math.max(0, Math.floor(input.englishPostCount)),
    arabicPostCount: Math.max(0, Math.floor(input.arabicPostCount)),
    arabicOpportunityScore: round(clampScore(weighted * 100), 2),
  };
}
