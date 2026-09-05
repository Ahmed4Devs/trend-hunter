import { invariant } from '@trendhunter/shared';

/**
 * Deterministic pseudo-randomness for the mock corpus.
 *
 * Every generator in this package must produce identical output for a given
 * seed. A developer's dashboard that reshuffles on each scan makes clustering,
 * scoring and trend snapshots impossible to reason about, and a flaky corpus
 * would make the pipeline tests flaky too. `Math.random` and the wall clock are
 * therefore never read here: all variation comes from a seed string and an
 * explicitly passed `now`.
 */

export interface Random {
  /** Uniform in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[minInclusive, maxInclusive]`. */
  int(minInclusive: number, maxInclusive: number): number;
  bool(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates on a copy; the input is never mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * Pareto-distributed integer in `[minimum, maximum]`. Engagement counters are
   * drawn from this rather than a uniform distribution because real engagement
   * is heavy-tailed: most posts get nearly nothing and a handful get everything.
   * A uniform corpus would make every ranking test pass trivially.
   */
  powerLaw(minimum: number, maximum: number, exponent: number): number;
  /**
   * A derived, independent stream. Sub-streams keep the corpus stable under
   * change: adding an item to the X generator must not reshuffle Reddit.
   */
  fork(label: string): Random;
}

/** xmur3 — spreads a short, human-readable seed across all 32 bits. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 — small, fast, and stable across Node versions. */
export function createRandom(seed: string): Random {
  let state = hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const random: Random = {
    next,
    int(minInclusive, maxInclusive) {
      const low = Math.ceil(Math.min(minInclusive, maxInclusive));
      const high = Math.floor(Math.max(minInclusive, maxInclusive));
      if (high <= low) return low;
      return low + Math.floor(next() * (high - low + 1));
    },
    bool(probability) {
      return next() < probability;
    },
    pick(items) {
      const first = items[0];
      invariant(first !== undefined, 'cannot pick from an empty collection');
      return items[Math.floor(next() * items.length)] ?? first;
    },
    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        if (a !== undefined && b !== undefined) {
          copy[i] = b;
          copy[j] = a;
        }
      }
      return copy;
    },
    powerLaw(minimum, maximum, exponent) {
      const low = Math.max(0, Math.min(minimum, maximum));
      const high = Math.max(low, maximum);
      if (high === low) return low;
      // Inverse CDF of a bounded Pareto; `1 - u` keeps the draw inside (0, 1].
      const u = 1 - next();
      const scaled = Math.max(1, low) / Math.pow(u, 1 / Math.max(0.1, exponent));
      return Math.round(Math.min(high, Math.max(low, scaled)));
    },
    fork(label) {
      return createRandom(`${String(hashSeed(label))}:${String(state)}:${label}`);
    },
  };

  return random;
}

/**
 * Picks `count` distinct entries, wrapping when the pool is smaller than the
 * request so a caller can always ask for the volume it needs.
 */
export function pickMany<T>(random: Random, items: readonly T[], count: number): T[] {
  const first = items[0];
  invariant(first !== undefined, 'cannot pick from an empty collection');
  const wanted = Math.max(0, Math.floor(count));
  const result: T[] = [];
  while (result.length < wanted) {
    for (const item of random.shuffle(items)) {
      if (result.length >= wanted) break;
      result.push(item);
    }
  }
  return result;
}
