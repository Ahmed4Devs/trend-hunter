import { round } from '@trendhunter/shared';

import type { ClusterablePost, ClusterableTopic, ClusterProfile, SimilarityResult } from './similarity';
import { buildPostProfile, calculateSimilarity } from './similarity';
import { deriveTopicName } from './topic-naming';
import type { DerivedTopicName } from './topic-naming';
import { CLUSTER_DEFAULTS, SIMILARITY_TUNING } from './weights';

/**
 * Cluster assignment.
 *
 * Decides whether a post joins one of the topics the caller loaded or starts a
 * new one. The engine never touches the database: it returns a decision, and
 * the worker applies it inside its own transaction.
 *
 * Two properties matter more here than raw accuracy, because both of them are
 * things a user notices:
 *
 *  - **order independence** — the decision depends only on the post and the set
 *    of candidates, never on the order they arrive in, so a re-run of the
 *    clustering job over the same rows reproduces the same topics;
 *  - **stickiness** — when two topics are within a hair of each other the more
 *    established one wins, and a post already assigned keeps its topic. Churn
 *    between two near-identical topics is worse than either choice.
 */

export const CLUSTER_DECISION_KINDS = ['ASSIGN_EXISTING', 'CREATE_TOPIC'] as const;
export type ClusterDecisionKind = (typeof CLUSTER_DECISION_KINDS)[number];

export const CLUSTER_DECISION_REASONS = [
  /** The best candidate cleared the threshold on its own. */
  'ABOVE_THRESHOLD',
  /** Several candidates were tied; the most established one took it. */
  'ESTABLISHED_TOPIC_PREFERRED',
  /** The post's current topic was within the stickiness margin of the best. */
  'INCUMBENT_RETAINED',
  /** Nothing came close enough to merge into. */
  'BELOW_THRESHOLD',
  /** A candidate matched textually but lies outside the allowed time gap. */
  'TIME_GAP_EXCEEDED',
  /** The caller supplied no candidate topics at all. */
  'NO_CANDIDATES',
] as const;
export type ClusterDecisionReason = (typeof CLUSTER_DECISION_REASONS)[number];

export interface ScoredTopicCandidate {
  readonly topic: ClusterableTopic;
  readonly similarity: SimilarityResult;
  /** False when the post falls too far outside the topic's activity window. */
  readonly withinTimeGap: boolean;
}

export interface AssignExistingDecision {
  readonly kind: 'ASSIGN_EXISTING';
  readonly topicId: string;
  readonly reason: ClusterDecisionReason;
  /** Stored on the topic/post join, with its components, at assignment time. */
  readonly similarity: SimilarityResult;
  /** Next best candidate overall, whether or not it cleared the threshold. */
  readonly runnerUpTopicId: string | null;
  /** Similarity lead of the chosen topic over that runner-up. */
  readonly margin: number;
}

export interface CreateTopicDecision {
  readonly kind: 'CREATE_TOPIC';
  readonly reason: ClusterDecisionReason;
  readonly name: DerivedTopicName;
  /** Closest topic that was rejected, kept so the decision can be audited. */
  readonly closestCandidate: ScoredTopicCandidate | null;
}

export type ClusterDecision = AssignExistingDecision | CreateTopicDecision;

export interface ClusterOptions {
  /** Composite similarity a post must reach to join an existing topic. */
  readonly assignmentThreshold?: number;
  /** Band inside which two candidates count as tied. */
  readonly stickinessMargin?: number;
  /** Widest gap between the post and a topic's activity window. */
  readonly maxTimeGapHours?: number;
  /** The topic this post is already attached to, on a re-clustering pass. */
  readonly incumbentTopicId?: string | null;
  /** Ceiling on a derived topic name. */
  readonly maxNameLength?: number;
}

/**
 * Total order over candidates: similarity first, then the tie breaks that make
 * the result order-independent.
 *
 * Similarity is compared at the reported precision — two candidates whose
 * scores differ only in floating point noise are a tie, not a ranking, and
 * letting that noise decide would make the outcome depend on which vector
 * happened to be summed first.
 */
function compareCandidates(a: ScoredTopicCandidate, b: ScoredTopicCandidate): number {
  const bySimilarity = b.similarity.similarity - a.similarity.similarity;
  if (bySimilarity !== 0) return bySimilarity;
  const byAge = a.topic.firstDetectedAt.getTime() - b.topic.firstDetectedAt.getTime();
  if (byAge !== 0) return byAge;
  const byVolume = b.topic.postCount - a.topic.postCount;
  if (byVolume !== 0) return byVolume;
  return a.topic.id < b.topic.id ? -1 : a.topic.id > b.topic.id ? 1 : 0;
}

