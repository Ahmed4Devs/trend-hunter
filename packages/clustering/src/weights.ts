/**
 * Every tunable constant of the clustering engine, in one place.
 *
 * Same rule as `@trendhunter/ranking`: the algorithms below contain no numeric
 * literals, so a change in clustering behaviour is always a reviewable change
 * to this file — and the thresholds can be quoted verbatim when explaining an
 * assignment to a user.
 */

/**
 * Weights of the textual agreement between a post and a topic.
 *
 * The embedding carries most of the decision because it is the only signal that
 * survives paraphrasing across sources ("releases" / "launched" / "announces").
 * The two lexical signals exist to catch the cases embeddings are weakest at:
 * brand-new product names the model has never seen, and headlines short enough
 * that the vector is dominated by their template rather than their subject.
 *
 * Whenever a signal is unavailable — no embedding yet, or neither side carries
 * a capitalised entity — its weight is redistributed over the remaining ones so
 * the composite still spans the full 0..1 range instead of quietly capping.
 */
export const SIMILARITY_WEIGHTS = {
  embedding: 0.55,
  tokenOverlap: 0.25,
  entityOverlap: 0.2,
} as const;

export const SIMILARITY_WEIGHT_TOTAL = Object.values(SIMILARITY_WEIGHTS).reduce(
  (total, weight) => total + weight,
  0,
);

export const SIMILARITY_TUNING = {
  /** Cosine similarity mapped to 0 on the embedding component. */
  embeddingFloor: 0.45,
  /** Cosine similarity mapped to 1 on the embedding component. */
  embeddingCeiling: 0.92,
  /**
   * Share of the token component taken by the headline-to-topic Jaccard; the
   * remainder measures how much of the topic's vocabulary the post's *body*
   * contains, which is what lets a discussion thread ("Thoughts about ...?")
   * join a topic named after a news headline.
   */
  headlineJaccardShare: 0.65,
  /**
   * Share of the entity component taken by the Jaccard; the remainder is
   * containment over the smaller set. Containment carries the larger share
   * because the two sides are not symmetric: a topic accumulates the names of
   * every post that joined it, and the fourth report of a launch mentions a
   * subset of them, not all of them.
   */
  entityJaccardShare: 0.35,
  /** Hours of separation after which the time proximity signal has halved. */
  timeProximityHalfLifeHours: 24,
  /**
   * Floor of the multiplier that time proximity applies to textual agreement.
   *
   * Time is a gate rather than a weighted term: two posts three days apart are
   * usually two events, however similar the wording, and an additive term could
   * never express that. The floor keeps the gate from erasing a strong textual
   * match outright, so the decision stays visible in the reported components.
   */
  timeGateFloor: 0.4,
  /** Characters of body text read when building a token profile. */
  maxProfileCharacters: 4_000,
  /** Decimals kept on every reported component, so comparisons are stable. */
  precision: 4,
} as const;

/** Defaults for {@link assignToTopic}. */
export const CLUSTER_DEFAULTS = {
  /** Composite similarity a post must reach to join an existing topic. */
  assignmentThreshold: 0.62,
  /**
   * Similarity band inside which two candidate topics count as tied. Ties are
   * broken towards the more established topic (and towards the post's current
   * topic on a re-run) rather than by input order, which is what stops a
   * re-clustering pass from shuffling posts between near-identical topics.
   */
  stickinessMargin: 0.05,
  /**
   * Hardest refusal in the engine: a post this far outside a topic's activity
   * window is never merged into it, whatever the text says. Without it a
   * weekly recurring headline ("OpenAI ships ...") would collapse into one
   * permanent topic and the velocity signal would stop meaning anything.
   */
  maxTimeGapHours: 72,
} as const;

/** Defaults for the duplicate detectors. */
export const DEDUPLICATION_DEFAULTS = {
  /**
   * Raw cosine similarity above which two posts are considered the same text.
   * Deliberately far higher than the clustering threshold: this decides whether
   * a record is *dropped*, not merely grouped.
   */
  nearDuplicateSimilarity: 0.97,
  /**
   * Syndication window. A wire story is republished within hours; the same
   * sentence appearing a week later is a retrospective, not a duplicate.
   */
  nearDuplicateWindowHours: 12,
} as const;

/** Tuning for the topic name derivation. */
export const TOPIC_NAME_TUNING = {
  /** Hard ceiling on a derived topic name, truncated on a word boundary. */
  maxLength: 80,
  /** Below this, a cleaned headline is treated as having lost its meaning. */
  minUsefulLength: 12,
  /** Headline length band that reads best as a topic name. */
  idealMinLength: 20,
  idealMaxLength: 90,
  /** Words a trailing " - The Verge" style attribution may contain. */
  maxAttributionWords: 4,
  /** Words a headline must keep after an attribution is stripped. */
  minRetainedWords: 3,
  /** Passes of boilerplate stripping, for stacked tags like "[D] PSA: ...". */
  maxStripPasses: 3,
  /** Weights of the headline selection heuristic. */
  weights: {
    sourceAuthority: 0.45,
    lengthFit: 0.3,
    engagement: 0.25,
  },
  /**
   * Multiplier for a headline phrased as a question. A question is a prompt for
   * a discussion, not a statement of what happened, so it loses to a news
   * headline about the same event whenever one is available.
   */
  questionPenalty: 0.6,
  /** Multiplier for a name recovered from body text because no title existed. */
  contentFallbackPenalty: 0.4,
} as const;
