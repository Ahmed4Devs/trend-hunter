import { EMBEDDING_DIMENSIONS, tokenize } from '@trendhunter/shared';
import type { EmbedOutput, EmbedRequest, EmbeddingProvider, LlmResult } from '@trendhunter/types';

/**
 * The offline embedding provider.
 *
 * It is a hashed bag-of-features model — the "hashing trick" — rather than a
 * learned one, which buys three properties the platform depends on: it is
 * deterministic (the same text always yields the same vector, so re-running
 * ingestion never churns the index), it needs no network or API key, and it is
 * language-agnostic. The last point matters most here: `tokenize` keeps Arabic
 * and Latin script alike, so Arabic content clusters on shared vocabulary
 * exactly as English content does, with no model that has to have seen the
 * language during training.
 *
 * What it cannot do is capture meaning: two texts about the same subject in
 * different words look unrelated to it. That is an accepted trade for the
 * development and test data mode; a hosted model is swapped in through the same
 * {@link EmbeddingProvider} interface for live deployments.
 */

/** 32-bit FNV-1a parameters. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * A second, unrelated basis used only to pick the sign of a feature.
 *
 * Signed hashing is what keeps collisions unbiased: without it every collision
 * adds mass, so two texts with nothing in common still score a positive cosine
 * that grows with their length. With it, collisions cancel on average and an
 * unrelated pair sits near zero, which is what makes the similarity usable as a
 * ranking signal.
 */
const SIGN_OFFSET_BASIS = 0x2fdb2b7d;

/**
 * Bigrams sharpen phrase-level similarity ("open source" is not "open" plus
 * "source"), but they are far sparser than unigrams, so two texts on one
 * subject would look distant whenever they phrase it differently. Weighting
 * them below unigrams keeps the topical signal dominant.
 */
const BIGRAM_WEIGHT = 0.6;

/** Feature standing in for a document with no tokens at all. */
const EMPTY_DOCUMENT_FEATURE = '__empty_document__';

/** Rough characters-per-token ratio, used only to report a comparable usage figure. */
const CHARACTERS_PER_TOKEN = 4;

/**
 * FNV-1a, finished with an avalanche step.
 *
 * The finalizer is not optional here. Raw FNV-1a's lowest bit is only the
 * parity of the input characters' low bits, so two bases that share that bit
 * agree on it for every input — the bucket index and the sign would then be
 * cut from the same bit, every collision would share a sign, and the
 * cancellation the signed scheme exists for would never happen.
 */
function hash32(value: string, basis: number): number {
  let hash = basis;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function countTokens(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function countBigrams(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 1; index < tokens.length; index += 1) {
    const previous = tokens[index - 1];
    const current = tokens[index];
    if (previous === undefined || current === undefined) continue;
    const bigram = `${previous} ${current}`;
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}

/**
 * Sublinear term frequency: the second occurrence of a word says much more than
 * the fiftieth, so a repetitive text cannot drown out a concise one.
 */
function termWeight(count: number): number {
  return 1 + Math.log(count);
}

function accumulate(
  buckets: Float64Array,
  counts: ReadonlyMap<string, number>,
  scale: number,
): void {
  const dimensions = buckets.length;
  for (const [feature, count] of counts) {
    const index = hash32(feature, FNV_OFFSET_BASIS) % dimensions;
    const sign = (hash32(feature, SIGN_OFFSET_BASIS) & 1) === 0 ? 1 : -1;
    buckets[index] = (buckets[index] ?? 0) + sign * scale * termWeight(count);
  }
}

/**
 * Embeds one text into a unit-length vector of `dimensions` components.
 *
 * The result is never the zero vector: pgvector's cosine distance is undefined
 * against a zero vector, so an empty document — or the vanishingly rare case of
 * every feature cancelling in a collision — falls back to a single bucket
 * derived from the raw text.
 */
export function embedTextDeterministically(
  text: string,
  dimensions: number = EMBEDDING_DIMENSIONS,
): number[] {
  const width = Math.max(1, Math.trunc(dimensions));
  const buckets = new Float64Array(width);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    const fallback = text.trim().toLowerCase();
    accumulate(buckets, new Map([[fallback.length > 0 ? fallback : EMPTY_DOCUMENT_FEATURE, 1]]), 1);
  } else {
    accumulate(buckets, countTokens(tokens), 1);
    accumulate(buckets, countBigrams(tokens), BIGRAM_WEIGHT);
  }

  let norm = 0;
  for (const value of buckets) norm += value * value;
  norm = Math.sqrt(norm);

  if (norm === 0) {
    const index = hash32(text, FNV_OFFSET_BASIS) % width;
    const vector = new Array<number>(width).fill(0);
    vector[index] = 1;
    return vector;
  }

  const vector = new Array<number>(width);
  for (let index = 0; index < width; index += 1) {
    vector[index] = (buckets[index] ?? 0) / norm;
  }
  return vector;
}

export interface DeterministicEmbeddingProviderOptions {
  /** Vector width. Must match the pgvector column the results are stored in. */
  readonly dimensions?: number;
  /** Recorded on every result so stored vectors can be traced to a producer. */
  readonly model?: string;
}

export const DETERMINISTIC_EMBEDDING_MODEL = 'trendhunter-hash-v1';

/** The {@link EmbeddingProvider} used whenever `AI_PROVIDER` is `mock`. */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'deterministic';
  readonly model: string;
  readonly dimensions: number;

  constructor(options: DeterministicEmbeddingProviderOptions = {}) {
    this.model = options.model ?? DETERMINISTIC_EMBEDDING_MODEL;
    this.dimensions = Math.max(1, Math.trunc(options.dimensions ?? EMBEDDING_DIMENSIONS));
  }

  embed(request: EmbedRequest): Promise<LlmResult<EmbedOutput>> {
    const startedAt = Date.now();
    const vectors = request.texts.map((text) => embedTextDeterministically(text, this.dimensions));
    const promptTokens = request.texts.reduce(
      (total, text) => total + Math.ceil(text.length / CHARACTERS_PER_TOKEN),
      0,
    );

    return Promise.resolve({
      value: { vectors, dimensions: this.dimensions, model: this.model },
      meta: {
        provider: this.name,
        model: this.model,
        usage: {
          promptTokens,
          completionTokens: 0,
          totalTokens: promptTokens,
          estimatedCost: 0,
        },
        durationMs: Date.now() - startedAt,
      },
    });
  }
}