/**
 * Scores a post against every candidate topic, strongest first.
 *
 * Exported because the topic page shows the runners-up when explaining why a
 * post was clustered where it was.
 */
export function rankTopicCandidates(
  post: ClusterablePost,
  candidateTopics: readonly ClusterableTopic[],
  options: ClusterOptions = {},
): readonly ScoredTopicCandidate[] {
  const maxTimeGapHours = options.maxTimeGapHours ?? CLUSTER_DEFAULTS.maxTimeGapHours;
  const profile: ClusterProfile = buildPostProfile(post);

  return candidateTopics
    .map((topic) => {
      const similarity = calculateSimilarity(post, topic, profile);
      return { topic, similarity, withinTimeGap: similarity.hoursApart <= maxTimeGapHours };
    })
    .sort(compareCandidates);
}

function createDecision(
  post: ClusterablePost,
  reason: ClusterDecisionReason,
  closestCandidate: ScoredTopicCandidate | null,
  options: ClusterOptions,
): CreateTopicDecision {
  const nameOptions = options.maxNameLength === undefined ? {} : { maxLength: options.maxNameLength };
  return {
    kind: 'CREATE_TOPIC',
    reason,
    name: deriveTopicName([post], nameOptions),
    closestCandidate,
  };
}

/**
 * Assigns a post to the best matching candidate topic, or asks for a new one.
 *
 * The caller is expected to have narrowed `candidateTopics` already (by recency
 * and by an approximate vector search); this function is the exact, explainable
 * decision over that shortlist, not the shortlist itself.
 */
export function assignToTopic(
  post: ClusterablePost,
  candidateTopics: readonly ClusterableTopic[],
  options: ClusterOptions = {},
): ClusterDecision {
  const threshold = options.assignmentThreshold ?? CLUSTER_DEFAULTS.assignmentThreshold;
  const margin = options.stickinessMargin ?? CLUSTER_DEFAULTS.stickinessMargin;

  const ranked = rankTopicCandidates(post, candidateTopics, options);
  if (ranked.length === 0) return createDecision(post, 'NO_CANDIDATES', null, options);

  const eligible = ranked.filter(
    (candidate) => candidate.withinTimeGap && candidate.similarity.similarity >= threshold,
  );

  const best = eligible[0];
  if (!best) {
    // Separating these two refusals matters operationally: a run full of
    // TIME_GAP_EXCEEDED means the candidate query is reaching too far back,
    // while BELOW_THRESHOLD means the threshold or the embeddings need review.
    // Compared against the textual score rather than the composite: the time
    // gate has already pushed the composite of a far-away candidate down, so
    // the composite could never tell these two refusals apart.
    const blockedByTime = ranked.some(
      (candidate) => !candidate.withinTimeGap && candidate.similarity.textualScore >= threshold,
    );
    const closest = ranked[0] ?? null;
    return createDecision(post, blockedByTime ? 'TIME_GAP_EXCEEDED' : 'BELOW_THRESHOLD', closest, options);
  }

  // Everything within the stickiness margin of the leader is treated as tied,
  // and `eligible` is already ordered oldest-first inside a tie.
  const contenders = eligible.filter(
    (candidate) => best.similarity.similarity - candidate.similarity.similarity <= margin,
  );
  const incumbent = contenders.find((candidate) => candidate.topic.id === options.incumbentTopicId);
  const chosen = incumbent ?? contenders[0] ?? best;

  const reason: ClusterDecisionReason = incumbent
    ? 'INCUMBENT_RETAINED'
    : contenders.length > 1
      ? 'ESTABLISHED_TOPIC_PREFERRED'
      : 'ABOVE_THRESHOLD';

  // The runner-up is the next best candidate overall, not the next best
  // *eligible* one: when a post is assigned, the interesting comparison for
  // whoever reads the audit trail is what else it nearly matched.
  const runnerUp = ranked.find((candidate) => candidate.topic.id !== chosen.topic.id) ?? null;

  return {
    kind: 'ASSIGN_EXISTING',
    topicId: chosen.topic.id,
    reason,
    similarity: chosen.similarity,
    runnerUpTopicId: runnerUp?.topic.id ?? null,
    margin: round(
      chosen.similarity.similarity - (runnerUp?.similarity.similarity ?? 0),
      SIMILARITY_TUNING.precision,
    ),
  };
}
