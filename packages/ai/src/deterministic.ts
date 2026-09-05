/**
 * Deterministic randomness for the offline provider.
 *
 * The whole product runs on the mock provider in development, so "random"
 * choices have to be reproducible: the Content Studio must show the same draft
 * after a page refresh, a reviewer must be able to reproduce anything they see,
 * and the clustering tests must get the same embeddings on every run. That
 * rules out `Math.random()` and `Date.now()` entirely — every choice made in
 * this package is driven by a PRNG seeded from a hash of the request itself.
 */

/** FNV-1a, 32 bits. Fast, well-mixed and stable across Node versions. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A second, independent hash of the same string.
 *
 * Feature hashing needs two uncorrelated hashes — one to choose the bucket and
 * one to choose the sign — otherwise every collision biases the dot product in
 * the same direction and similarity scores drift upwards for unrelated texts.
 */
export function hashStringWithSalt(value: string, salt: number): number {
  let hash = (0x811c9dc5 ^ Math.imul(salt >>> 0, 0x9e3779b1)) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Joins request fields into one seed string.
 *
 * The separator keeps field boundaries visible to the hash, so `['ab', 'c']`
 * and `['a', 'bc']` cannot collide onto one seed and hand two different
 * requests the same draft.
 */
export function stableSeed(parts: readonly (string | number | null | undefined)[]): string {
  return parts.map((part) => (part == null ? '' : String(part))).join('|~|');
}

export interface Rng {
  /** Next value in `[0, 1)`. */
  next(): number;
  /** Integer in `[0, maxExclusive)`; returns 0 when the bound is not positive. */
  int(maxExclusive: number): number;
  /** Deterministic choice from a statically non-empty list. */
  pick<T>(items: readonly [T, ...T[]]): T;
}

/**
 * mulberry32: a 32-bit generator with a full period and good distribution for
 * the handful of draws a single generation makes. It is not cryptographic and
 * is never used where that would matter.
 */
export function createRng(seed: string | number): Rng {
  let state = (typeof seed === 'number' ? seed >>> 0 : hashString(seed)) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  const int = (maxExclusive: number): number =>
    maxExclusive > 0 ? Math.floor(next() * maxExclusive) : 0;

  return {
    next,
    int,
    // The tuple type is what makes this total: an empty bank is a type error
    // rather than an `undefined` leaking into generated copy.
    pick: <T>(items: readonly [T, ...T[]]): T => items[int(items.length)] ?? items[0],
  };
}

/**
 * Picks `count` distinct entries, preserving bank order.
 *
 * Used to vary which supporting lines a draft uses without ever repeating one
 * inside the same post.
 */
export function pickDistinct<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const wanted = Math.min(Math.max(0, Math.floor(count)), pool.length);
  const chosen: T[] = [];
  for (let index = 0; index < wanted; index += 1) {
    const position = rng.int(pool.length);
    const [entry] = pool.splice(position, 1);
    if (entry !== undefined) chosen.push(entry);
  }
  return chosen;
}
