/**
 * Small numeric helpers used by the scoring engines.
 *
 * They are deliberately pure and total: every function returns a finite number
 * for every finite input, because a `NaN` leaking into a score would silently
 * corrupt ranking and be very hard to trace back.
 */

/** Clamps `value` into `[min, max]`. Non-finite input collapses to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Clamps into the unit interval `[0, 1]`. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Clamps into the score interval `[0, 100]`. */
export function clampScore(value: number): number {
  return clamp(value, 0, 100);
}

/** Rounds to `decimals` places, avoiding `-0` and floating point dust. */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const result = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += Number.isFinite(value) ? value : 0;
  return total / values.length;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += Number.isFinite(value) ? value : 0;
  return total;
}

/**
 * Maps an unbounded, positively-skewed count onto `[0, 1]` using a logarithm,
 * so that the first few items move the needle a lot and the thousandth barely
 * does. `reference` is the count that maps to 1.
 */
export function logNormalize(count: number, reference: number): number {
  if (reference <= 0) return 0;
  const safeCount = Math.max(0, Number.isFinite(count) ? count : 0);
  return clamp01(Math.log1p(safeCount) / Math.log1p(reference));
}

/**
 * Exponential decay with an explicit half-life: returns 1 at `age = 0` and
 * 0.5 at `age = halfLife`.
 */
export function halfLifeDecay(age: number, halfLife: number): number {
  if (halfLife <= 0) return 0;
  const safeAge = Math.max(0, Number.isFinite(age) ? age : 0);
  return clamp01(Math.pow(2, -safeAge / halfLife));
}

/**
 * Cosine similarity of two equal-length vectors, in `[-1, 1]`.
 * Returns 0 when either vector is empty, mismatched or zero-length.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return clamp(dot / (Math.sqrt(normA) * Math.sqrt(normB)), -1, 1);
}

/** Rescales a cosine similarity from `[floor, ceiling]` onto `[0, 1]`. */
export function rescaleSimilarity(similarity: number, floor = 0.2, ceiling = 0.9): number {
  if (ceiling <= floor) return 0;
  return clamp01((similarity - floor) / (ceiling - floor));
}

/** Percentage change from `previous` to `current`; `null` when undefined. */
export function percentageChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

/** Returns `part / total` as a 0..100 percentage, rounded to one decimal. */
export function percentageOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return round((part / total) * 100, 1);
}

/** Euclidean length of a vector. */
export function vectorNorm(vector: readonly number[]): number {
  let total = 0;
  for (const value of vector) total += value * value;
  return Math.sqrt(total);
}

/** Returns a unit-length copy of `vector`; a zero vector is returned unchanged. */
export function normalizeVector(vector: readonly number[]): number[] {
  const norm = vectorNorm(vector);
  if (norm === 0) return [...vector];
  return vector.map((value) => value / norm);
}

/** Element-wise mean of equal-length vectors, i.e. a centroid. */
export function centroid(vectors: readonly (readonly number[])[]): number[] {
  const first = vectors[0];
  if (!first) return [];
  const dimensions = first.length;
  const result = new Array<number>(dimensions).fill(0);
  let counted = 0;
  for (const vector of vectors) {
    if (vector.length !== dimensions) continue;
    for (let i = 0; i < dimensions; i += 1) {
      result[i] = (result[i] ?? 0) + (vector[i] ?? 0);
    }
    counted += 1;
  }
  if (counted === 0) return result;
  return result.map((value) => value / counted);
}
