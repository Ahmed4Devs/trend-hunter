import {
  clamp01,
  clampScore,
  cosineSimilarity,
  rescaleSimilarity,
  round,
  tokenize,
} from '@trendhunter/shared';
import type { RelevanceScoreBreakdown, RelevanceScoreComponents } from '@trendhunter/types';

import {
  RELEVANCE_TUNING,
  RELEVANCE_WEIGHTS_WITH_AI,
  RELEVANCE_WEIGHTS_WITHOUT_AI,
} from './weights';

/**
 * The relevance engine.
 *
 * Answers "how much does this piece of content matter to *this* user?" by
 * combining four independent signals. Every signal is reported separately so
 * the post detail page can explain the number instead of just showing it.
 */

export interface InterestKeywordInput {
  readonly keyword: string;
  /** 0..1 weight of the keyword inside its interest. */
  readonly weight: number;
}

export interface InterestInput {
  readonly id: string;
  readonly name: string;
  /** 0..1 weight of the whole interest. */
  readonly weight: number;
  readonly enabled: boolean;
  readonly keywords: readonly InterestKeywordInput[];
  /**
   * Centroid embedding of the interest, when embeddings are available. Used for
   * the semantic term; omitted interests simply contribute nothing to it.
   */
  readonly embedding?: readonly number[];
}

export interface RelevanceInput {
  readonly title: string | null;
  readonly content: string;
  /** Embedding of the post, when the embeddings job has already run. */
  readonly embedding?: readonly number[] | undefined;
  /** 0..1 authority weight configured for the source. */
  readonly sourceAuthorityWeight: number;
  /**
   * 0..1 confidence from the LLM classifier, or `null` when AI classification
   * is disabled. When `null` the remaining weights are renormalised.
   */
  readonly aiConfidence: number | null;
  readonly interests: readonly InterestInput[];
}

interface KeywordMatch {
  readonly interestId: string;
  readonly keyword: string;
  readonly contribution: number;
}

/**
 * Scores keyword presence.
 *
 * A keyword matches when every one of its tokens is present in the text; that
 * makes multi-word keywords such as "AI Agents" or "vector database" behave
 * sensibly without a full phrase index. Title matches are boosted because a
 * title is a stronger statement of what a post is about than a passing mention.
 */
function scoreKeywords(input: RelevanceInput): {
  factor: number;
  matches: readonly KeywordMatch[];
} {
  const titleTokens = new Set(tokenize(input.title ?? ''));
  const bodyTokens = new Set(tokenize(input.content));
  const matches: KeywordMatch[] = [];

  let total = 0;
  for (const interest of input.interests) {
    if (!interest.enabled || interest.weight <= 0) continue;

    for (const keyword of interest.keywords) {
      const keywordTokens = tokenize(keyword.keyword);
      if (keywordTokens.length === 0) continue;

      const inTitle = keywordTokens.every((token) => titleTokens.has(token));
      const inBody = keywordTokens.every((token) => bodyTokens.has(token));
      if (!inTitle && !inBody) continue;

      const boost = inTitle ? RELEVANCE_TUNING.titleMatchBoost : 1;
      const contribution = clamp01(interest.weight) * clamp01(keyword.weight) * boost;
      total += contribution;
      matches.push({ interestId: interest.id, keyword: keyword.keyword, contribution });
    }
  }

  matches.sort((a, b) => b.contribution - a.contribution);
  return { factor: clamp01(total / RELEVANCE_TUNING.keywordSaturation), matches };
}

/**
 * Scores semantic proximity as the best interest-weighted similarity between
 * the content embedding and any interest centroid.
 */
function scoreSemantic(input: RelevanceInput): { factor: number; interestIds: string[] } {
  const embedding = input.embedding;
  if (!embedding || embedding.length === 0) return { factor: 0, interestIds: [] };

  let best = 0;
  const scored: { id: string; value: number }[] = [];

  for (const interest of input.interests) {
    if (!interest.enabled || interest.weight <= 0) continue;
    if (interest.embedding?.length !== embedding.length) continue;

    const similarity = cosineSimilarity(embedding, interest.embedding);
    const rescaled = rescaleSimilarity(
      similarity,
      RELEVANCE_TUNING.semanticFloor,
      RELEVANCE_TUNING.semanticCeiling,
    );
    const weighted = rescaled * clamp01(interest.weight);
    scored.push({ id: interest.id, value: weighted });
    if (weighted > best) best = weighted;
  }

  scored.sort((a, b) => b.value - a.value);
  return {
    factor: clamp01(best),
    interestIds: scored.filter((entry) => entry.value > 0).map((entry) => entry.id),
  };
}

/**
 * Computes the relevance score and its full breakdown.
 *
 * Pure: the same input always produces the same output, which is what lets the
 * ingestion pipeline recompute historical relevance after the user edits their
 * interests.
 */
export function calculateRelevance(input: RelevanceInput): RelevanceScoreBreakdown {
  const keyword = scoreKeywords(input);
  const semantic = scoreSemantic(input);
  const sourceQuality = clamp01(input.sourceAuthorityWeight);
  const aiConfidence = input.aiConfidence === null ? null : clamp01(input.aiConfidence);

  const weights = aiConfidence === null ? RELEVANCE_WEIGHTS_WITHOUT_AI : RELEVANCE_WEIGHTS_WITH_AI;

  const components: RelevanceScoreComponents = {
    keyword: round(keyword.factor * 100, 2),
    semantic: round(semantic.factor * 100, 2),
    sourceQuality: round(sourceQuality * 100, 2),
    aiClassification: aiConfidence === null ? null : round(aiConfidence * 100, 2),
  };

  const weighted =
    keyword.factor * weights.keyword +
    semantic.factor * weights.semantic +
    sourceQuality * weights.sourceQuality +
    (aiConfidence ?? 0) * weights.aiClassification;

  const matchedInterestIds = [
    ...new Set([...keyword.matches.map((match) => match.interestId), ...semantic.interestIds]),
  ];

  return {
    components,
    matchedInterestIds,
    matchedKeywords: [...new Set(keyword.matches.map((match) => match.keyword))],
    relevanceScore: round(clampScore(weighted * 100), 2),
  };
}
