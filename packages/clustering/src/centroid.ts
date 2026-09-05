/**
 * Incremental topic centroids.
 *
 * A topic's embedding is the mean of its posts' embeddings. Recomputing that
 * mean would mean re-reading every post's vector on every assignment — a topic
 * with 400 posts would cost 400 vector reads to absorb one new post — so the
 * mean is maintained incrementally instead, from the current centroid and its
 * count alone.
 *
 * The running form used here, `mean += (value - mean) / n`, is the numerically
 * stable one: summing then dividing accumulates error in the sum, which for a
 * long-lived topic drifts the centroid away from the posts it is supposed to
 * represent.
 */

export interface TopicCentroid {
  readonly vector: readonly number[];
  /** Number of vectors the mean was taken over. */
  readonly count: number;
}

export const EMPTY_CENTROID: TopicCentroid = { vector: [], count: 0 };

function isUsable(vector: readonly number[]): boolean {
  if (vector.length === 0) return false;
  for (const value of vector) {
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

/** Batch mean, for the initial build and for a periodic rebuild. */
export function centroidFromVectors(vectors: readonly (readonly number[])[]): TopicCentroid {
  let result = EMPTY_CENTROID;
  for (const vector of vectors) result = addToCentroid(result, vector);
  return result;
}

/**
 * Absorbs one vector into a running mean.
 *
 * A vector of the wrong width came from a different embedding model and is
 * ignored: mixing two models' geometry into one centroid silently destroys the
 * topic's similarity scores, and it is better for the new post to score against
 * a slightly stale centroid than for the centroid to become meaningless.
 */
export function addToCentroid(
  current: TopicCentroid | null,
  vector: readonly number[],
): TopicCentroid {
  if (!isUsable(vector)) return current ?? EMPTY_CENTROID;
  if (!current || current.count === 0 || current.vector.length === 0) {
    return { vector: [...vector], count: 1 };
  }
  if (current.vector.length !== vector.length) return current;

  const count = current.count + 1;
  const updated = current.vector.map((value, index) => value + ((vector[index] ?? 0) - value) / count);
  return { vector: updated, count };
}

/**
 * Removes a vector from a running mean, for a post that moves to another topic.
 *
 * Exact in real arithmetic, approximate in floating point: each removal
 * re-amplifies whatever error the additions left behind. That is acceptable for
 * the occasional reassignment, and callers that rewrite a topic's membership
 * wholesale should rebuild with {@link centroidFromVectors} rather than removing
 * post by post.
 */
export function removeFromCentroid(
  current: TopicCentroid,
  vector: readonly number[],
): TopicCentroid {
  if (!isUsable(vector) || current.count === 0) return current;
  if (current.vector.length !== vector.length) return current;
  if (current.count === 1) return EMPTY_CENTROID;

  const count = current.count - 1;
  const updated = current.vector.map((value, index) => value + (value - (vector[index] ?? 0)) / count);
  return { vector: updated, count };
}

/**
 * Weighted mean of two centroids, for when two topics are merged. Merging by
 * count rather than averaging the two vectors keeps the result equal to the
 * centroid of the combined membership.
 */
export function mergeCentroids(a: TopicCentroid, b: TopicCentroid): TopicCentroid {
  if (a.count === 0 || a.vector.length === 0) return b;
  if (b.count === 0 || b.vector.length === 0) return a;
  if (a.vector.length !== b.vector.length) return a.count >= b.count ? a : b;

  const count = a.count + b.count;
  const vector = a.vector.map(
    (value, index) => (value * a.count + (b.vector[index] ?? 0) * b.count) / count,
  );
  return { vector, count };
}
