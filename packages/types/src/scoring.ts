/**
 * Score component contracts.
 *
 * Every score the platform produces is decomposed into named, inspectable
 * components. Nothing in the system may persist only a final score: the UI, the
 * reports and the tests all read the individual components so that a ranking
 * decision can always be explained to the user.
 *
 * All component values use the same closed interval:
 *
 *     0 (no signal)  ..  100 (maximum signal)
 */

/** Inclusive lower bound of every score and score component. */
export const SCORE_MIN = 0;
/** Inclusive upper bound of every score and score component. */
export const SCORE_MAX = 100;

/**
 * The weighted components of {@link TrendScoreBreakdown.trendScore}.
 *
 * Weights are declared once in `@trendhunter/ranking` and always sum to 1.
 */
export interface TrendScoreComponents {
  /** How well the topic matches the user's configured interests. */
  readonly relevance: number;
  /** Rate of change of post volume compared with the preceding window. */
  readonly velocity: number;
  /** Recency of the most recent post attached to the topic. */
  readonly freshness: number;
  /** Breadth of independent sources discussing the topic. */
  readonly crossSourceSignal: number;
  /** Engagement-weighted authority of the sources involved. */
  readonly sourceAuthority: number;
  /** How new the topic itself is, independent of its posts. */
  readonly novelty: number;
  /** Head-room for Arabic content on this topic. */
  readonly arabicOpportunity: number;
}

/** The full, inspectable result of one trend evaluation. */
export interface TrendScoreBreakdown {
  readonly components: TrendScoreComponents;
  /**
   * Raw saturation signal (0..100). It is *not* one of the weighted components:
   * it is subtracted from the weighted sum after being scaled by the engine's
   * saturation impact factor.
   */
  readonly saturationPenalty: number;
  /** Weighted sum of {@link TrendScoreComponents} before the saturation penalty. */
  readonly weightedScore: number;
  /** Final, clamped trend score. */
  readonly trendScore: number;
}

/** The inspectable components behind a post's relevance score. */
export interface RelevanceScoreComponents {
  /** Weighted interest-keyword matches found in the text. */
  readonly keyword: number;
  /** Cosine similarity between the content embedding and the interest profile. */
  readonly semantic: number;
  /** Static quality/authority weight configured for the source. */
  readonly sourceQuality: number;
  /**
   * Optional LLM classification confidence. `null` when AI classification is
   * disabled, in which case the remaining weights are renormalised.
   */
  readonly aiClassification: number | null;
}

export interface RelevanceScoreBreakdown {
  readonly components: RelevanceScoreComponents;
  /** Interest ids that contributed, strongest first. */
  readonly matchedInterestIds: readonly string[];
  /** Keywords that matched, strongest first. */
  readonly matchedKeywords: readonly string[];
  readonly relevanceScore: number;
}

/** The inspectable components behind an Arabic opportunity score. */
export interface ArabicOpportunityComponents {
  /** How much English-language discussion exists (demand proxy). */
  readonly englishVolume: number;
  /** How little Arabic coverage exists relative to the English volume. */
  readonly arabicScarcity: number;
  /** Current trend velocity of the topic. */
  readonly velocity: number;
  /** Relevance of the topic to the user's interests. */
  readonly relevance: number;
  /** Recency of the discussion. */
  readonly freshness: number;
  /** Authority of the sources involved. */
  readonly sourceAuthority: number;
}

export interface ArabicOpportunityBreakdown {
  readonly components: ArabicOpportunityComponents;
  readonly englishPostCount: number;
  readonly arabicPostCount: number;
  readonly arabicOpportunityScore: number;
}

/** Machine-readable justification for a classification decision. */
export const TOPIC_SIGNAL_REASONS = [
  'HIGH_VELOCITY',
  'LOW_VOLUME',
  'RECENT_FIRST_DETECTION',
  'MULTI_SOURCE_CONFIRMATION',
  'HIGH_RELEVANCE',
  'ARABIC_GAP',
  'HIGH_SATURATION',
  'STALE_ACTIVITY',
  'SINGLE_SOURCE_ONLY',
] as const;
export type TopicSignalReason = (typeof TOPIC_SIGNAL_REASONS)[number];

/**
 * Why the engine assigned a classification. `detail` values are numeric facts
 * (e.g. the observed growth ratio) so the UI can render an explanation without
 * re-deriving anything.
 */
export interface TopicSignalExplanation {
  readonly reason: TopicSignalReason;
  readonly detail: Readonly<Record<string, number>>;
}
