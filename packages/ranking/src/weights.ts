/**
 * Every tunable constant of the ranking engines, in one place.
 *
 * The engines themselves contain no numeric literals: a change in ranking
 * behaviour is always a change to this file, which makes the behaviour
 * reviewable and lets the unit tests assert the weights sum correctly.
 */

/**
 * Trend score weights.
 *
 *   TrendScore = 30% Relevance
 *              + 20% Velocity
 *              + 15% Freshness
 *              + 10% CrossSourceSignal
 *              + 10% SourceAuthority
 *              + 10% Novelty
 *              +  5% ArabicOpportunity
 *              -  SaturationPenalty
 */
export const TREND_WEIGHTS = {
  relevance: 0.3,
  velocity: 0.2,
  freshness: 0.15,
  crossSourceSignal: 0.1,
  sourceAuthority: 0.1,
  novelty: 0.1,
  arabicOpportunity: 0.05,
} as const;

/**
 * How many points the saturation penalty may remove at most.
 *
 * The penalty is a 0..100 signal like every other component, but it is not one
 * of the weighted terms: it is scaled by this factor and subtracted from the
 * weighted sum. A quarter of the scale is enough to push a saturated topic out
 * of the trending list without ever driving a genuinely relevant topic to zero.
 */
export const SATURATION_MAX_IMPACT = 0.25;

/** Relevance score weights when AI classification is enabled. */
export const RELEVANCE_WEIGHTS_WITH_AI = {
  keyword: 0.35,
  semantic: 0.35,
  sourceQuality: 0.1,
  aiClassification: 0.2,
} as const;

/**
 * Relevance weights when AI classification is disabled — the remaining three
 * terms renormalised so the score still spans the full 0..100 range.
 */
export const RELEVANCE_WEIGHTS_WITHOUT_AI = {
  keyword: 0.4375,
  semantic: 0.4375,
  sourceQuality: 0.125,
  aiClassification: 0,
} as const;

/** Arabic opportunity weights. */
export const ARABIC_OPPORTUNITY_WEIGHTS = {
  englishVolume: 0.3,
  arabicScarcity: 0.3,
  velocity: 0.15,
  relevance: 0.15,
  freshness: 0.05,
  sourceAuthority: 0.05,
} as const;

/** Tuning constants for the individual trend components. */
export const TREND_TUNING = {
  /**
   * Growth ratio between two consecutive windows that maps velocity to 100.
   * A topic whose post rate quintupled is as fast as the scale goes.
   */
  velocityReferenceGrowth: 5,
  /** Length of the window whose growth velocity measures, in minutes. */
  velocityWindowMinutes: 60,
  /** Hours after which freshness has halved. */
  freshnessHalfLifeHours: 12,
  /** Hours after which novelty has halved, measured from first detection. */
  noveltyHalfLifeHours: 48,
  /** Number of distinct sources that maps cross-source signal to 100. */
  crossSourceReferenceCount: 4,
  /** Post count at which the saturation signal reaches 100. */
  saturationPostReference: 400,
  /** Days of continuous activity at which the age term of saturation peaks. */
  saturationAgeReferenceDays: 14,
  /** Relative weight of volume vs age inside the saturation signal. */
  saturationVolumeShare: 0.7,
} as const;

/** Tuning constants for the Arabic opportunity score. */
export const ARABIC_OPPORTUNITY_TUNING = {
  /** English post count that maps the volume factor to 1. */
  englishVolumeReference: 200,
  /**
   * Share of Arabic posts at which the Arabic side counts as fully covered.
   * Above this ratio the scarcity factor is 0 — the gap has been filled.
   */
  arabicCoverageSaturationRatio: 0.25,
} as const;

/** Tuning constants for the relevance engine. */
export const RELEVANCE_TUNING = {
  /**
   * Weighted keyword hits that map the keyword factor to 1. Four solid matches
   * are treated as a complete keyword signal.
   */
  keywordSaturation: 4,
  /** Extra multiplier for a keyword found in a title rather than the body. */
  titleMatchBoost: 1.5,
  /** Cosine similarity mapped to 0 on the semantic factor. */
  semanticFloor: 0.2,
  /** Cosine similarity mapped to 1 on the semantic factor. */
  semanticCeiling: 0.85,
} as const;

/** Thresholds used to classify a topic. */
export const CLASSIFICATION_THRESHOLDS = {
  emerging: {
    minVelocity: 60,
    minFreshness: 50,
    minGrowthRatio: 2,
    maxPostCount: 60,
  },
  hiddenGem: {
    minRelevance: 60,
    minArabicOpportunity: 70,
    maxPostCount: 40,
    minDistinctSources: 2,
  },
  saturated: {
    minSaturationPenalty: 70,
  },
} as const;

/** Engagement normalisation references, per source. */
export const ENGAGEMENT_TUNING = {
  /** Interaction total that maps the engagement score to 100. */
  interactionReference: 2_000,
  /** Weight applied to each raw counter before they are summed. */
  weights: {
    likes: 1,
    replies: 2,
    reposts: 3,
    /** Views are plentiful and weak, so they are discounted heavily. */
    views: 0.01,
  },
} as const;

/** Compile-time-ish guard: the trend weights must describe a full unit. */
export const TREND_WEIGHT_TOTAL = Object.values(TREND_WEIGHTS).reduce(
  (total, weight) => total + weight,
  0,
);

export const ARABIC_OPPORTUNITY_WEIGHT_TOTAL = Object.values(ARABIC_OPPORTUNITY_WEIGHTS).reduce(
  (total, weight) => total + weight,
  0,
);
