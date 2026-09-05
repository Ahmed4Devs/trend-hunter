import { cosineSimilarity, hoursBetween, round } from '@trendhunter/shared';

import type { ClusterablePost } from './similarity';
import { DEDUPLICATION_DEFAULTS, SIMILARITY_TUNING } from './weights';

/**
 * Duplicate detection.
 *
 * Three cases have to be told apart, and only the third is a judgement call:
 *
 *  1. the same item collected twice — identical fingerprint or canonical URL;
 *  2. two sources republishing one wire story within hours of each other;
 *  3. two genuinely different posts about the same event, which are *not*
 *     duplicates: they belong to one topic and both stay.
 *
 * Everything here is a pure decision over records the caller loaded. Nothing is
 * deleted here, and the resolution is a total order rather than "first one
 * wins", so a re-run over the same rows reaches the same verdict — which is
 * what makes the ingestion pipeline safe to retry.
 */

export const DUPLICATE_REASONS = ['CONTENT_HASH', 'CANONICAL_URL', 'EMBEDDING'] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

export interface DuplicateMatch {
  readonly candidate: ClusterablePost;
  readonly reason: DuplicateReason;
  /** 1 for an exact match; the cosine similarity for a near duplicate. */
  readonly similarity: number;
  /** Hours between the two publication instants. */
  readonly hoursApart: number;
}

export interface NearDuplicateOptions {
  /** Cosine similarity above which two texts count as the same text. */
  readonly minSimilarity?: number;
  /** Widest publication gap still treated as syndication rather than a revisit. */
  readonly windowHours?: number;
}

/** Stands in for a missing embedding, so the width check is the only guard. */
const NO_VECTOR: readonly number[] = [];

function hoursApart(a: ClusterablePost, b: ClusterablePost): number {
  const distance = Math.abs(hoursBetween(a.publishedAt, b.publishedAt));
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

/**
 * Total order over duplicate candidates, used everywhere a tie has to be broken.
 *
 * Earliest publication first, then the more authoritative source, then the id.
 * The id is not a preference, it is the guarantee: without a final total tie
 * break the winner would depend on the order the caller happened to load the
 * rows in, and two runs of the same job could disagree.
 */
function compareRecords(a: ClusterablePost, b: ClusterablePost): number {
  const byTime = a.publishedAt.getTime() - b.publishedAt.getTime();
  if (byTime !== 0) return byTime;
  const authorityDelta = (b.sourceAuthorityWeight ?? 0) - (a.sourceAuthorityWeight ?? 0);
  if (authorityDelta !== 0) return authorityDelta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Finds an already-stored record that is byte-for-byte the same item.
 *
 * The fingerprint is checked before the URL because it survives a source
 * rewriting its own links, and because two different items can legitimately
 * share a canonical URL (a live blog and its summary), while a shared
 * fingerprint means the normalised text itself is identical.
 */
export function findExactDuplicate(
  post: ClusterablePost,
  candidates: readonly ClusterablePost[],
): DuplicateMatch | null {
  const others = candidates.filter((candidate) => candidate.id !== post.id);

  const byHash = others
    .filter((candidate) => candidate.contentHash === post.contentHash)
    .sort(compareRecords)[0];
  if (byHash) {
    return {
      candidate: byHash,
      reason: 'CONTENT_HASH',
      similarity: 1,
      hoursApart: hoursApart(post, byHash),
    };
  }

  const byUrl = others
    .filter(
      (candidate) =>
        candidate.canonicalUrl.length > 0 && candidate.canonicalUrl === post.canonicalUrl,
    )
    .sort(compareRecords)[0];
  if (byUrl) {
    return {
      candidate: byUrl,
      reason: 'CANONICAL_URL',
      similarity: 1,
      hoursApart: hoursApart(post, byUrl),
    };
  }

  return null;
}

/**
 * Finds a record that says the same thing in the same words, for the case where
 * two sources republish one text — a press release picked up by a feed and
 * posted to Hacker News, say.
 *
 * Both conditions are required. Similarity alone would collapse recurring
 * formats ("Weekly hiring thread") that really are separate items, and the
 * short window alone would collapse everything published in the same hour.
 */
export function findNearDuplicate(
  post: ClusterablePost,
  candidates: readonly ClusterablePost[],
  options: NearDuplicateOptions = {},
): DuplicateMatch | null {
  const minSimilarity = options.minSimilarity ?? DEDUPLICATION_DEFAULTS.nearDuplicateSimilarity;
  const windowHours = options.windowHours ?? DEDUPLICATION_DEFAULTS.nearDuplicateWindowHours;
  const embedding = post.embedding;
  if (!embedding || embedding.length === 0) return null;

  const matches: DuplicateMatch[] = [];
  for (const candidate of candidates) {
    if (candidate.id === post.id) continue;
    const other = candidate.embedding ?? NO_VECTOR;
    if (other.length !== embedding.length) continue;

    const distance = hoursApart(post, candidate);
    if (distance > windowHours) continue;

    const similarity = cosineSimilarity(embedding, other);
    if (similarity < minSimilarity) continue;

    matches.push({
      candidate,
      reason: 'EMBEDDING',
      similarity: round(similarity, SIMILARITY_TUNING.precision),
      hoursApart: round(distance, SIMILARITY_TUNING.precision),
    });
  }

  matches.sort((a, b) => b.similarity - a.similarity || compareRecords(a.candidate, b.candidate));
  return matches[0] ?? null;
}

export const DUPLICATE_KEEP_REASONS = [
  'EARLIEST_PUBLISHED',
  'HIGHER_AUTHORITY',
  'STABLE_ID_ORDER',
] as const;
export type DuplicateKeepReason = (typeof DUPLICATE_KEEP_REASONS)[number];

export interface DuplicateResolution {
  readonly keep: ClusterablePost;
  readonly drop: ClusterablePost;
  readonly reason: DuplicateKeepReason;
}

/**
 * Decides which of two duplicates survives.
 *
 * Earliest publication wins because the first source to carry a story is the
 * one worth crediting and the one whose timestamp the trend engine should see;
 * authority breaks a tie because a wire agency's copy outlives an aggregator's.
 * The result depends only on the two records, never on the argument order, so
 * re-running the pipeline drops the same row every time.
 */
export function resolveDuplicate(a: ClusterablePost, b: ClusterablePost): DuplicateResolution {
  const order = compareRecords(a, b);
  const [keep, drop] = order <= 0 ? [a, b] : [b, a];
  const reason: DuplicateKeepReason =
    keep.publishedAt.getTime() !== drop.publishedAt.getTime()
      ? 'EARLIEST_PUBLISHED'
      : (keep.sourceAuthorityWeight ?? 0) !== (drop.sourceAuthorityWeight ?? 0)
        ? 'HIGHER_AUTHORITY'
        : 'STABLE_ID_ORDER';
  return { keep, drop, reason };
}

/**
 * Reduces a set of mutual duplicates to the single record that survives.
 *
 * Fold rather than sort, so the pairwise rule in {@link resolveDuplicate} is the
 * only place the policy lives; the order is total, so the fold is associative
 * and the input order cannot change the answer.
 */
export function selectSurvivor(records: readonly ClusterablePost[]): ClusterablePost | null {
  let survivor: ClusterablePost | null = null;
  for (const record of records) {
    survivor = survivor === null ? record : resolveDuplicate(survivor, record).keep;
  }
  return survivor;
}
