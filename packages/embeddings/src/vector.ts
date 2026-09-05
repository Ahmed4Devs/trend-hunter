import { clamp01, cosineSimilarity, EMBEDDING_DIMENSIONS } from '@trendhunter/shared';

import { VectorDimensionError, VectorLiteralError } from './errors';

/**
 * Conversions between the in-memory vector representation and pgvector's text
 * form, plus the small amount of ranking arithmetic the search and clustering
 * layers share.
 *
 * Every conversion checks the width. pgvector rejects a mis-sized value at the
 * column, but by then the failure is a driver error in the middle of a batch
 * insert; failing here names the offending vector instead.
 */

export interface VectorCandidate<TItem> {
  readonly item: TItem;
  readonly vector: readonly number[];
}

export interface ScoredCandidate<TItem> {
  readonly item: TItem;
  /** Cosine similarity in `[-1, 1]`, not the 0..1 mapping. */
  readonly similarity: number;
}

export interface TopKOptions {
  /** Candidates scoring below this are dropped. Defaults to no floor. */
  readonly minSimilarity?: number;
}

/**
 * `-0` is written as `0`: pgvector stores them identically, and keeping the
 * sign would make two equal vectors differ as text, which breaks fixture
 * comparisons for no gain.
 */
function formatComponent(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

/** Renders a vector as the pgvector literal `[a,b,c]`. */
export function toPgVectorLiteral(
  vector: readonly number[],
  dimensions: number = EMBEDDING_DIMENSIONS,
): string {
  if (vector.length !== dimensions) {
    throw new VectorDimensionError(dimensions, vector.length);
  }
  const parts = new Array<string>(vector.length);
  for (const [index, value] of vector.entries()) {
    if (!Number.isFinite(value)) {
      throw new VectorLiteralError(`Vector component ${index} is not a finite number.`);
    }
    parts[index] = formatComponent(value);
  }
  return `[${parts.join(',')}]`;
}

/**
 * Parses a pgvector literal back into numbers.
 *
 * Drivers hand this column back as text, so this runs on every vector read out
 * of the database and treats the input as untrusted: a malformed component is
 * an error, never a silent `NaN`.
 */
export function fromPgVectorLiteral(
  literal: string,
  dimensions: number = EMBEDDING_DIMENSIONS,
): number[] {
  const trimmed = literal.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new VectorLiteralError('Vector literal must be wrapped in square brackets.');
  }

  const body = trimmed.slice(1, -1).trim();
  const parts = body.length === 0 ? [] : body.split(',');
  const vector = parts.map((part, index) => {
    const text = part.trim();
    // `Number('')` is 0, so an empty component has to be rejected explicitly.
    const value = text.length === 0 ? Number.NaN : Number(text);
    if (!Number.isFinite(value)) {
      throw new VectorLiteralError(`Vector component ${index} is not a finite number.`);
    }
    return value;
  });

  if (vector.length !== dimensions) {
    throw new VectorDimensionError(dimensions, vector.length);
  }
  return vector;
}

/**
 * Maps pgvector's cosine distance (`<=>`, which spans 0..2) onto a 0..1
 * similarity for the API and the UI.
 *
 * The mapping is `clamp01(1 - distance)`: the cosine itself, with the negative
 * half collapsed onto 0. The alternative, `(2 - distance) / 2`, would rescale
 * the full range but report an orthogonal — i.e. entirely unrelated — pair as
 * 0.5, which reads as "half relevant" everywhere the number is surfaced. For
 * ranking, "opposite" and "unrelated" both mean "not a match", so they share
 * the bottom of the scale. Every 0..1 similarity in the platform uses this
 * mapping, including the thresholds in the clustering layer.
 */
export function cosineDistanceToSimilarity(distance: number): number {
  // `clamp01` already collapses a non-finite distance to 0.
  return clamp01(1 - distance);
}

/** Inverse of {@link cosineDistanceToSimilarity}, for building `<=>` bounds in SQL. */
export function similarityToCosineDistance(similarity: number): number {
  return 1 - clamp01(similarity);
}

/**
 * The top `k` candidates by cosine similarity, highest first.
 *
 * Used for in-memory re-ranking of a candidate pool that pgvector has already
 * narrowed, and by the clustering layer where the vectors are held in memory
 * anyway. Candidates whose width does not match the query are skipped rather
 * than scored: they were produced by a different model, so any similarity to
 * them would be meaningless.
 *
 * Ties keep their input order, because `Array#sort` is stable — which makes the
 * output reproducible for equally-scored candidates.
 */
export function topKBySimilarity<TItem>(
  query: readonly number[],
  candidates: readonly VectorCandidate<TItem>[],
  k: number,
  options: TopKOptions = {},
): ScoredCandidate<TItem>[] {
  const limit = Math.trunc(k);
  if (limit <= 0 || query.length === 0) return [];

  const minSimilarity = options.minSimilarity ?? Number.NEGATIVE_INFINITY;
  const scored: ScoredCandidate<TItem>[] = [];
  for (const candidate of candidates) {
    if (candidate.vector.length !== query.length) continue;
    const similarity = cosineSimilarity(query, candidate.vector);
    if (similarity < minSimilarity) continue;
    scored.push({ item: candidate.item, similarity });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}
